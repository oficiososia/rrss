# Publicación en redes (Fase 3)

Calendario editorial, aprobaciones, cuentas conectadas y publicador de
Instagram. Estado a 19/11/2026:

| Qué | Estado |
|---|---|
| Base de datos: cuentas, calendario, regla de aprobación, intentos, comentarios, publicador (migraciones `20261119010000` a `20261119040000`) | Implementado y probado en base de datos (PGlite, migraciones reales) |
| Publicador (`social-publish`) con cerrojo, idempotencia, reintentos, cupo, imagen, carrusel y reel | Probado contra la **Graph API simulada** |
| Conexión por OAuth (`social-connect`) y tokens cifrados | Probado contra la **Graph API simulada** |
| Interfaz: «Calendario» de la marca y «Cuentas conectadas» en Marca → Datos | Probado en componentes (Supabase simulado) |
| Escenario de extremo a extremo `tests/e2e/13-publicacion-calendario.spec.ts` | Escrito, **sin ejecutar** |
| Adaptador real de Meta (`_shared/social/meta-graph.ts`) | Escrito contra la documentación oficial, **sin probar contra el servicio real**: no hay aplicación de Meta |
| Facebook (páginas) | Modelo preparado (`social_accounts.network = 'facebook'`); no se conecta ni se publica |
| Stories de Instagram | No se publican (el formato queda «Detenida: formato no admitido») |

## 1. Qué hace

1. **Cuentas conectadas.** Quien gestiona la marca conecta su cuenta profesional
   de Instagram con el inicio de sesión oficial de Meta (Facebook Login for
   Business). Los tokens se cifran en la función (AES-256-GCM) y se guardan en
   `private.social_account_secrets`, un esquema que la API no expone y que
   ningún rol del cliente puede leer. Desconectar borra el token y detiene lo
   programado para esa cuenta.
2. **Calendario.** Una pieza se pone en el calendario con su fecha, su cuenta,
   la versión aprobada y la exportación JPEG de esa versión (o el vídeo, en un
   reel). Vistas de mes, semana, día y por red; arrastrar y soltar para cambiar
   la fecha; filtros por red y por estado; aprobar varias a la vez; ficha con
   intentos, comentarios, mover, cancelar y reintentar.
3. **Publicador.** Cada minuto, pg_cron encola las publicaciones cuya hora ha
   llegado y llama a la Edge Function `social-publish`, que las publica.

Estados que se ven: Idea, Borrador, En revisión (la pieza aún no está
aprobada), Detenida (con el motivo), **Programada** (solo cuando la base de
datos la tiene armada), Publicando, **Publicada** (solo con el identificador
que devuelve la red, y su enlace), Falló (con el motivo y «Reintentar») y
Cancelada.

## 2. Garantías

### No se publica sin aprobar (lo impone la base de datos)

- Una publicación solo está `scheduled` si la pieza está aprobada, su versión
  vigente es la programada, no está archivada, la cuenta está viva y los
  recursos son exportaciones JPEG de **esa pieza y esa versión** (o un vídeo en
  un reel). Si no, está `planned` con `hold_reason`.
- Un disparador sobre `content_items` reevalúa el calendario en cada cambio:
  guardar otra versión, retirar la aprobación o archivar la detiene; reaprobar
  la misma versión la rearma. Si se aprobó una versión nueva, hay que elegir su
  exportación (la de la versión vieja ya no vale).
- Un segundo disparador (`scheduled_publications_guard`) impide pasar a
  `publishing` sin cumplir la regla, para cualquier rol, incluida la clave de
  servicio y el propietario de la base de datos. La clave de servicio, además,
  no tiene privilegio para escribir la tabla a mano.
- El publicador vuelve a comprobarlo al tomar la publicación y **justo antes de
  `media_publish`** (`social_publication_container`), en la misma transacción
  que el cerrojo.

### No se publica dos veces

1. Cola: un trabajo `social.publish` por publicación, generación y hora (clave
   de idempotencia); reclamado con `FOR UPDATE SKIP LOCKED` y una reserva.
2. Cerrojo: la publicación queda `publishing` a nombre de ESE trabajo; otro
   trabajo la encuentra ocupada (`busy`).
