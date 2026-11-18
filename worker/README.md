# Trabajador de medios

Proceso que consume la cola de trabajos de Postgres (`public.jobs`) y hace lo
que no cabe en una Edge Function: procesar imágenes y montar vídeo con FFmpeg.
Es un paquete propio (`worker/`), con sus dependencias y sus pruebas, y no
depende de ningún alojamiento: es un contenedor que arranca, vacía la cola y
termina.

## Estado

| Qué                                                                     | Estado                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bucle (reclamar, ejecutar, cerrar, reintentos, apagado ordenado)        | Implementado y probado contra la cola real (PGlite) y contra una cola en memoria                                                                                                       |
| `media.image.process` — imagen a las proporciones de las redes          | Implementado y probado con archivos reales                                                                                                                                             |
| `media.reel.template` — reel vertical por plantilla                     | Implementado y probado con archivos reales, también dentro del contenedor                                                                                                              |
| `media.video.derivatives` — póster, versión comprimida, otra proporción | Implementado y probado con archivos reales                                                                                                                                             |
| `media.report.pdf` — informe mensual de analítica en PDF (pdf-lib, MIT) | Implementado y probado (pdf-lib de verdad); el circuito completo, contra las migraciones reales (`tests/db/analitica-informe.test.ts`). Ver `docs/analitica.md` |
| `media.document.export` — documento por capas a imagen                  | **Sin implementar.** Solo el punto de enganche (`src/handlers/document-export.ts`), sin registrar: el trabajador no reclama ese tipo y nada lo simula                                  |
| Adaptadores de Supabase (cola por PostgREST, archivos por Storage)      | Implementados; probados contra un servidor HTTP local. Contra el stack local: probados de extremo a extremo (`tests/e2e/11-reels.spec.ts`, 18/11/2026). Contra staging, **sin probar** |
| Encargo desde la aplicación (`request_media_job`)                       | Implementado y probado contra las migraciones reales (PGlite): permisos, carga restringida, rutas de la marca, tope de trabajos activos                                                |
| Resultado a la biblioteca (`media_assets` con procedencia)              | Implementado (disparador al completar) y probado, también con el bucle real de este trabajador contra la cola SQL                                                                      |
| Tope de 50 MB por archivo subido                                        | Implementado: un resultado mayor falla sin reintento y con el motivo, antes de subir                                                                                                   |
| Disparo desde la base (`pg_net` + `pg_cron`)                            | **Solo documentado** (más abajo). Depende del alojamiento, que no está decidido                                                                                                        |
| Despliegue                                                              | **Bloqueado**: el dueño no ha elegido alojamiento                                                                                                                                      |

Los reels los encarga la aplicación (pantalla «Reels» de la biblioteca) con
`request_media_job`, y el resultado aparece en la biblioteca de la marca. Ver
«De la aplicación a la biblioteca», más abajo.

## Ejecutarlo en local

Hace falta Node ≥ 22.18 (ejecuta el TypeScript tal cual, sin compilar) y
`ffmpeg`/`ffprobe` en el PATH. La suite completa pasa con FFmpeg 5.1 (Debian),
8.1 (Alpine, la del contenedor) y 9.0 (Windows); la de CI (Ubuntu) queda entre medias.

```bash
cd worker
npm ci
npm run typecheck
npm test              # todas las pruebas (lanzan FFmpeg de verdad; 1–2 min)
npm run test:reel     # solo el reel por plantilla
```

**Un trabajo a mano, sin cola ni Supabase**, contra una carpeta que hace de
cubo (misma forma que el cubo: `<org>/<marca>/<carpeta>/<archivo>`):

```bash
node src/cli.ts media.reel.template carga.json --storage ./medios --org org --brand marca
```

Imprime el resultado y los tiempos. Vale también para `media.image.process` y
`media.video.derivatives`.

