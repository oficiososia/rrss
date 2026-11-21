# Dónde alojar el trabajador de medios (guía para el dueño)

Guía del 21/11/2026, con el código ya preparado el mismo día (rama `f11/fly-trabajador`): `worker/fly.toml`, el despertador en la base de datos, la integración en Plataforma → Integraciones y dos alternativas de despliegue (GitHub Actions y un script local). **No se ha contratado nada, no hay cuenta de Fly y nada está desplegado ni aplicado en staging.** Los precios se consultaron en las webs oficiales que se citan; lo que no se pudo confirmar va como **NO CONFIRMADO** y las cifras de cálculo propio como *estimación*. Precios sin IVA. Para convertir se usa 1 € ≈ 1,10 $ (supuesto redondo, no consultado).

Documentos relacionados: `worker/README.md` (el trabajador por dentro),
`docs/ESTADO.md` («Reels y recortes en staging», decisión 4),
`docs/almacenamiento-r2.md`, `docs/servidor-gpu.md`.

---

## 1. Resumen

1. **Qué hay que alojar:** el trabajador de medios (`worker/`), un programa con FFmpeg que monta los reels, hace los recortes de fotos, extrae el texto de documentos (PDF, Word, webs) y genera el informe mensual en PDF.
2. **Por qué hace falta:** eso no cabe en las funciones de Supabase (límite de unos 2 s de CPU por petición y sin FFmpeg). Sin alojarlo, «Reels» y «Recortes» siguen apagados (`VITE_MEDIA_WORKER_ENABLED`) y la extracción de documentos y el informe PDF se quedan en la cola sin ejecutarse.
3. **Dónde lo recomendamos:** Fly.io, una máquina bajo demanda en Fráncfort (`fra`). Se enciende cuando hay trabajo, vacía la cola y se apaga sola; solo se paga el rato que trabaja.
4. **Coste al mes** con el volumen de arranque (5-10 marcas, unos 100 reels y 100 recortes): **menos de 1 $ al mes** (*estimación*, ver §3). Fly no cobra facturas personales de menos de 5 $ al mes, según su documentación. Hace falta tarjeta.
5. **Qué falta para usarlo:** el código está hecho (§4, «Estado del código»). Falta lo del dueño (cuenta, tarjeta, desplegar desde el panel de Fly y pegar token, app y máquina en Integraciones), aplicar la migración en staging y, para producción, un rol de Postgres limitado en lugar de la clave de servicio (§5).

---

## 2. Comparativa de opciones

| Opción | Coste al mes (volumen de arranque) | ¿Se apaga sola? | Región UE | Esfuerzo |
| --- | --- | --- | --- | --- |
| **Fly.io, máquina bajo demanda (recomendada)** | < 1 $ (*estimación*; precios confirmados abajo) | Sí: al vaciar la cola el proceso sale y la máquina se para | Sí, Fráncfort (`fra`) | Bajo-medio: `fly.toml` y despertador por `pg_net` |
| Google Cloud Run Jobs | **NO CONFIRMADO** (la página oficial no se pudo leer entera hoy). Sería de céntimos, y el plan gratuito de Cloud Run suele cubrir este volumen | Sí | Sí (Bélgica, Países Bajos, Fráncfort, según región) | Medio-alto: para arrancar un job por API hace falta un token de Google, es decir, una Edge Function intermedia |
| Railway | Plan Hobby: 5 $ al mes con 5 $ de uso incluidos; el uso se cobra a 0,00000772 $ por vCPU-segundo y 0,00000386 $ por GB-segundo. Encendido siempre en modo `continuous`: unos 5 $ (*estimación*) | No por defecto (modo `continuous`) | Sí, Ámsterdam (`europe-west4-drams3a`) | Bajo: no hay que despertar nada |
| Render | Precios de instancias y de trabajadores en segundo plano **NO CONFIRMADOS** (la página no mostró los datos). Un cron job tiene un mínimo de 1 $ al mes por servicio | No (un trabajador siempre encendido se cobra entero) | Fráncfort existe, **NO CONFIRMADO** hoy | Bajo, pero se paga todo el mes |
| VPS en Hetzner | CPX12 (1 vCPU, 2 GB) 11,99 €, o CPX22 (2 vCPU, 4 GB) 19,99 € al mes en Núremberg, 20 TB de tráfico incluido | No: siempre encendido | Sí (Falkenstein, Núremberg, Helsinki) | Alto: hay que mantener el servidor (actualizaciones, vigilar que siga vivo) |

