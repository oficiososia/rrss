# Estado del proyecto

Última actualización: 20/11/2026. Rama de trabajo: `claude/focused-noether-hk502p`,
con PR abierto a `staging`. Las ramas `main` y `staging` existen desde el 16/11/2026.
Lo de `f4/integracion` (Integraciones, copiloto por voz y Drive) ya está en la rama
de trabajo y en staging. Rama de integración `f5/integracion` (sin subir): une sobre
la rama de trabajo `f5/almacenamiento-r2` (archivos de la biblioteca en Cloudflare
R2) y `f5/copiloto-arreglos` (arreglos del copiloto por voz); **sin desplegar**.

Resumen: las Fases 1 a 6 están construidas y probadas de extremo a extremo en
local con proveedores **simulados** (IA, Meta, Stripe). Lo que falta para usarlas
de verdad son cuentas y decisiones del dueño, no desarrollo: aplicación de Meta,
proveedor de IA, Stripe, correo y revisión legal. Staging (Supabase gratuito, UE)
tiene las 35 migraciones y todas las funciones desplegadas sin proveedores, y la
aplicación está publicada contra staging en https://rrss-omega.vercel.app,
incluido lo de `f4/integracion` (Integraciones, copiloto por voz y fotos de
Drive), desde el 20/11/2026.

## Pruebas