**El trabajador completo** (necesita un proyecto de Supabase con la migración
de la cola; ver variables más abajo):

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm start                 # vacía la cola y sale
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… WORKER_MODE=continuous npm start
```

**Contra Supabase, con la clave de servicio obtenida en el momento** (nunca
escrita en un archivo del repositorio; el script la pasa solo al proceso del
trabajador, sin imprimirla):

```bash
npm run start:local     # stack local: URL y clave de `supabase status -o env` (raíz del repo)
npm run start:staging   # staging: clave pedida a la API de gestión con el token de rrss
WORKER_MODE=continuous npm run start:local   # las variables WORKER_* pasan tal cual
```

- **Local**: antes, `supabase start` en la raíz (y `supabase migration up
--local` si el volumen ya existía, para tener `20261118220000_media_jobs_library`).
  El script se niega si `API_URL` no es de `127.0.0.1`/`localhost`.
- **Staging** (`zzkdrfhqmjfvrdsoguio`, fijado en el script): lee el token de
  `~/.supabase-rrss/token` (o `RRSS_SUPABASE_TOKEN_FILE`), el mismo que usan
  `scripts/supabase-rrss.sh` y `npm run dev:staging`, y pide la clave
  `service_role` a `GET /v1/projects/{ref}/api-keys`. Esa llamada es la misma
  que ya funciona para la clave `anon` en `dev:staging`; para la `service_role`
  **no se ha probado** (la pieza se escribió sin tocar staging). Hace falta que
  staging tenga aplicada la migración `20261118220000_media_jobs_library`.
  Para que la aplicación enseñe «Montar un reel» contra staging:
  `VITE_MEDIA_WORKER_ENABLED=true npm run dev:staging` (en PowerShell,
  `$env:VITE_MEDIA_WORKER_ENABLED='true'; npm run dev:staging`).

**En contenedor:**

```bash
docker build -t rrss-worker worker/                       # imagen de ejecución
docker build --target test -t rrss-worker-test worker/    # imagen con las pruebas
docker run --rm --name rrss-worker-test rrss-worker-test npm run test:reel
docker run --rm --name rrss-worker-1 -e SUPABASE_URL=… -e SUPABASE_SERVICE_ROLE_KEY=… rrss-worker
```

La imagen es `node:22-alpine` con `ffmpeg` y `font-dejavu` de Alpine, y corre
con el usuario `node` (uid 1000, sin privilegios). Ocupa unos 300 MB en disco
(Docker Desktop la lista como 450 MB): 150 MB son Node y 130 MB las bibliotecas
de FFmpeg. Se puede reducir con un FFmpeg compilado a medida (solo x264 y AAC);
no se ha hecho.

## El bucle

`src/worker.ts`. Cola, almacenamiento y manejadores se inyectan (`JobQueue`,
`MediaStorage`, `Handler`): las pruebas usan una cola en memoria, una carpeta
local y el SQL real, sin Supabase.

- **Reclama** con `claim_jobs` solo los tipos para los que tiene manejador.
- **Cierra** con `complete_job` (resultado en `jobs.result`) o `fail_job`.
  Una carga inválida o un archivo ilegible es un fallo **sin reintento**; lo
  demás se reintenta con la espera creciente de la cola.
- **Renueva la reserva.** Pide una reserva corta (`WORKER_LEASE_SECONDS`,
  5 min por defecto) y la renueva con `extend_job_lease` cada tercio de ella
  mientras el manejador avanza. Si no consigue renovarla, aborta el manejador
  —mata FFmpeg— un margen antes de que caduque y devuelve el trabajo; si al
  renovar descubre que ya no es suya (cancelado o reclamado por otro), aborta
  en el acto sin tocar la cola. Nunca hay dos trabajadores con el mismo
  trabajo. Un intento no pasa de `WORKER_MAX_ATTEMPT_SECONDS` (1 h por
  defecto), renueve o no. Si el trabajador muere, el trabajo queda libre en
  cuanto caduca la reserva corta.
- **Modo `drain`** (por defecto): sale cuando la cola está vacía, con código 0.
  Pensado para alojamientos que escalan a cero. **Modo `continuous`**: sigue
  sondeando cada `WORKER_POLL_MS`.
- **Apagado ordenado** (`SIGTERM`/`SIGINT`): deja de reclamar, aborta lo que
  tenga a medias y lo devuelve a la cola con `release_job`, **sin gastar
  intento** y disponible en el acto (no es un fallo del trabajo). Con
  `WORKER_SHUTDOWN_GRACE_MS` espera antes ese tiempo a que termine.
- **Registro**: una línea JSON por suceso. Cada intento deja un `job.attempt`
  con trabajo, tipo, número de intento, resultado (`succeeded`, `retry`,
  `failed`, `released`, `timeout`, `lease_lost`), duración y error.
- **Aislamiento**: el trabajador usa la clave de servicio, que se salta la RLS.
  Por eso cada ruta de entrada y de salida se comprueba contra la organización
  y la marca del trabajo (`assertJobPath`): un trabajo no puede leer ni
  escribir medios de otra marca.

Las dos funciones de la cola que usa para esto (`release_job` y
`extend_job_lease`) llegaron con la migración `20261117150000_jobs_release_extend.sql`.
Si `release_job` falla (sin red), el trabajo vuelve igualmente cuando caduca
la reserva, pero gastando ese intento.

## De la aplicación a la biblioteca

`type` = `media_job` en `provenance` solo lo puede poner la base de datos (un
disparador rechaza que un usuario lo inserte): nadie puede hacer pasar un
archivo subido a mano por el resultado de un trabajo. El enlace fiable
trabajo → recurso sigue siendo `jobs.result.assets`.

1. **Encargo** (`supabase/migrations/20261118220000_media_jobs_library.sql`):
   `request_media_job(marca, tipo, entrada, clave)` es `SECURITY DEFINER`; lo
   puede llamar cualquier usuario con sesión, pero solo encola si puede
   **editar** la marca. Solo `media.reel.template` y `media.image.process`. La
   entrada se restringe campo a campo (sin plantillas completas ni `fontPath`),
   cada ruta de entrada tiene que ser un **recurso de la biblioteca de esa
   marca** del tipo que toca (foto, clip o audio), y la **ruta de salida la pone
   la base de datos** (`<org>/<marca>/reels/<uuid>.mp4`,
   `…/recortes/<uuid>-<n>-<proporción>.<ext>`): el cliente no puede sobrescribir
   nada. Repetir la clave devuelve el mismo trabajo. Como mucho cinco trabajos
   de medios en marcha por marca. Los números (segundos, volumen…) los valida
   este trabajador con su esquema: una carga inválida falla sin reintento y con
   el motivo.
2. **Estado**: la aplicación lee `jobs` directamente; la RLS ya deja ver los
   trabajos de una marca a quien ve la marca, y a nadie de fuera. La pantalla
   vuelve a mirar cada 4 s mientras hay algo en cola o montándose.
3. **Resultado**: al pasar el trabajo a `succeeded`, un disparador `BEFORE
UPDATE` crea el recurso en `media_assets` (origen `generated`, carpeta
   «Reels» o «Recortes», y la procedencia en la columna común `provenance`
   —la de `20261118120000_media_assets_provenance`— con `type` = `media_job`:
   trabajo, plantilla, música y fuentes con su recurso y su ruta, recortada
   para no pasar de 2048 bytes) y lo anota en
   `jobs.result.assets`, de donde sale «Abrir en la biblioteca». La ruta sale de
   la **carga**; el resultado solo aporta medidas y tiene que corresponder a
   esa ruta (si no, `complete_job` falla y el trabajo no se cierra).

**Por qué en la base y no en el trabajador.** Va en la misma transacción que
`complete_job`: o el trabajo queda terminado y su recurso existe, o ninguna de
las dos cosas (si el trabajador diera de alta el recurso en otra llamada, un
corte entre las dos dejaría un trabajo «listo» sin recurso, o un recurso de un
trabajo que se va a reintentar). El trabajador sigue sin saber nada de la
biblioteca ni de su esquema y no necesita más permisos que los de la cola (lo
que facilita el rol limitado pendiente, más abajo). Vale también para los
trabajos que encole el servidor con `enqueue_job` si su carga dice dónde dejar
el archivo.

## Tipos de trabajo

Las cargas se validan con zod (`strictObject`: un campo de más es un error).
Todas las rutas son del cubo y de la marca del trabajo.

### `media.image.process`

```json
{
  "source": { "path": "<org>/<marca>/biblioteca/foto.jpg" },
  "focalPoint": { "x": 0.5, "y": 0.4 },
  "outputs": [
    { "path": "<org>/<marca>/derivados/foto-1x1.jpg", "aspect": "1:1", "width": 1080 },
    {
      "path": "<org>/<marca>/derivados/foto-9x16.webp",
      "aspect": "9:16",
      "width": 1080,
      "format": "webp",
      "quality": 80
    }
  ]
}
```

Proporciones `1:1`, `4:5`, `9:16`, `16:9`; formatos `jpeg`, `png`, `webp`. Saca
el mayor recorte posible centrado en el punto focal (0–1 desde arriba a la
izquierda) y nunca amplía por encima del original. Endereza las fotos de móvil
según su orientación EXIF.

### `media.video.derivatives`

```json
{
  "source": { "path": "<org>/<marca>/biblioteca/clip.mp4" },
  "poster": { "path": "…/clip.jpg", "atSeconds": 1, "width": 720 },
  "compressed": { "path": "…/clip-ligero.mp4", "maxHeight": 720, "maxFps": 30, "crf": 26 },
  "reframe": { "path": "…/clip-9x16.mp4", "aspect": "9:16", "focalPoint": { "x": 0.5, "y": 0.5 } }
}
```

Al menos uno de los tres. La adaptación a otra proporción es por recorte fijo
alrededor del punto focal (no sigue al sujeto).

### `media.reel.template`

```json
{
  "template": { "id": "fundido-suave" },
  "plan": {
    "media": [
      { "type": "photo", "path": "…/plato.jpg", "focalPoint": { "x": 0.4, "y": 0.5 }, "seconds": 2.5 },
      { "type": "video", "path": "…/cocina.mp4", "startAt": 1, "seconds": 4 }
    ],
    "texts": [{ "text": "Menú del día", "start": 0.5, "end": 3, "position": "bottom" }],
    "music": { "path": "…/musica.m4a", "startAt": 0, "volume": 0.3 },
    "fontPath": "…/tipografia-de-marca.ttf"
  },
  "output": { "path": "…/reel.mp4", "posterPath": "…/reel.jpg", "width": 1080 }
}
```

- **`template`**: el id de una plantilla incluida (`templates/*.json`) o una
  plantilla completa.
- **`plan`**: lo que propone la IA o una persona para una pieza concreta. Solo
  fotos y clips reales del cubo; aquí no se genera nada con IA ni sale ningún
  dato a un proveedor externo.
- **`output.width`**: para borradores más ligeros (540, 360…). Todo en la
  plantilla va en proporciones, así que se ve igual a menor tamaño.

Resultado: ruta, medidas, duración y códecs medidos con ffprobe sobre el
archivo final, la línea de tiempo, avisos (texto fuera del vídeo, texto que no
cabe) y tiempos.

Qué hace el motor (`src/reel/build.ts`): normaliza cada pieza al lienzo y a sus
fotogramas por segundo (recorte por punto focal), mueve las fotos con un zoom o
barrido suave, une las piezas por corte o fundido, superpone el texto (partido
en líneas, con caja o contorno y aparición gradual), mezcla la música atenuada
con el sonido de los clips si la plantilla lo pide, y exporta H.264 `yuv420p` +
AAC con `+faststart`. Siempre deja una pista de sonido, aunque sea silencio.

## Plantilla de reel (esquema v1)

Una plantilla es un archivo JSON validado por `reelTemplateSchema`
(`src/reel/schema.ts`). El JSON Schema publicado, para dárselo a la IA, está en
`schemas/` y se regenera con `npm run schemas` (una prueba vigila que esté al día).

| Campo                                                              | Qué decide                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                                    | `1`. Otra versión se rechaza: cambiar el formato exige una versión nueva y su migración                                                             |
| `id`, `name`, `description`                                        | Identificación. El archivo se llama como su `id`                                                                                                    |
| `canvas` `{width, height, fps}`                                    | Lienzo 9:16 (por defecto 1080×1920 a 30)                                                                                                            |
| `timing` `{photoSeconds, maxClipSeconds, maxTotalSeconds}`         | Ritmo por defecto y duración máxima; un plan que la supere se rechaza                                                                               |
| `transition` `{type, seconds}`                                     | `cut`, `fade`, `fadeblack`, `dissolve`, `slideleft`, `slideup`                                                                                      |
| `photoMotion` `{type, amount}`                                     | `none`, `zoom-in`, `zoom-out`, `pan-right`, `pan-left`, `alternate`                                                                                 |
| `text`                                                             | `font` (`default` o una instalada), `sizeRatio`, `color`, `position`, `marginRatio`, `maxWidthRatio`, `lineHeight`, `box`, `outline`, `fadeSeconds` |
| `audio` `{musicVolume, clipVolume, fadeInSeconds, fadeOutSeconds}` | Música atenuada; `clipVolume: 0` silencia los clips                                                                                                 |
| `export` `{crf, preset, audioBitrateKbps}`                         | Calidad y velocidad de H.264                                                                                                                        |

**Una sola fuente de verdad**: estos archivos. La aplicación los incluye al
compilar (`src/features/reels/templates.ts`, con `import.meta.glob`) para
enseñar nombre, descripción y máximos, y una prueba comprueba que ofrece
exactamente las de esta carpeta. No hay copia en la base de datos: motor y
plantilla van juntos (un cambio de esquema exige una versión nueva del
trabajador) y una tabla obligaría a sincronizar dos copias. El encargo solo
admite plantillas por su `id`; si no existe, el trabajador falla sin reintento
y la pantalla lo enseña. Añadir una plantilla es añadir un archivo: la ven la
aplicación y el trabajador en su siguiente despliegue.

Plantillas de ejemplo, neutras: `fundido-suave` (fundidos, texto abajo en
franja), `corte-ritmico` (cortes secos, texto grande centrado, conserva sonido
de los clips) y `pase-lateral` (deslizamiento, texto arriba).

**Tipografía**: por orden, `plan.fontPath` (archivo .ttf/.otf de la marca en el
cubo), la de la plantilla (`text.font`, un archivo de `WORKER_FONTS_DIR`) y la
por defecto del trabajador (`WORKER_FONT_FILE`; en el contenedor, DejaVu Sans).
Subir la tipografía de una marca exige que su licencia lo permita. El cubo
`brand-media` hoy no admite archivos de fuente (tipos MIME): habrá que
permitirlos cuando se use.

## Variables de entorno

| Variable                      | Por defecto                   | Para qué                                                                                                     |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_URL`                | — (obligatoria)               | URL del proyecto                                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`   | — (obligatoria)               | Clave de servicio. Solo como secreto del alojamiento; nunca en el repositorio ni en la carga de un trabajo   |
| `WORKER_BUCKET`               | `brand-media`                 | Cubo de Storage                                                                                              |
| `WORKER_MODE`                 | `drain`                       | `drain` (vacía y sale) o `continuous`                                                                        |
| `WORKER_ID`                   | `media-<host>-<pid>`          | Nombre con el que reserva (`jobs.locked_by`)                                                                 |
| `WORKER_CONCURRENCY`          | `1`                           | Trabajos a la vez (FFmpeg ya usa todos los núcleos)                                                          |
| `WORKER_LEASE_SECONDS`        | `300`                         | Duración de la reserva, que se renueva cada tercio (5–3600)                                                  |
| `WORKER_MAX_ATTEMPT_SECONDS`  | `3600`                        | Tiempo máximo de un intento aunque renueve (5–21600)                                                         |
| `WORKER_POLL_MS`              | `5000`                        | Espera entre sondeos con la cola vacía                                                                       |
| `WORKER_IDLE_EXIT_MS`         | `0`                           | En `drain`, cuánto espera con la cola vacía antes de salir                                                   |
| `WORKER_SHUTDOWN_GRACE_MS`    | `0`                           | Margen para terminar lo que esté en curso al apagar                                                          |
| `WORKER_TMP_DIR`              | carpeta temporal del sistema  | Disco de trabajo (hace falta sitio para los vídeos)                                                          |
| `WORKER_FONT_FILE`            | DejaVu Sans si está instalada | Tipografía por defecto                                                                                       |
| `WORKER_FONTS_DIR`            | —                             | Carpeta con tipografías para las plantillas                                                                  |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe`           | Binarios                                                                                                     |
| `WORKER_MAX_UPLOAD_BYTES`     | `52428800` (50 MB)            | Tope de cada archivo subido (el del cubo en el plan gratuito). Por encima, fallo sin reintento con el motivo |

Mejora de seguridad pendiente (recomendada en la investigación): un rol de
Postgres limitado a `claim_jobs`, `complete_job` y `fail_job` en vez de la
clave de servicio general.

## Cómo se despertaría desde la base

**No está creado.** El destino de la llamada depende del alojamiento. El
esquema, cuando se decida:

1. **Disparador** `AFTER INSERT` en `public.jobs` (por sentencia) que llama con
   `pg_net` a la URL que arranca el trabajador. `pg_net` envía tras el commit,
   con 2 s de espera y sin garantía de entrega.
2. **`pg_cron` cada minuto de respaldo**, obligatorio porque `pg_net` puede
   perder llamadas: si hay trabajos de medios pendientes o con la reserva
   caducada, vuelve a llamar. También cubre los reintentos, que se hacen
   reclamables más tarde sin que haya ningún `INSERT`.
3. La URL y el token viven en **Vault**, no en el SQL ni en el repositorio.

Boceto, **sin aplicar**:

```sql
create function private.wake_media_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_token text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'media_worker_wake_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'media_worker_wake_token';
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 2000
  );
end $$;

create function private.jobs_wake_media_worker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.wake_media_worker();
  return null;
end $$;

create trigger jobs_wake_media_worker after insert on public.jobs
  for each statement execute function private.jobs_wake_media_worker();

select cron.schedule('media-worker-wake', '* * * * *', $$
  select private.wake_media_worker()
  where exists (
    select 1 from public.jobs
    where kind like 'media.%'
      and ((status = 'queued' and run_after <= now()) or (status = 'running' and locked_until < now()))
  )
$$);
```

Despertar dos veces no hace daño: `claim_jobs` reparte cada trabajo a un solo
trabajador y el segundo proceso encuentra la cola vacía y sale.

Qué sería «la URL» en cada alternativa de la investigación
(`docs/investigacion-fase2/05-cola-y-trabajador.md`). Los detalles de cada API
son los de su documentación y están **sin verificar** en esta sesión:

| Alojamiento                                   | Cómo arranca                                                                                              | Modo         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| Fly.io, máquina bajo demanda (la recomendada) | La API de máquinas arranca una máquina parada; al vaciar la cola el proceso sale y la máquina se para     | `drain`      |
| Google Cloud Run Jobs                         | Ejecutar el job por API. Pide un token de Google: haría falta una Edge Function intermedia que lo obtenga | `drain`      |
| Vercel Sandbox                                | Una función de Vercel crea el sandbox con la imagen y lanza el proceso                                    | `drain`      |
| Render o Railway, siempre encendido           | No hace falta despertar nada                                                                              | `continuous` |
| VPS (Hetzner)                                 | Igual, con el contenedor bajo `restart: unless-stopped`                                                   | `continuous` |

El trabajador no abre ningún puerto: quien lo despierta es la plataforma al
arrancar el contenedor. Si se elige una plataforma que solo despierta por
petición HTTP al propio servicio, habrá que añadirle un pequeño servidor de
escucha (no está hecho).

## CI

`.github/workflows/ci.yml` tiene un trabajo aparte, `trabajador`, que instala
FFmpeg y una tipografía (`ffmpeg`, `fonts-dejavu-core`), y ejecuta
`npm run typecheck` y `npm test` en `worker/`. Después construye la imagen de
pruebas y ejecuta dentro la prueba del reel (los ejecutores de GitHub traen
Docker; no hace falta configurar nada). El trabajo se ha escrito con los mismos
comandos probados en local, pero **no se ha ejecutado en GitHub**.

## Licencias

| Componente                        | Licencia                                                           | Uso                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FFmpeg / ffprobe                  | LGPL/GPL según compilación; la de Alpine incluye x264 y es **GPL** | **Binario externo**: se lanza como proceso, no se enlaza ni se modifica. Si algún día se distribuye la imagen a terceros, hay que ofrecer el código fuente correspondiente |
| zod 4.6                           | MIT                                                                | Única dependencia de ejecución                                                                                                                                             |
| typescript 5.9                    | Apache-2.0                                                         | Desarrollo                                                                                                                                                                 |
| vitest 3.2                        | MIT                                                                | Desarrollo                                                                                                                                                                 |
| @types/node 22                    | MIT                                                                | Desarrollo                                                                                                                                                                 |
| DejaVu Sans (`font-dejavu`)       | Licencia libre de Bitstream Vera/DejaVu                            | Tipografía por defecto en el contenedor                                                                                                                                    |
| Node.js (imagen `node:22-alpine`) | MIT                                                                | Entorno                                                                                                                                                                    |

No se usa Remotion (su licencia de empresa es de pago para un SaaS que
renderiza por cuenta de clientes) ni ninguna otra biblioteca de vídeo.
H.264 y AAC tienen patentes con licencias propias; no se ha estudiado si
aplican a este uso.

## Tiempos medidos

Dentro del contenedor (FFmpeg 8.1.3, Alpine), limitado a 2 CPU, en una máquina
compartida con otros procesos, el 17/11/2026. Una sola medida de cada cosa: son
una referencia, no una garantía.

| Trabajo                                                                                              | Tiempo                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------- |
| Reel 1080×1920 de 10 s: dos fotos de 12 MP, una de 1080p y un clip 1080p de 4 s, dos textos y música | 7,6 s de FFmpeg; 8,4 s en total |
| Derivados de un clip 1080p de 5 s: comprimido a 720p                                                 | 2,2 s                           |
| …adaptación a 9:16 por recorte                                                                       | 1,4 s                           |
| …los tres derivados, con la lectura y la copia                                                       | 4,3 s                           |
| Foto de 12 MP a cuatro proporciones (1080 de ancho)                                                  | 0,7 s                           |

Es decir, el reel se monta más rápido que su duración. La investigación suponía
90 s por vídeo; con plantillas de fotos y clips cortos es mucho menos. Falta
medir con vídeos reales de móvil (4K, HEVC, varios minutos).

## Lo que queda fuera

- Exportar documentos por capas (su formato lo define otra pieza).
- Disparador, despliegue y alojamiento.
- Pantalla de recortes (`media.image.process`): la base de datos ya acepta el
  encargo y da de alta los recortes en la biblioteca, pero la aplicación
  todavía no tiene dónde pedirlos.
- Cancelar un encargo desde la aplicación (`cancel_job` sigue siendo solo del
  servidor) y avisos al terminar (hoy se ve en la pantalla de Reels).
- Fotos HEIC (las de iPhone sin convertir) y orientación EXIF en PNG/WebP: sin
  probar. Emojis en el texto: DejaVu no los trae.
- Subidas reanudables (TUS): se usa la subida estándar, sujeta al límite de
  archivo del cubo (50 MB hoy).
- Seguimiento del sujeto al cambiar de proporción, subtítulos, voz en off,
  varias pistas de música, animación de capas.
- Limpieza de trabajos antiguos y prioridad por plan (pendientes de la cola).