Fuentes (todas consultadas el 21/11/2026): Fly.io <https://docs.fly.io/about/pricing>; Hetzner <https://www.hetzner.com/cloud/regular-performance/>; Railway <https://railway.com/pricing> y <https://docs.railway.com/reference/regions>; Render <https://render.com/docs/cronjobs>; Google Cloud <https://cloud.google.com/run/pricing> (no legible entera).

**Por qué Fly.io.** Es la única opción de las cinco que a la vez (a) se apaga sola, (b) está confirmada en la UE y (c) se puede despertar con una llamada HTTP que la propia base de datos puede hacer sin un intermediario. Las alternativas que se quedan siempre encendidas (Railway, Render, VPS) cuestan entre 5 y 20 € al mes por una tarea que trabaja unas pocas horas al mes. Cloud Run Jobs sería la segunda opción, pero obliga a escribir una Edge Function para obtener el token de Google.

---

## 3. Cuánto cuesta Fly.io con el volumen de arranque

Precios de Fly (<https://docs.fly.io/about/pricing>, 21/11/2026), facturados en dólares:

| Concepto | Precio |
| --- | --- |
| shared-cpu-1x 1 GB, Fráncfort, 30 días encendida | 7,73 $ (en Ashburn: 6,70 $) |
| shared-cpu-2x 2 GB, Ashburn, 30 días encendida | 13,39 $ |
| Máquina parada: solo se cobra el disco raíz | 0,15 $ por GB al mes |
| Tráfico de salida (UE y Norteamérica) | 0,02 $ por GB |
| Cuota de plataforma | Ninguna; sin nivel gratuito |
| Facturas personales de menos de 5 $ al mes | Se perdonan (según la documentación; confirmarlo al crear la cuenta) |

Fly no publica el precio de `shared-cpu-2x` en Fráncfort. Si se aplica la misma subida que en la de 1 GB (7,73 / 6,70 = +15 %), saldría a unos 15,45 $ al mes encendida todo el mes, es decir, **unos 0,02 $ por hora** (*estimación*).

Cálculo (*estimación*): en el contenedor, con 2 CPU, un reel de 10 s tardó 8,4 s en total (`worker/README.md`, «Tiempos medidos»). Con vídeos reales de móvil, más largos, se supone **30 s por trabajo más 10 s de arranque**:

- 200 trabajos al mes × 40 s = 8.000 s, unas 2,2 h de máquina → **~0,05 $**.
- Disco raíz de la imagen parada, unos 0,35 GB × 0,15 $ → **~0,05 $**.
- Texto de documentos, informes PDF y despertares de respaldo del cron: de céntimos.

Aunque se multiplicara por diez, quedaría por debajo de 1 $ al mes. Lo único que no se puede estimar bien hoy es la duración de los vídeos de móvil reales (4K, HEVC, varios minutos): el README lo marca como «falta medir».

---

## 4. Paso a paso con Fly.io

Pone «**Dueño**» lo que solo puede hacer él y «**Claude**» lo que hace Claude. **Nada está contratado ni desplegado todavía.**

**Estado del código (rama `f11/fly-trabajador`, 21/11/2026):**

| Pieza | Estado |
| --- | --- |
| `worker/fly.toml` | Implementado. Sin probar en Fly (no hay cuenta) |
| Despertador en la base de datos (`private.media_worker_wake()`, disparador, cron cada 2 min; migración `20261208010000_media_worker_wake.sql` con su vuelta atrás) | Implementado y probado con pg_net simulado (`tests/db/trabajador-despertador.test.ts`). **Sin aplicar en staging** |
| Integración «Trabajador de medios (Fly.io)» en Plataforma → Integraciones, con «Probar conexión» | Implementado y probado con la API de Fly simulada. Sin probar contra Fly |
| GitHub Actions (`.github/workflows/worker-fly.yml` y `worker-fly-preparar.yml`) | Alternativa. **No se ha ejecutado** |
| `worker/scripts/fly-preparar.mjs` | Alternativa local con `flyctl`. Solo probado en modo «solo enseñar» |

**Por qué no se usa `flyctl` en el ordenador del dueño:** Windows (Control de aplicaciones / Smart App Control) bloquea `fly.exe` («Una directiva de Control de aplicaciones bloqueó este archivo»). No se toca esa configuración de seguridad. El camino principal es el panel web de Fly («Deploy from GitHub»), que construye en los servidores de Fly.

### 4.1 Qué token hace falta (y por qué ese)

Según la documentación de Fly (<https://docs.fly.io/security/tokens>, consultada el 21/11/2026), los tokens son:

| Token | Alcance | ¿Arranca máquinas? |
| --- | --- | --- |
| **Deploy (de una app)** | Una sola app y sus recursos | **Sí**: es el que usan los ejemplos de la API de máquinas (<https://docs.fly.io/machines/api/working-with-machines-api>, «capaz de gestionar la aplicación») |
| SSH (de una app) | Solo SSH | No |
| Machine-exec (de una app) | Solo ejecutar un comando concreto dentro de las máquinas | No (no documentado para arrancar) |
| Org (deploy de la organización) | Todas las apps de la organización, y crear apps | Sí, pero sobra permiso |
| Readonly (de la organización) | Solo lectura | No |

**Elegido: un token de despliegue de la app del trabajador**, el de menor permiso documentado que puede arrancar su máquina. Fly no documenta ninguno más estrecho. Ojo con lo que permite: con él se podría desplegar otra imagen en esa app, que tendría sus secretos (la clave de Supabase). Por eso: caducidad, guardado solo en Vault (cifrado) y rotarlo al caducar. **NO CONFIRMADO** contra Fly que arranque la máquina (la documentación no lo dice con esas palabras): lo confirma el «Probar conexión» y el primer reel.

Para **crear la app** desde GitHub Actions hace falta, una sola vez, un token de organización; con el panel de Fly no hace falta ninguno (el panel crea la app).

### 4.2 Camino principal: el panel de Fly («Deploy from GitHub»)

**Antes (Claude/coordinador):** el panel lee el código de GitHub, así que `worker/fly.toml` tiene que estar en la rama que se elija. Hoy está en `f11/fly-trabajador`; hay que integrarla en `claude/focused-noether-hk502p` (o en `staging`) y subirla antes de que el dueño despliegue.

**Dueño, clic a clic** (la pantalla de Fly puede cambiar de nombres; lo importante son los valores):

1. **Cuenta y tarjeta.** <https://fly.io> → crear la cuenta (correo de Oficiosos) → *Billing* → tarjeta. Sin tarjeta Fly solo da una prueba corta. Claude no escribe datos de tarjeta.
2. **Conectar GitHub.** En el panel, *Launch an App* / *Deploy from GitHub* → *Connect GitHub* → autorizar la aplicación de Fly **solo** en el repositorio `restcasatomascrevillent/rrss` (no en todos).
3. **Repositorio y rama.** Repositorio `restcasatomascrevillent/rrss`; rama `claude/focused-noether-hk502p` (o `staging` cuando esté integrado allí).
4. **Directorio y configuración.**
   - *Current Working Directory* (directorio de trabajo): `worker`
   - *Config path* (ruta de la configuración), si la pide: `fly.toml` — relativa al directorio de trabajo. **No** `worker/fly.toml`: buscaría `worker/worker/fly.toml` (fallo conocido en el foro de Fly).
   - Con eso Fly usa nuestro `fly.toml` tal cual. **Si propone generar archivos nuevos** (una rama `flyio-new-files`, un `Dockerfile` o un `fly.toml` suyo), es que no ha encontrado el nuestro: revisar el directorio, no aceptar.
5. **Nombre de la app:** `rrss-worker` (el de `fly.toml`). Si está cogido en Fly, usar otro (p. ej. `rrss-worker-oficiosos`) y avisar a Claude para cambiarlo también en `fly.toml`. Organización: la personal.
6. **Región, tamaño y puertos.** Región **Frankfurt (`fra`)**. Tamaño **shared-cpu-2x, 2 GB** (si lo pregunta; ya viene en `fly.toml`). **Sin puerto ni servicio HTTP**: si pide un puerto interno, dejarlo vacío o quitar el servicio; el trabajador no escucha en ningún puerto. Sin base de datos ni Redis.
7. **Secretos** (en el formulario si tiene apartado de *Secrets* / *Environment variables*; si no, después en la app → *Secrets*). Exactamente dos, como **secretos** (no como variables a la vista):

   | Nombre | Valor | De dónde sale |
   | --- | --- | --- |
   | `SUPABASE_URL` | `https://zzkdrfhqmjfvrdsoguio.supabase.co` | Es la de staging (no es secreta) |
   | `SUPABASE_SERVICE_ROLE_KEY` | La clave secreta de staging, la que empieza por **`sb_secret_`** | Supabase → proyecto de staging → *Project Settings* → *API Keys* → *Secret keys* → la `default` → revelar y copiar. Es la misma que usan las funciones del proyecto; la `service_role` antigua (JWT, empieza por `eyJ`) **no**: `media-storage` la rechazaría |

   Nada de R2: con `WORKER_MEDIA_STORAGE=auto` las claves de Cloudflare se quedan en Supabase. Si el dueño prefiere no copiarla él, Claude puede obtenerla con el token de rrss y dejarla en el portapapeles sin mostrarla, para que solo la pegue.
8. **Desplegar** y mirar la construcción en directo. Lo esperado: construye la imagen de `worker/Dockerfile`, crea **una** máquina en `fra`, el trabajador arranca, ve la cola vacía, espera 30 s y sale con código 0; la máquina queda **parada** (*stopped*). Eso es lo correcto, no un fallo. Si el panel creara dos máquinas, se borra una en *Machines* (o se deja: parada solo cuesta el disco).
   - Si el primer despliegue se hizo sin secretos, la máquina falla al arrancar (falta `SUPABASE_URL`): poner los secretos y volver a desplegar.
   - Despliegue automático al subir cambios: la app → *Deployments* → *Settings* → activar y elegir la rama. Mejor activarlo solo en `staging` y no a la vez que el flujo de GitHub Actions (se desplegaría dos veces).
9. **Token para despertarla.** La app → *Tokens* → crear un token **de despliegue de esa app** (no de la organización), nombre `rrss-despertador`, caducidad 6 meses si deja elegir. Copiarlo (empieza por `FlyV1 fm2_`). No pegarlo en el chat.
10. **App y máquina.** La app → *Machines*: anotar el **ID** de la máquina (14 caracteres, p. ej. `148e21dc7d0189`) y el nombre de la app.
11. **Pegarlos en rrss.** En la aplicación de staging, *Plataforma → Integraciones → Trabajador de medios (Fly.io)*: App, ID de la máquina y Token → Guardar → **Probar conexión**. Debe decir «la máquina existe (estado «stopped», región fra) y el token sirve para esa app». Si avisa de reinicio, región o puertos, revisar el paso 4-6.

Fuentes de este apartado (21/11/2026): campos «Current Working Directory» y «Config path» del panel, <https://community.fly.io/t/launch-ui-better-monorepo-support-and-custom-config-file-names/22181>; la ruta de configuración relativa al directorio de trabajo, <https://community.fly.io/t/how-to-correctly-deploy-a-monorepo-application-from-the-root-directory/25592> y <https://docs.fly.io/launch/monorepo>; «si el repositorio tiene el fly.toml de la app, lo despliega tal cual» y el despliegue automático por rama, <https://community.fly.io/t/experimental-deployments-api/29107> y <https://community.fly.io/t/auto-deploy-on-push-to-github/22306>. La documentación oficial no describe la pantalla campo a campo ni si tiene apartado de secretos: **NO CONFIRMADO** hasta verla.

**Claude, con el «sí» del dueño:** aplicar la migración `20261208010000_media_worker_wake.sql` en staging (`zzkdrfhqmjfvrdsoguio`; producción solo cuando lo pida el dueño), desplegar la función `platform-integrations` (para el «Probar conexión» nuevo) y, cuando el trabajador esté probado, encender `VITE_MEDIA_WORKER_ENABLED` en el proyecto `rrss` de Vercel (entorno de staging) con un despliegue nuevo.

### 4.3 Cómo se despierta (ya implementado)

- Al encolar un trabajo del trabajador (`media.*` o `source.extract`) que ya toca ejecutar, un disparador por sentencia sobre `public.jobs` llama a `private.media_worker_wake()`.
- La función comprueba que hay algo reclamable y que **ningún** trabajo del trabajador tiene la reserva viva (si lo tiene, la máquina ya está en marcha y su bucle recogerá lo nuevo). Lee el token, la app y la máquina de **Plataforma → Integraciones** (y, si faltan, de los secretos sueltos de Vault `rrss_fly_api_token`, `rrss_fly_app`, `rrss_fly_machine_id`, que deja el script alternativo) y hace con `pg_net` `POST https://api.machines.dev/v1/apps/{app}/machines/{id}/start`. El token «FlyV1 …» va tal cual en `Authorization`.
- **Idempotencia:** como mucho una llamada cada 10 s (fila de estado con `FOR UPDATE SKIP LOCKED`); si la máquina ya estaba arrancada, Fly responde con un error que nadie lee y no pasa nada; `claim_jobs` reparte cada trabajo a un solo trabajador.
- Sin configuración, sin Vault o sin `pg_net`: solo un aviso (`raise warning`) y no llama a nada. Un fallo al despertar **nunca** impide encolar.
- **Cron de respaldo** `rrss-media-worker-wake` cada 2 minutos: cubre llamadas perdidas de `pg_net`, reintentos con espera y trabajos devueltos al apagar.
- Si la máquina se destruye y se vuelve a crear, cambia el ID: se pega el nuevo en Integraciones.

### 4.4 Alternativa: GitHub Actions

Para cuando no se quiera usar el panel de Fly. No hace falta `flyctl` en ningún ordenador.

- **Crear la app y sus secretos** (una vez): flujo **«Trabajador de medios · preparar Fly.io»** (`.github/workflows/worker-fly-preparar.yml`, solo a mano). Pide dos secretos del repositorio que el dueño pega en GitHub → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*: `FLY_ORG_TOKEN` (token de la organización, panel de Fly → *Tokens*, caducidad corta) y `WORKER_SUPABASE_SERVICE_ROLE_KEY` (la `sb_secret_…`). Los pasa a Fly por la entrada estándar sin imprimirlos. **En cuanto termine, borrar los dos de GitHub.**
  - **Lo más seguro** es no usar este flujo para la clave: ponerla directamente en el panel de Fly (la app → *Secrets*), y así nunca pasa por GitHub.
- **Desplegar:** flujo **«Trabajador de medios · Fly.io»** (`.github/workflows/worker-fly.yml`): *Actions* → el flujo → *Run workflow*. Usa el secreto `FLY_API_TOKEN` (un token de despliegue de la app, panel de Fly → la app → *Tokens*). Despliega con `superfly/flyctl-actions/setup-flyctl` fijado por commit (etiqueta 1.6) y `flyctl` 0.5.5. Al subir cambios de `worker/` a `staging` solo despliega si la variable del repositorio `FLY_DEPLOY_FROM_ACTIONS` vale `true` (apagado por defecto, para no duplicar con el panel). Al final lista las máquinas (ID, región, estado) para copiarlas a Integraciones.

### 4.5 Alternativa: script local (`worker/scripts/fly-preparar.mjs`)

Solo donde `flyctl` sí se pueda ejecutar y esté autenticado (`flyctl auth login`). No es necesario.

```bash
node worker/scripts/fly-preparar.mjs             # solo enseña lo que haría (por defecto)
node worker/scripts/fly-preparar.mjs --aplicar   # crea la app, secretos, despliega, token → Vault de staging
```

Con `--aplicar`: crea la app si no existe; pide la clave secreta de staging a la API de gestión de Supabase con el token de rrss (`~/.supabase-rrss/token`) y elige la que usan las funciones comparando huellas SHA-256 (si no puede, la `sb_secret_…`); la pasa a `flyctl secrets import --stage` por la entrada estándar; despliega con `--remote-only --ha=false --smoke-checks=false`; crea un token de despliegue de la app (`--expiry 4320h`) y guarda token, app y máquina en el Vault de staging (`rrss_fly_*`). No imprime ni guarda la clave ni el token.

### 4.6 Ajustes de `worker/fly.toml` respecto al borrador anterior

- `[[restart]] policy = "never"`: el borrador ponía `"no"`, que **no** es un valor de `fly.toml` (admite `"always"`, `"never"` y `"on-failure"`, el de por defecto; <https://docs.fly.io/reference/configuration>).
- `kill_signal = "SIGTERM"` explícito (Fly manda SIGINT por defecto; el trabajador atiende los dos) y `kill_timeout = 30`.
- `WORKER_IDLE_EXIT_MS = "30000"` (antes 10 s): recoge lo que llegue justo detrás y evita que el despliegue tome por fallo un proceso que sale enseguida. Coste extra: céntimos al año.
- `swap_size_mb = 1024`: margen de memoria para FFmpeg con vídeos grandes, además de los 2 GB.
- Sin `[http_service]` ni `[[services]]`: ningún puerto.

### 4.7 Cómo comprobar que funciona con un reel de prueba

1. **«Probar conexión»** en Integraciones (paso 11): la máquina existe, parada, en `fra`.
2. **Un reel real.** Con `VITE_MEDIA_WORKER_ENABLED` encendido en staging, *Biblioteca → Reels* con una marca de prueba, 2-3 fotos, plantilla `fundido-suave`, un texto corto, «Montar reel».
3. **Qué se debe ver:** en segundos la máquina pasa a *started* en el panel de Fly (como mucho en 2 minutos, por el cron); el reel pasa de «en cola» a «montándose» y a «listo» (la pantalla se actualiza cada 4 s), aparece en la carpeta «Reels» y se reproduce en vertical. En el panel de Fly → *Logs*, una línea `job.attempt` con `succeeded`; unos 30 s después, la salida con código 0 y la máquina otra vez *stopped*.
4. **Si no arranca:** en Supabase, `select * from net._http_response order by id desc limit 5` muestra la respuesta de Fly (401/403 = token; 404 = app o máquina). Si no hay filas, mirar los avisos `media_worker_wake` en los registros de Postgres.
5. **Recorte, extracción de PDF e informe:** igual que antes (el recorte aún no tiene pantalla en la aplicación).

Sigue sin estar probado contra Supabase de staging (README del trabajador, tabla «Estado»): el primer intento puede sacar algún fallo.

---

## 5. Seguridad: la clave de servicio del trabajador

Hoy el trabajador arranca con `SUPABASE_SERVICE_ROLE_KEY`, que se salta la seguridad por filas (RLS) de **toda** la base de datos. Si alguien robara el secreto de Fly, o un fallo en el procesamiento de un PDF o un vídeo malicioso diera control del proceso, podría leer o borrar datos de cualquier marca. Está apuntado en `docs/ESTADO.md`, «Pendientes conocidos». Hoy lo atenúa que cada ruta de entrada y salida se comprueba contra la organización y la marca del trabajo (`assertJobPath`), pero eso defiende al propio trabajador, no al secreto si se filtra.

**Propuesta: un rol de Postgres limitado (`rrss_worker`).** El trabajador no necesita más que:

- las funciones de la cola: `claim_jobs`, `complete_job`, `fail_job`, `release_job` y `extend_job_lease`;
- leer y escribir en el cubo `brand-media` de Storage, y llamar a la función `media-storage` cuando hay R2 (esa llamada también hoy lleva la clave de servicio);
- nada más: ninguna tabla directa. Los efectos laterales (crear el recurso en la biblioteca, mover el texto extraído a la fuente) ya los hacen disparadores `SECURITY DEFINER` en la misma transacción que `complete_job`, justo para que el trabajador no necesite más permisos.

Cómo hacerlo:

1. Migración nueva (con vuelta atrás y pruebas en `tests/db/aislamiento.test.ts`): rol `rrss_worker` sin `BYPASSRLS`, `GRANT EXECUTE` solo en esas cinco funciones (hoy solo `service_role` las tiene) y políticas de Storage mínimas para el cubo.
2. Que el trabajador use una clave de ese rol en lugar de la de servicio: un token firmado con el rol `rrss_worker`. **Hay que comprobar antes** que el proyecto de Supabase admite tokens con un rol propio (depende de si usa claves antiguas con secreto JWT o claves nuevas asimétricas, y Supabase las está cambiando).
3. **Alternativa si no se puede (B):** una Edge Function `worker-gateway` que pida un token propio del trabajador (guardado como secreto, comparado con tiempo constante), exponga solo esas cinco operaciones y firme direcciones de Storage restringidas a las rutas del trabajo. Así el trabajador no recibiría ninguna clave de Supabase. Es más trabajo, pero no depende de cómo evolucione el sistema de claves.

Esfuerzo: opción del rol, **1 día** (migración, rollback, pruebas, cambio en `worker/src/supabase.ts` y rotar la clave); opción del intermediario, **2-3 días**.

Recomendación: para staging, arrancar ya con la clave de servicio (es una demo con datos de prueba y se rota al terminar); **para producción, no sin el rol limitado**. Mientras tanto: el token de Fly con caducidad corta, el secreto solo en Fly, rotar la clave de servicio de staging cuando se termine de probar, y no abrir ningún puerto en la máquina (el diseño ya no abre ninguno).

---

## 6. Trabajo de código pendiente (resumen)

| Qué | Estado | Esfuerzo (estimación) |
| --- | --- | --- |
| `worker/fly.toml` | **Hecho** (21/11/2026), sin probar en Fly | — |
| Despertador (`pg_net` a la API de Fly, disparador, cron cada 2 min, rollback, pruebas) | **Hecho** y probado con pg_net simulado; sin aplicar en staging | Aplicarlo: minutos, con el «sí» |
| Integración «Trabajador de medios (Fly.io)» con «Probar conexión» | **Hecho**, probado con Fly simulado; falta desplegar `platform-integrations` en staging | Minutos, con el «sí» |
| Despliegue por GitHub Actions y script local | **Hecho** como alternativa, sin ejecutar | — |
| Rol de Postgres limitado (o intermediario) en lugar de la clave de servicio | **No existe** | 1 día (rol) o 2-3 días (intermediario) |
| Probar el trabajador contra staging real | **Sin probar** (README) | 0,5 día con el dueño delante |
| Pantalla de Recortes en la aplicación | Falta en la aplicación (la base de datos ya acepta el encargo) | No incluido aquí |
| `media.document.export` (documento por capas a imagen) | Sin implementar | No incluido aquí |
| Variables nuevas en `.env.example` | Pendiente (ESTADO.md) | 0,5 h |

Para dejar **staging funcionando** falta el rato del dueño (cuenta, tarjeta, panel de Fly, token) y aplicar la migración. **Producción:** además, 1 día del rol limitado.

---

## 7. Opcional: si en el futuro hace falta GPU

Hoy **no hace falta**: `docs/servidor-gpu.md` recomienda todo por API (40-50 $ al mes) y solo propone GPU propia al pasar de unos 100 $ al mes de imagen o cuando se quiera ampliar fotos. El trabajador de FFmpeg y la GPU son piezas **independientes**:

- El trabajador de medios sigue en Fly sin GPU (FFmpeg monta bien los reels en CPU; el reel de 10 s tardó menos de 10 s).
- La GPU sería **otro** servicio (ComfyUI en RunPod u OVH AI Deploy en la UE, sin servidor fijo, según §4 del estudio de GPU), al que la aplicación ya habla por la Edge Function `ai-media` y su adaptador, sin pasar por el trabajador.
- Si algún día un trabajo de vídeo necesitara GPU (por ejemplo, subir de escala con IA), se añadiría como otro tipo de trabajo en la cola, con su propio alojamiento, sin tocar el despertador del trabajador de CPU.
- Un servidor Hetzner encendido (el estudio calcula 214 € al mes como mínimo para GPU) solo compensa con mucha carga continua; no se mezcla con esta decisión.