| Tanda              | Resultado                                                                                                                                                                                                                                                                                  | Qué cubre                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`         | 712 pasan (20/11/2026, rama `f5/integracion`)                                                                                                                                                                                                                                              | Lógica (unitarias) e interfaz contra un Supabase simulado (componentes)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run test:db`  | 730 pasan, 2 omitidas (20/11/2026, rama `f5/integracion`)                                                                                                                                                                                                                                  | Esquema, aislamiento entre organizaciones, permisos, planes, cupos, cola, publicación, campañas, analítica, RGPD, integraciones (Vault, catálogo, disponibilidad, «Probar conexión»), copiloto, biblioteca con Drive, almacenamiento en R2 (firma SigV4 con los ejemplos de Amazon S3, `media-storage` con un cubo en memoria, script de migración), y servicios con proveedores simulados, contra las migraciones reales (PGlite). Las 2 omitidas son de simultaneidad con dos conexiones (pasaron contra Postgres 16 el 16/11/2026) |
| `worker/`          | 81 pasan                                                                                                                                                                                                                                                                                   | Trabajador de medios con FFmpeg real: reels (con desenfoque), recortes, extracción de texto de fuentes, informe PDF, imágenes de Drive por dirección firmada, entradas y resultados en R2 por `media-storage`                                                                                                                                                                                                                                                                                                                         |
| `agency/`          | 37 pasan                                                                                                                                                                                                                                                                                   | Herramienta de la agencia contra un Supabase simulado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run test:e2e` | 83 de 83 en dos tandas completas seguidas (local, 20/11/2026, rama `f5/integracion`, cada una desde cero tras `supabase db reset`). La prueba 21 fallaba en las tandas completas por la imagen de MinIO de Bitnami, que se reinicia al terminar de prepararse; ya se espera a ese reinicio | Navegador (Playwright) contra un Supabase local con las funciones servidas en local, el trabajador real y los proveedores simulados de pruebas (IA, Graph API, Drive, dictado y MinIO como R2): Fases 1 a 6, integraciones, copiloto por voz, Drive y almacenamiento en R2 en 21 archivos                                                                                                                                                                                                                                             |
| CI de GitHub       | `comprobar`, `trabajador`, `agencia` y `e2e`                                                                                                                                                                                                                                               | El trabajo `e2e` levanta su propio Supabase y ejecuta la prueba completa; no bloquea el PR hasta verse estable                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Hecho

### Fase 1 · Núcleo multiempresa

Sesión con confirmación de correo y recuperación de contraseña, organizaciones
(empresa o agencia), asistente de alta de marca, perfil de marca versionado con
exportar e importar, biblioteca, equipo e invitaciones con cinco roles,
aislamiento entre organizaciones, ajustes, actividad y panel de plataforma.

### Fase 2 · Estudio creativo

- **Contenidos y editor por capas** (documento propio v2 + Konva): selección múltiple, alinear, repartir, agrupar, texto sobre el lienzo, guías respecto a otras capas, zonas seguras orientativas por red, vista previa por red, renombrar y cambiar de red; versiones, historial, estados y aprobación.
- **Exportar imagen** (PNG/JPEG) a la biblioteca con procedencia inmutable.
- **Verificador de marca** sin IA (con zonas seguras) y con IA; perfil ampliado (hashtags, llamadas a la acción, emojis).
- **IA de texto e imagen** detrás de adaptadores, con cupo y coste por organización; vídeo con IA apagado por criterio de datos.
- **Reels con plantillas** y **recortes** desde la biblioteca (trabajador con FFmpeg), con cancelar y aviso de peso.
- **Fuentes de marca**: extracción de texto de PDF, Word y webs (con protección SSRF y `robots.txt`) para la propuesta de perfil; **tipografías de marca** en editor, exportación y reels.
- **Modo agencia**: encargos con avisos, entrega desde la herramienta `agency/` o desde la interfaz; el servidor impide la IA de texto en marcas en modo agencia.

### Fase 3 · Calendario y publicación

Cuentas de Instagram por OAuth (tokens cifrados fuera de `public`), calendario
(mes, semana, día y por red) con arrastrar y soltar y aprobación por lotes,
comentarios en la pieza, y publicador `social-publish` (pg_cron cada minuto)
con cerrojo, idempotencia y reintentos: imagen, carrusel y reel. La base de
datos impide publicar lo no aprobado, incluso con la clave de servicio, y que el
plan no incluya publicación. Detalle en `docs/publicacion.md`.

### Fase 4 · Campañas (primera parte)

«Prepara la semana que viene» → plan explicado (observado / datos / hipótesis) →
borradores, nunca aprobados ni publicados; protegido contra instrucciones
maliciosas en fuentes y perfil; en modo agencia el plan lo entrega la agencia.

### Fase 5 · Analítica

Capturas horarias de métricas de Instagram, panel que separa dato de hipótesis y
dice lo que no se puede medir, interpretación con IA opcional e informe mensual
en PDF generado sin intervención. Detalle en `docs/analitica.md`.

### Fase 6 · Planes, facturación y RGPD

- **Planes como datos** (Prueba, Básico, Profesional, Agencia, Enterprise, Heredado) con límites que impone la base de datos, panel de **margen por cliente**, «Configuración → Plan». Stripe (Checkout, portal y webhook) escrito y probado con Stripe simulado. Detalle en `docs/facturacion.md`.
- **RGPD**: páginas legales como plantillas, consentimiento en el registro, descargar mis datos, exportar la organización, borrar cuenta y organización, registro de tratamientos (`docs/rgpd.md`) y etiqueta «Generado con IA» por pieza.

### Plataforma → Integraciones (rama `f4/integraciones`)

Las claves de los servicios se meten desde `/plataforma/integraciones` (solo
superadministradores): Meta (y «Generar clave» de cifrado de los tokens),
ComfyUI propio, IA de texto (proveedor y modelo por tarea, también el del
copiloto), IA de imagen, Stripe y Google Drive.

- Los secretos van a Supabase Vault (migración `20261120010000`); en la tabla
  queda su identificador y una pista. El navegador nunca los recibe; cambios y
  pruebas quedan en la actividad, sin valores.
- Las funciones leen primero lo guardado y, si no está, las variables de entorno
  (`_shared/integrations/settings.ts`, caché de 30 s, sin redesplegar). Lo
  hacen todas las que usan proveedores, incluidas `ai-generate` (también la
  tarea del copiloto) y `drive-media`. Una clave de cifrado con tokens guardados
  no se puede quitar.
- «Probar conexión» con una llamada gratuita por servicio. Ideogram, el secreto
  del webhook de Stripe y el cliente OAuth de Google no se pueden comprobar
  gratis: se dice así (se comprueban con la primera imagen, el primer aviso o
  al conectar).
- Instagram también se conecta pegando un token de página de larga duración
  (Marca → Datos → Cuentas conectadas): se valida con la Graph API y la cuenta
  queda «Con token».
- Interruptores: IA, copiloto, publicación, pago y Drive salen si la variable
  `VITE_*` del despliegue lo permite **y** el servidor dice que la integración
  está configurada (`platform-integrations`, solo booleanos).

### Copiloto por voz del editor (rama `f4/copiloto-voz`)

Botón «Dictar» en el editor: cada frase dictada (Web Speech API, es-ES) se
convierte con la IA de texto (tarea `editor.copilot`, esquema estricto y
saneado) en operaciones de capas (foto de fondo difuminada, logotipo, textos
literales con tipografías y colores del perfil) que se aplican al momento y se
deshacen con un solo Ctrl+Z por orden. El documento pasa a la **versión 3**
(desenfoque de imágenes, también en la exportación y en los reels del
trabajador; migración `20261121010000_reel_media_blur.sql`). Sale con
`VITE_AI_VOICE_COPILOT_ENABLED` + `VITE_AI_TEXT_ENABLED` y la IA de texto
configurada en el servidor. Probado con el proveedor simulado y una Web Speech
API simulada; **sin probar** con un proveedor real ni con el dictado real.
Arreglos de la evaluación sin API (rama `f5/copiloto-arreglos`, en
`f5/integracion`): color de los textos según el uso del color en el perfil y
legible sobre lo que hay debajo (`copilot/legibility.ts`), órdenes relativas
(«sube», «más difuminada»: `move_layer` con `dx`/`dy`) y ambiguas (se preguntan),
órdenes de terceros y logotipo que no pisa textos; cambia la tarea
`editor.copilot` de `ai-generate`. Detalle en `docs/copiloto-voz.md`.

### Almacenamiento en Cloudflare R2 (rama `f5/almacenamiento-r2`, en `f5/integracion`)

Valoración: **sí, con condiciones** (cubo en la UE, DPA de Cloudflare, token solo
para ese cubo, Supabase de respaldo). Con ≈ 3,2 GB a llevar, R2 cuesta 0 $ (10 GB
gratis, salida gratis) frente a no caber en Supabase Free (1 GB, 5 GB de salida) o
25 $/mes en Pro. Cada recurso guarda su almacén (`media_assets.storage_backend`,
migración `20261124010000`, que fija el servidor); la Edge Function `media-storage`
firma lecturas (1 h, tras la RLS), subidas (tipo y tamaño firmados, tras comprobar
que se edita la marca) y borrados. Credenciales en Plataforma → Integraciones →
Cloudflare R2 (Vault) con «Probar conexión» (HeadBucket); sin R2 configurado todo
sigue en Supabase. Lo usan biblioteca, editor, exportación, informes, exportación
RGPD, trabajador (sin credenciales de R2), imágenes con IA, publicación en Instagram
y borrado de organizaciones. Script reanudable `scripts/migrar-a-r2.ts` (en seco por
defecto). No necesita variable `VITE_`: la interfaz pregunta al servidor. Probado
con un S3 local (MinIO); **sin probar contra R2 real** y **sin desplegar**. Pasos
del dueño en `docs/almacenamiento-r2.md` §5.

Alta en la biblioteca de lo copiado desde Drive (rama `f6/alta-biblioteca`):
`scripts/alta-biblioteca.ts` da de alta cada objeto en la marca de su fila del
inventario (mapeo «marca → brand_id» en un JSON de quien lo ejecuta), con carpeta,
etiquetas, nombre legible, dimensiones y procedencia de Drive, en R2; idempotente,
completa huérfanos y tiene `--comprobar`. La copia pasa a
`<org>/<marca>/import/google-drive/` (bajo `…/drive/` la biblioteca no lo admite).
`scripts/crear-marca-agencia.sql` crea una marca en modo agencia (para Touza en
Oficiosos). Recuento en seco: Casa Tomás 239 fotos, Touza 241 fotos y 46 vídeos
(`docs/almacenamiento-r2.md` §4.2). Probado con PGlite; **sin ejecutar** en staging.

### Biblioteca con Google Drive (rama `f4/biblioteca-drive`)

La organización conecta su Google Drive (OAuth, solo lectura, token de refresco
cifrado como los de Meta) y sus marcas añaden a la biblioteca fotos de Drive **sin
copiarlas a Storage**: el recurso guarda el id del archivo y la imagen la sirve la
función `drive-media` con direcciones firmadas, tras comprobar por RLS que quien la
pide ve la marca. Editor, exportación y trabajador de medios la leen por ahí. No
ocupa plan. Migración `20261122010000`; el cliente de Google se configura en
Plataforma → Integraciones → Google Drive (migración `20261123010000`). Sale con
`VITE_DRIVE_LIBRARY_ENABLED` y Drive configurado en el servidor; «Desde Google
Drive», además, con una conexión activa. Probado contra Drive simulado (base de
datos, función y e2e); las fotos HEIC del iPhone no se pueden usar todavía.
Detalle en `docs/biblioteca-drive.md`.

## Sin probar contra el servicio real

| Servicio                                                                                | Estado                                                                              | Detalle                                    |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| IA de texto (Claude por Vertex UE, Bedrock UE, Mistral, Anthropic directo)              | Adaptadores escritos, sin claves                                                    | `docs/ia-texto.md`                         |
| IA de imagen (Vertex UE, FLUX.2, Ideogram, ComfyUI propio) y vídeo (Higgsfield, fal.ai) | Adaptadores escritos, sin claves; vídeo apagado                                     | `docs/ia-medios.md`                        |
| Meta (OAuth, publicación, métricas)                                                     | Adaptador escrito; sin aplicación de Meta                                           | `docs/publicacion.md`, `docs/analitica.md` |
| Stripe                                                                                  | Funciones escritas; sin cuenta                                                      | `docs/facturacion.md`                      |
| Google Drive (OAuth, listar, servir imágenes)                                           | Adaptador escrito; sin cliente OAuth de Google                                      | `docs/biblioteca-drive.md`                 |
| Dictado del navegador (Web Speech API de Chrome)                                        | Probado con una simulada                                                            | `docs/copiloto-voz.md`                     |
| Cloudflare R2 (firmas, subidas, «Probar conexión», migración)                           | Probado con MinIO en local; sin cuenta de Cloudflare                                | `docs/almacenamiento-r2.md`                |
| «Probar conexión» de Integraciones                                                      | Probado con servicios simulados: ninguna llamada real a Meta, Stripe, IA ni ComfyUI | `docs/05-puesta-en-marcha.md`              |

## En staging

Proyecto `zzkdrfhqmjfvrdsoguio`, plan gratuito, región UE:

- 35 migraciones aplicadas (la última, `20261123010000_integrations_drive_copilot`, el 20/11/2026); todas las tablas de `public` con RLS. Organizaciones existentes en el plan «Heredado».
- Funciones desplegadas sin proveedores: `platform-integrations`, `drive-media`, `ai-generate`, `ai-media`, `ai-media-poll`, `ai-media-webhook`, `social-connect`, `social-publish`, `social-insights`, `billing-checkout`, `billing-portal`, `billing-webhook`, `delete-account`, `delete-organization`.
- Plataforma → Integraciones disponible para el superadministrador; ninguna integración configurada todavía.
- pg_cron: `rrss-ai-media-poll` (30 s), `rrss-social-publish` (cada minuto), `rrss-analytics` y `rrss-purge-provisional-assets` (cada hora). Faltan a propósito los secretos de Vault (`rrss_project_url`, `rrss_service_role_key`): sin ellos las llamadas programadas solo dejan un aviso.
- Inicio de sesión con retorno a https://rrss-omega.vercel.app y `localhost:5173`.
- Cuentas: la del dueño (superadministrador), una de prueba y la de la agencia (Gestora de Casa Tomás). Casa Tomás está dada de alta en Oficiosos, en modo agencia, con perfil, logotipos y 25 fotos.
- Interruptores de Vercel encendidos: `VITE_AI_TEXT_ENABLED`, `VITE_AI_IMAGE_ENABLED`, `VITE_SOCIAL_PUBLISHING_ENABLED`, `VITE_AI_VOICE_COPILOT_ENABLED` y `VITE_DRIVE_LIBRARY_ENABLED`; cada módulo sale solo cuando su integración está configurada. Apagados: reels y recortes (sin trabajador alojado) y facturación (sin precios decididos).

## Para usar en staging lo desplegado

1. Drive: cliente OAuth de Google (Drive API, dirección de vuelta
   `…/functions/v1/drive-media/callback`) metido en Plataforma → Integraciones →
   Google Drive, y `SOCIAL_TOKEN_KEYS` («Generar clave» en Meta).
2. Instagram: «Generar clave» en Meta y conectar la cuenta pegando un token, o
   la aplicación de Meta para OAuth.
3. El trabajador de medios, cuando se aloje, con esta versión (desenfoque y
   fotos de Drive).
4. Fotos de Drive: 371 HEIC convertidas a JPEG; 126 subidas junto a su HEIC el
   20/11/2026, el resto pendiente (copia local en
   `codigo-restaurante/drive-jpeg-pendientes`).
5. Para llevar `f5/integracion` a staging (sin variables `VITE_` nuevas):
   - Migración `20261124010000_media_storage_r2.sql` (vuelta atrás en
     `supabase/rollbacks/`).
   - Función nueva `media-storage` (`verify_jwt = false`, ya en `supabase/config.toml`).
   - Volver a desplegar `ai-generate` (copiloto), `platform-integrations`,
     `social-publish`, `ai-media`, `ai-media-poll`, `ai-media-webhook`,
     `delete-account` y `delete-organization` (usan R2). Las demás
     (`billing-checkout`, `billing-portal`, `billing-webhook`, `drive-media`,
     `social-connect`, `social-insights`) solo cambian por el catálogo común de
     integraciones (entrada de R2): conviene redesplegarlas para que todas lleven
     el mismo.
   - Después, la cuenta y el cubo de Cloudflare (`docs/almacenamiento-r2.md` §5)
     y, con el «sí» al recuento, la migración de archivos (560 archivos, ≈ 3,0 GB:
     34 de brand-media, 109 fotos y 46 vídeos de Drive, 371 JPEG convertidos).
   - El trabajador, cuando se aloje, con esta versión (`WORKER_MEDIA_STORAGE=auto`).

## Bloqueado por algo externo

| Qué                                                           | Qué hace falta                                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publicar en Instagram y medir                                 | Aplicación de Meta (tipo Business), verificación de empresa y revisión de permisos; con acceso estándar se puede probar en staging con una cuenta propia                      |
| IA por API                                                    | Cuenta de Google Cloud con Vertex AI en la UE (o la alternativa elegida) y precios confirmados                                                                                |
| Cobrar                                                        | Cuenta de Stripe, moneda, precios por plan y portal configurado                                                                                                               |
| Correo para cualquiera (registro, recuperación, invitaciones) | SMTP propio (Resend u otro); hoy solo llega al equipo de Supabase, 2 por hora                                                                                                 |
| Reels y recortes en staging                                   | Encender el trabajador contra staging o alojarlo (recomendado: Fly.io en Fráncfort)                                                                                           |
| Fotos de Drive en staging                                     | Cliente OAuth de Google (Drive API, pantalla de consentimiento en producción sin verificar)                                                                                   |
| Archivos en Cloudflare R2                                     | Cuenta de Cloudflare, cubo en la UE, regla CORS, token del cubo y DPA firmado (`docs/almacenamiento-r2.md` §5)                                                                |
| Clientes reales                                               | Supabase de producción en Pro (copias de seguridad, sin pausas), dominio propio, páginas legales completadas y revisadas por un abogado, contrato de encargo con cada cliente |

## Decisiones del dueño pendientes

1. Moneda de cuenta, precios y límites de los planes (propuesta en `docs/facturacion.md`) y plan por defecto.
2. Proveedor de IA (por defecto, Google Cloud en la UE) y cupo mensual.
3. Activar el vídeo con IA (por defecto, apagado).
4. Alojamiento del trabajador de medios.
5. Música para los reels y su licencia.
6. Plazos de conservación de datos y revisión legal (`docs/rgpd.md`).
7. **Copiloto por voz en modo agencia (provisional).** `ai-generate` rechaza la IA de texto en marcas en modo agencia, salvo el copiloto por voz (`editor.copilot`), que no redacta: coloca literalmente lo dictado. Decidir si se mantiene, se quita o se hace configurable por marca (`docs/copiloto-voz.md` §4).
8. Decisiones provisionales que se pueden cambiar: una aprobación vale solo para la versión aprobada; quien edita y aprueba puede aprobar sin revisión; cada red es una pieza distinta; los colores fuera de la marca avisan pero no bloquean; aceptar un encargo aprueba la versión entregada; logotipos provisionales se borran a las 48 h.
9. Pasar los archivos a Cloudflare R2: crear la cuenta y dar el «sí» al recuento de la migración (`docs/almacenamiento-r2.md`).

## Pendientes conocidos

- Bajar a un plan sin publicación no detiene lo ya programado.
- Publicación: sin historias de Instagram, sin Facebook, el calendario usa la hora del dispositivo, renovar el token es volver a conectar.
- Si la conexión con Meta falla sin saber la marca, no sale aviso.
- El plan «Prueba» dice «sin IA» pero muestra «Texto con IA (incluido)» (su cupo es 0).
- Exportar en el servidor (el editor exporta en el navegador).
- Sin reconocimiento de texto en escaneos ni imágenes; los reels no usan tipografías .woff.
- Editor: sin ajuste a guías al mover varias capas; zonas seguras solo para 9:16 y orientativas.
- Fase 4: lotes, coordinador y automatizaciones.
- Avisos de encargos por sondeo (60 s), sin tiempo real ni correo.
- El trabajador usa la clave de servicio; falta un rol de Postgres limitado.
- Variables nuevas sin llevar a `.env.example` (documentadas en `docs/`), entre ellas `VITE_AI_VOICE_COPILOT_ENABLED`, `VITE_DRIVE_LIBRARY_ENABLED`, `AI_TEXT_EDITOR_COPILOT_*` y las de Drive.
- Copiloto por voz: el dictado de Chrome envía el audio a Google (ya en `docs/rgpd.md`; falta en la política de privacidad y un aviso antes del primer dictado); la pantalla de reels no ofrece todavía el desenfoque que el plan ya admite.
- Integraciones: tokens de «inicio de sesión de Instagram» (IG…) no admitidos; el vídeo con IA sigue solo por variables.

## Siguiente paso

1. Probar en https://rrss-omega.vercel.app el primer encargo real de Casa Tomás (post del chuletón) y el resto de pantallas con datos reales.
2. El dueño crea la aplicación de Meta, la cuenta de correo y, si quiere IA por API, Google Cloud.
3. Con la aplicación de Meta: conectar la cuenta de Instagram de Casa Tomás en staging y publicar una pieza aprobada.