3. El contenedor de Instagram se guarda en la base de datos **antes** de
   publicar; en cualquier reintento se mira primero: si está `PUBLISHED` se
   recupera la publicación (por texto y hora) en vez de repetirla.
4. `media_publish` no se reintenta nunca por su cuenta: tras un tiempo agotado
   o un error de red se mira el contenedor.
5. Lo publicado no cambia de estado; una pieza solo se programa una vez (salvo
   cancelada): lo fallido se reintenta sobre la misma fila.

Si Instagram dice que el contenedor ya se publicó pero no aparece la
publicación, la fila queda `failed` con `published_unconfirmed` y el aviso de
comprobarlo en la cuenta; «Reintentar» vuelve a mirar el contenedor, no publica.

### Reintentos, cupo y token

- Errores transitorios (red, 5xx): se reintenta con espera creciente (30 s,
  1 min, 2 min…; 5 intentos) y cada pasada queda en `publication_attempts`.
- Rechazos de la red (imagen, texto, permisos): `failed` sin reintento.
- **Token caducado** (error 190): `failed`, la cuenta pasa a «hay que volver a
  conectarla» y lo programado para ella se detiene. Volver a conectar la misma
  cuenta la rearma.
- **Cupo de publicación**: antes de crear el contenedor se consulta
  `content_publishing_limit` (la documentación da 50 y 100 en sitios distintos:
  manda lo que diga la API). Si está agotado, se aplaza una hora sin gastar
  intentos. La ficha de la cuenta avisa al llegar al 80 %.
- Límite de llamadas de la API (códigos 4, 17, 32, 613): se aplaza 15 minutos.
- Reel: si Instagram aún procesa el vídeo, el trabajo se aplaza un minuto sin
  soltar el cerrojo; a los 30 minutos se da por perdido y se crea otro.

### Comprobación diaria del token

`social-publish` mira una vez al día cada cuenta con `debug_token`: si Meta dice
que ya no vale, la marca como «hay que volver a conectarla»; si tiene fecha de
caducidad, la anota y la interfaz avisa 7 días antes. **Renovar es volver a
conectar**: la documentación de Meta no ofrece refrescar en silencio un token de
usuario, y el token de página (el que publica) no caduca si sale de un token
largo. Las cuentas conectadas con un token pegado (abajo) se comprueban con
`debug_token` sobre el propio token, sin la aplicación del producto.

### Conectar con un token (sin OAuth)

Para cuentas que ya tienen su propia aplicación de Meta y un **token de acceso
de página de larga duración** (por ejemplo, un negocio que ya publica con su
aplicación): en Marca → Datos de la marca → Cuentas conectadas, quien gestiona
la marca pulsa «Conectar con un token» y pega el token y el identificador de la
cuenta de Instagram (IG User ID). `social-connect/token`
(`supabase/functions/_shared/social/token-connect.ts`):

1. comprueba el permiso y el plan con la sesión de quien conecta, igual que al
   empezar el OAuth (`social_oauth_begin`, con su freno de intentos);
2. valida el token contra la Graph API: `debug_token` con el propio token (vale
   aunque sea de otra aplicación de Meta): que es válido, sus permisos
   (`instagram_basic` e `instagram_content_publish` son obligatorios;
   sin `instagram_manage_insights` publica pero no mide) y su caducidad; y
   `GET /{ig-user-id}` con el token, para saber que da acceso a esa cuenta;
3. lo cifra igual que los de OAuth y da de alta la cuenta con
   `social_account_connect_token` (`social_accounts.connection_method = 'token'`).

A partir de ahí publica y mide igual. La interfaz dice que el token sustituye al
OAuth para esa cuenta y que caduca: cuando Meta diga que ya no vale, la cuenta
pasa a «hay que volver a conectarla» y se pega uno nuevo. Solo tokens de
Facebook Login (graph.facebook.com, empiezan por `EAA`); los de «inicio de
sesión de Instagram» (`IG…`) se rechazan con un mensaje claro. Volver a conectar
por OAuth deja la cuenta como `oauth`. Probado solo contra la Graph API simulada.

## 3. Por qué una Edge Function y no el trabajador de medios

Publicar es hablar con la API de Meta (segundos, sin CPU), necesita el secreto
de la aplicación de Meta y la clave de cifrado de los tokens, que viven en las
funciones, y el reloj ya existe (pg_cron → función, como el sondeo de imagen).
El vídeo de un reel no se espera dentro de la función: se aplaza el trabajo. El
trabajador de medios sigue montando los reels; publicarlos es otra cosa.

## 4. Lo que hace falta de Meta

1. **Aplicación de Meta propia del producto** (tipo «Business») en
   developers.facebook.com, con el producto **Facebook Login for Business** y
   una **configuración de inicio de sesión** (su `config_id`) que pida los
   permisos mínimos:
   - `instagram_basic`, `instagram_content_publish` (publicar en Instagram);
   - `pages_show_list`, `pages_read_engagement` (encontrar la página y su cuenta
     de Instagram; la documentación de publicación pide `pages_read_engagement`).
   - Si la persona tiene un rol de Business Manager sobre la página, la
     documentación añade `ads_management` o `ads_read`: comprobarlo con la
     primera cuenta real antes de pedirlo.
2. **URI de redirección** válida: `https://<proyecto>.supabase.co/functions/v1/social-connect/callback`.
3. **Verificación de la empresa** (Business Verification): obligatoria para el
   **acceso avanzado**, que es el que permite conectar cuentas de clientes que
   no tienen un rol en la aplicación. Mientras tanto (acceso estándar), solo
   funcionan las cuentas de personas con rol en la aplicación: sirve para
   probar con una cuenta propia en staging.
4. **Revisión de la aplicación** (App Review) de cada permiso para el acceso
   avanzado: vídeo del flujo de conexión y publicación, política de privacidad
   pública y explicación del uso de cada permiso. Después, la revisión anual de
   uso de datos (Data Use Checkup).
5. Las cuentas de Instagram tienen que ser **profesionales** (empresa o creador)
   y estar unidas a una página de Facebook. Si la página exige autorización de
   publicación (PPA), no se puede publicar hasta completarla.

Fuentes (consultadas el 19/11/2026): publicación de contenido, referencia de
`/{ig-user-id}/media`, `content_publishing_limit`, flujo manual de inicio de
sesión, tokens largos, Facebook Login for Business y niveles de acceso, en
developers.facebook.com.

## 5. Variables y secretos

**Desde la interfaz (recomendado):** un superadministrador las mete en
**Plataforma → Integraciones → Meta (Instagram)**: App ID, App Secret,
`config_id` de Facebook Login for Business, versión de la Graph API y dirección
de la aplicación, y genera ahí la clave de cifrado de los tokens («Generar
clave»; rotar = generar otra: las anteriores se conservan). Se guardan cifradas
en Supabase Vault (migración `20261120010000`), mandan sobre las variables de
abajo y las funciones las leen sin redesplegar (caché de 30 s). «Probar
conexión» pregunta a Meta por la aplicación (`GET /{app-id}` con el token de
aplicación: no publica nada) y comprueba las claves de cifrado. Una clave de
cifrado con la que hay tokens guardados no se puede quitar. Las claves de
cifrado del entorno y las de la base de datos se usan juntas: lo cifrado con
una clave del entorno se sigue descifrando. `SOCIAL_CALLBACK_URL` ya no hace
falta si `SUPABASE_URL` es https: se deduce
(`…/functions/v1/social-connect/callback`).

**O en los secretos de las Edge Functions** (`supabase secrets set …`), como
hasta ahora; nunca en el navegador ni en el repositorio:

| Variable | Para qué |
|---|---|
| `META_APP_ID` | Identificador de la aplicación de Meta |
| `META_APP_SECRET` | Secreto de la aplicación (intercambio del código y `debug_token`) |
| `META_LOGIN_CONFIG_ID` | Configuración de Facebook Login for Business (recomendada; sin ella se pide `scope`) |
| `META_GRAPH_API_VERSION` | Versión de la Graph API; por defecto `v27.0` |
| `SOCIAL_CALLBACK_URL` | `https://<proyecto>.supabase.co/functions/v1/social-connect/callback` (la misma que en Meta) |
| `SOCIAL_APP_URL` | Dirección de la aplicación, para volver tras conectar (p. ej. `https://rrss-omega.vercel.app`) |
| `SOCIAL_ALLOWED_ORIGIN` | Origen permitido (CORS) para empezar la conexión; por defecto, cualquiera |
| `SOCIAL_TOKEN_KEYS` | Claves de cifrado de los tokens: `id:base64` separadas por comas, de 32 bytes (`openssl rand -base64 32`) |
| `SOCIAL_TOKEN_KEY_ID` | La clave con la que se cifra lo nuevo (las demás solo descifran: rotación) |

En el **despliegue de la aplicación** (Vercel): `VITE_SOCIAL_PUBLISHING_ENABLED=true`
permite la publicación en ese despliegue; la interfaz la enseña solo si además
el servidor dice que hay claves de cifrado de los tokens (`platform-integrations`,
acción `availability`, solo booleanos). «Conectar Instagram» (OAuth) sale si
también está la aplicación de Meta; «Conectar con un token», con las claves de
cifrado. Sin ellas no aparecen conectar cuentas ni programar; el calendario se
puede ver.

En **Vault** (como el sondeo de imagen): `rrss_project_url` y
`rrss_service_role_key`. Sin ellos, pg_cron no llama al publicador (deja un
aviso en el registro).

**Solo para la prueba local**: `SOCIAL_E2E_SIMULATED_GRAPH=true` (en
`supabase/functions/e2e.env`) activa la Graph API simulada y una clave de
cifrado fija y pública. La función no arranca con ella si `SUPABASE_URL` no es
un Supabase local (misma guarda que la IA simulada).

> Perder `SOCIAL_TOKEN_KEYS` obliga a volver a conectar todas las cuentas. Al
> rotar, añadir la clave nueva, cambiar `SOCIAL_TOKEN_KEY_ID` y dejar la vieja
> hasta que todas las cuentas se hayan vuelto a conectar.

## 6. Activarlo en staging

1. Aplicar las migraciones `20261119010000` a `20261119040000` (primero en
   staging; la vuelta atrás de cada una está en `supabase/rollbacks/`).
2. Desplegar `social-connect` y `social-publish` (`verify_jwt = false` en
   `config.toml`: la primera recibe la vuelta de Meta sin JWT; la segunda, la
   llamada de pg_cron con la clave de servicio en `apikey`).
3. Crear la aplicación de Meta (sección 4) en modo desarrollo, con la persona
   que va a probar como administradora o probadora de la aplicación y su cuenta
   de Instagram profesional unida a una página.
4. Aplicar la migración `20261120010000` y desplegar `platform-integrations`;
   meter la aplicación de Meta y generar la clave de cifrado en Plataforma →
   Integraciones (o poner los secretos de la sección 5) y, en Vault,
   `rrss_project_url` y `rrss_service_role_key`.
5. Desplegar la aplicación con `VITE_SOCIAL_PUBLISHING_ENABLED=true`.
6. Prueba: conectar la cuenta en Marca → Datos de la marca → Cuentas
   conectadas; crear una pieza, guardarla, exportarla en JPEG a la biblioteca,
   aprobarla y programarla a unos minutos vista; comprobar en la cuenta que sale
   y que el calendario la enseña publicada con su enlace. Repetir con un fallo
   provocado (por ejemplo, retirar el permiso en Meta) y comprobar que no se
   duplica. Esta es la primera vez que el adaptador hablaría con Meta de verdad.

## 7. Límites conocidos

- La imagen exportada la produce el navegador de quien edita (no hay render en
  el servidor): la base de datos comprueba que el recurso dice ser la
  exportación de esa versión (`media_assets.provenance`), pero no puede comprobar
  el dibujo. La ficha del calendario todavía no enseña la imagen elegida (pendiente).
- El vídeo de un reel no sale del documento: vale cualquier vídeo de la marca
  elegido al programar.
- Si se conceden varias cuentas de Instagram en el diálogo de Meta, no se elige
  por la persona: se le pide que conceda solo una.
- Desconectar no retira el permiso en Meta (la persona puede hacerlo desde su
  configuración de Facebook); solo borra el token.
- Sin avisos (correo, notificación) de publicación fallida: se ve en el
  calendario.
- El calendario usa la hora del dispositivo, no la zona horaria de la marca.
