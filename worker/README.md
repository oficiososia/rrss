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
| `media.cutout` — quitar el fondo (BEN2) → PNG con alfa en «Ediciones»    | Implementado; probado con un motor doble (`tests/cutout.test.ts`), con un proceso hijo doble (`tests/cutout-process.test.ts`) y medido con el modelo real en local (`scripts/bench-cutout.ts`). En Fly funciona (22/11/2026) pero a veces tarda minutos: `docs/alojamiento.md`, §3.1. El registro por fases y el proceso hijo (23/11/2026) están **sin desplegar** |
| `media.reel.template` — reel vertical por plantilla                     | Implementado y probado con archivos reales, también dentro del contenedor                                                                                                              |
| Plan v2 del editor de reels (recortes, transición por elemento, textos con estilo, subtítulos quemados, volumen por clip, música) | Implementado y probado con FFmpeg real (`tests/reel-editor-render.test.ts`, 21/11/2026); el plan v1 se migra a v2 al leerlo (`migratePlanV1`). Esquemas `schemas/reel-plan.v2` y `reel-payload.v2`. Ver `docs/editor-reels.md` |
| Textos animados, cámara que sube/baja y portada del reel (ampliación compatible del plan v2) | Implementado y probado con FFmpeg real (`tests/reel-animation.test.ts`, 22/11/2026): `animation` por texto (`src/reel/animation.ts`), `motion` pan-up/pan-down + `motionAmount`, `cover` → JPEG en `output.posterPath`. Todo campo nuevo es ausente, nunca `null` (`request_media_job` quita los nulos). Sin probar con el FFmpeg de la imagen Alpine. Ver `docs/editor-reels.md` §8 |
| Velocidad del clip, filtros de color y textos colocados a mano (ampliación compatible del plan v2) | Implementado y probado con FFmpeg real (`tests/reel-editor-pro.test.ts`, 22/11/2026): `speed` (0,5–2: `setpts` + `atempo`, sin cambiar el tono), `filter` (`CLIP_FILTER_CHAINS` en `src/reel/build.ts`, aproximación de los filtros de las fotos) y `offset` del texto. Un clip dividido en dos partes da el mismo vídeo que entero. Sin probar con el FFmpeg de la imagen Alpine. Ver `docs/editor-reels.md` §10 |
| `media.reel.analyze` — medir un vídeo de referencia sin IA («Hacer un reel como este») | Implementado y probado con FFmpeg real y un vídeo generado (`tests/reel-analyze.test.ts`, 22/11/2026): cortes, planos, compás, fotogramas y descarga de enlaces contra un servidor local. Sin probar en Fly ni con vídeos reales de móvil. Ver `docs/reel-como-este.md` |
| `media.video.derivatives` — póster, versión comprimida, otra proporción | Implementado y probado con archivos reales                                                                                                                                             |
| `media.report.pdf` — informe mensual de analítica en PDF (pdf-lib, MIT) | Implementado y probado (pdf-lib de verdad); el circuito completo, contra las migraciones reales (`tests/db/analitica-informe.test.ts`). Ver `docs/analitica.md` |
| `media.document.export` — documento por capas a imagen                  | **Sin implementar.** Solo el punto de enganche (`src/handlers/document-export.ts`), sin registrar: el trabajador no reclama ese tipo y nada lo simula                                  |
| Adaptadores de Supabase (cola por PostgREST, archivos por Storage)      | Implementados; probados contra un servidor HTTP local. Contra el stack local: probados de extremo a extremo (`tests/e2e/11-reels.spec.ts`, 18/11/2026). Contra staging, **sin probar** |
| Acceso por el intermediario `worker-gateway` (modo por defecto, sin clave de Supabase) | Implementado (21/11/2026); probado contra la función y la base de datos reales en local (`tests/db/trabajador-gateway.test.ts`) y contra un intermediario simulado (`tests/gateway.test.ts`). E2E por el stack local escrita y **sin ejecutar**. Contra staging, **sin desplegar** |
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

**El trabajador completo** (necesita un proyecto de Supabase con las
migraciones de la cola y del intermediario, y la función `worker-gateway`
desplegada; ver variables más abajo). Por defecto entra **por el
intermediario**, con el token del trabajador (Plataforma → Integraciones →
Trabajador de medios → «Generar token») y **sin ninguna clave de Supabase**:

```bash
SUPABASE_URL=… WORKER_GATEWAY_TOKEN=rrss_wgt_… npm start                 # vacía la cola y sale
SUPABASE_URL=… WORKER_GATEWAY_TOKEN=rrss_wgt_… WORKER_MODE=continuous npm start
```

**En local o en CI, con la clave de servicio** (modo explícito
`WORKER_SUPABASE_ACCESS=service-key`; la clave se obtiene en el momento, nunca
se escribe en un archivo del repositorio y el script la pasa solo al proceso
del trabajador, sin imprimirla). En Fly.io este modo no arranca:

```bash
npm run start:local     # stack local: URL y clave de `supabase status -o env` (raíz del repo)
npm run start:staging   # staging: clave pedida a la API de gestión con el token de rrss
WORKER_MODE=continuous npm run start:local   # las variables WORKER_* pasan tal cual
# Como en Fly, por el intermediario del stack local (`supabase functions serve`), sin la clave:
WORKER_GATEWAY_TOKEN=rrss_wgt_… node scripts/run-supabase.ts local-gateway
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
docker run --rm --name rrss-worker-1 -e SUPABASE_URL=… -e WORKER_GATEWAY_TOKEN=… rrss-worker
```

La imagen es `node:22-trixie-slim` (Debian; desde `f21`, antes Alpine: sin probar el cambio de FFmpeg) con `ffmpeg` y `fonts-dejavu-core`, y corre
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
- **Aislamiento**: por defecto el trabajador no tiene ninguna clave de
  Supabase: el intermediario `worker-gateway` (docs/alojamiento.md, §5) solo
  le deja reclamar sus tipos de trabajo, cerrar los que tiene reservados y
  pedir URL firmadas de rutas de la organización y la marca del trabajo
  reservado (lo comprueba la base de datos). Además, cada ruta de entrada y
  de salida se comprueba aquí (`assertJobPath`), que es la única defensa en el
  modo local con la clave de servicio.

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
   **editar** la marca. Solo `media.reel.template`, `media.image.process` y `media.cutout`. La
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
fotogramas por segundo, **encuadra cada foto sobre su sujeto** (máscara de «Quitar
el fondo», punto guardado o saliencia, `src/reel/subject.ts`) y mueve la cámara
hacia él con un zoom o barrido suavizado, une las piezas por corte o fundido,
aplica una gradación ligera e igual en todo el reel, superpone los textos (por
papel, con cortes equilibrados, dentro de las zonas seguras de Instagram y sin
pisarse nunca, `src/reel/textlayout.ts`), añade el cierre con la marca si el plan
lo trae, mezcla la música atenuada con el sonido de los clips y exporta H.264 High
~9 Mbps + AAC 160 kbps con `+faststart`. **Sin música ni sonido de clips, el
vídeo sale sin pista de audio** (`result.output.audio`: `music`, `clips` o `none`).
Detalle y decisiones: `docs/reels-calidad.md`.


**Tipografía de la marca** (`plan.fontPath`): la pone la base de datos al
encolar un reel con textos (migración `20261119211000_brand_fonts`): el
archivo .ttf/.otf de la marca, empezando por la familia que el perfil pone en
primer lugar, redonda y con el peso más cercano a 400. El cliente no la elige.
El trabajador comprueba que la ruta es de la marca del trabajo y que el archivo
es TrueType u OpenType; si no lo es, monta con la de reserva y lo dice en
`warnings`. El resultado lleva `font.source`: `brand`, `template`, `default`
(la de reserva) o `none`. Los .woff y .woff2 no se usan en vídeo: FFmpeg no
los lee de forma fiable.

### `media.reel.analyze`

```json
{
  "reference": { "id": "<uuid del análisis>" },
  "source": { "path": "<org>/<marca>/referencias/<uuid>.mp4" },
  "speech": true,
  "output": { "dir": "<org>/<marca>/referencias/<uuid del análisis>" }
}
```

`source` es `{ "path" }` (el vídeo subido a la carpeta privada de referencias) o `{ "url" }` (un enlace).
Todo lo pone la base de datos (`request_media_job`): el cliente solo elige el archivo o el enlace y si se
transcribe la voz. Mide **sin IA**: duración y tamaño (ffprobe); cortes secos y transiciones suaves con
`scdet` → planos con su duración, si son imagen fija y cómo se entra a cada uno (`src/analyze/scenes.ts`);
un JPEG por plano (hasta 12, 512 px) en `output.dir/f-NN.jpg`; volumen, golpes y tempo (la misma cuenta
que el editor de reels, `src/analyze/rhythm.ts`) y qué parte de los cortes cae en un golpe; con `speech`,
trozos de sonido de hasta 20 s (120 s en total) en `output.dir/a-NN.m4a` (AAC, 16 kHz, mono).

Topes (`REEL_ANALYZE_LIMITS`): 180 s de vídeo, 30 planos, 12 fotogramas, 50 MB para un enlace. Un vídeo
más largo, sin imagen o ilegible falla sin reintento con el motivo.

**Enlaces, sin trucos** (`src/analyze/download.ts`): una petición HTTP normal con las protecciones contra
SSRF de `extract/net.ts`, agente `rrss-referencias` y respeto de `robots.txt`; vale un archivo de vídeo
directo o el `og:video` que declare la página. Sin sesión, sin cookies, sin JavaScript y sin herramientas
de descarga: si el sitio no lo deja (Instagram, TikTok y YouTube, casi siempre), falla sin reintento
diciendo que se suba el archivo. El vídeo bajado se queda en la carpeta temporal del trabajo.

Del vídeo de referencia no sale ningún recurso para la biblioteca: el resultado va a
`reel_references.measurement` (disparador de la migración `20261223010000`) y los fotogramas y el sonido
los borra la función `ai-reel-like` al terminar.

### `source.extract`

Texto de una fuente de conocimiento de la marca (`brand_knowledge_sources`),
sin IA. Lo encola la base de datos al dar de alta la fuente (migración
`20261119210000_source_text_extraction`) y la RPC `request_source_extraction`
al volver a pedirlo; nadie lo encola a mano.

```json
{ "source_id": "…", "format": "pdf" | "docx" | "text" | "website", "path": "…/sources/manual.pdf" }
{ "source_id": "…", "format": "website", "url": "https://marca.example/" }
```

- **PDF**: pdf.js (por medio de `unpdf`), hasta 300 páginas. Un PDF escaneado
  no tiene texto: falla diciendo que no se hace reconocimiento de caracteres.
  Uno con contraseña falla sin reintento.
- **Word (.docx)**: `mammoth` (texto sin formato). Antes se mira el directorio
  central del ZIP: más de 100 MB descomprimidos se rechazan (zip bomba).
- **Texto (.txt, .json)**: UTF-8; los bytes inválidos se sustituyen.
- **Web**: la página dada y, como mucho, 4 enlaces internos de primer nivel
  (mismo origen, sin archivos), 5 páginas en total. Sin ejecutar JavaScript
  (el HTML se analiza con `htmlparser2`, sin scripts, estilos ni lo oculto).
  - `robots.txt` de cada origen, con el agente `rrss-fuentes` (RFC 9309: si no
    existe se puede leer; si da 5xx o no responde no se lee y se reintenta).
    Respeta `<meta name="robots" content="nofollow">` y `rel="nofollow"`.
  - Contra SSRF (`src/extract/net.ts`): solo http/https, sin usuario ni
    contraseña, puertos 80 y 443, nada de `localhost` ni nombres sin dominio.
    Cada IP a la que se conecta tiene que ser pública (`ipaddr.js`, rango
    `unicast`): fuera privadas, locales, enlace-local (metadatos de la nube),
    CGNAT, multidifusión, reservadas, NAT64, 6to4, Teredo y las IPv4 dentro de
    IPv6. Se comprueba **al conectar** (opción `lookup` de Node, sin agente
    compartido), así que un DNS que cambia de respuesta no sirve; una IP
    escrita en la URL se comprueba antes. Las redirecciones (3 como mucho) se
    siguen a mano y cada salto pasa las mismas comprobaciones.
  - Topes: 2 MB por página (también tras descomprimir gzip, deflate o brotli),
    15 s por petición y 60 s en total.
- El texto se normaliza (espacios, líneas en blanco) y se recorta a 100 000
  caracteres. El resultado lleva `text` y `meta` (páginas, páginas web leídas u
  omitidas y por qué, si se recortó); al cerrar el trabajo, la base de datos
  mueve el texto a la fuente (no se queda en `jobs.result`) y pone su estado:
  pendiente → extrayendo → lista, o falló con el motivo.

Por qué aquí y no en una Edge Function: leer un PDF de decenas de páginas pasa
de los 2 s de CPU por petición del plan gratuito de Supabase, y la protección
contra SSRF necesita controlar la resolución de nombres al conectar.

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
| `SUPABASE_URL`                | — (obligatoria)               | URL del proyecto (la pública)                                                                                |
| `WORKER_SUPABASE_ACCESS`      | `gateway`                     | `gateway`: por la función `worker-gateway` con `WORKER_GATEWAY_TOKEN`, sin claves de Supabase (el de Fly). `service-key`: con la clave de servicio, solo en local o CI; en Fly no arranca |
| `WORKER_GATEWAY_TOKEN`        | — (obligatoria en `gateway`)  | Token del trabajador (`rrss_wgt_…`), de Plataforma → Integraciones → «Generar token». Secreto del alojamiento. Solo sirve para el intermediario; se revoca en la misma pantalla |
| `WORKER_GATEWAY_URL`          | `<SUPABASE_URL>/functions/v1/worker-gateway` | Otra dirección del intermediario (pruebas)                                                     |
| `SUPABASE_SERVICE_ROLE_KEY`   | — (solo en `service-key`)     | Clave de servicio, solo en local o CI. **En Fly.io, si aparece, el trabajador no arranca**                   |
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
| `WORKER_FONT_FILE`            | `fonts/Montserrat-ExtraBold.ttf` (incluida) | Tipografía por defecto de los reels (rótulos y subtítulos: `fonts/Montserrat-SemiBold.ttf`)     |
| `WORKER_FONTS_DIR`            | —                             | Carpeta con tipografías para las plantillas                                                                  |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe`           | Binarios                                                                                                     |
| `WORKER_CUTOUT_MODEL`         | `/app/models/ben2-base-fp16.onnx` | Modelo BEN2 fp16 (en la imagen Docker). Si el archivo no existe, el trabajador NO reclama `media.cutout` (avisa en el arranque) |
| `WORKER_CUTOUT_THREADS`       | `2`                           | Hilos de onnxruntime (la máquina es shared-cpu-2x; la arena de memoria va siempre desactivada)                |
| `WORKER_CUTOUT_ISOLATION`     | `process`                     | `process`: el modelo corre en un proceso hijo y el trabajador sigue renovando la reserva, escribiendo el registro y pudiendo cancelar. `inline`: en el propio proceso, como antes del 23/11/2026 (solo para comparar) |
| `WORKER_MAX_UPLOAD_BYTES`     | `52428800` (50 MB)            | Tope de cada archivo subido (el del cubo en el plan gratuito). Por encima, fallo sin reintento con el motivo |
| `WORKER_MEDIA_STORAGE`        | `auto`                        | Solo en `service-key`. `auto`: pregunta a la función `media-storage` dónde está cada archivo (Cloudflare R2 o Supabase) y dónde subir los resultados, sin credenciales de R2; si la función no está desplegada, Supabase Storage. `supabase`: solo Supabase Storage (docs/almacenamiento-r2.md). Con el intermediario lo decide él |

La clave de servicio general ya no hace falta en el alojamiento: la sustituye
el intermediario `worker-gateway` (en vez del rol de Postgres limitado que se
propuso; por qué, en docs/alojamiento.md, §5).

## Cómo se despierta desde la base (Fly.io)

**Implementado** (migración `20261208010000_media_worker_wake.sql`, pruebas en
`tests/db/trabajador-despertador.test.ts`; sin aplicar en staging). Detalle y
pasos para el dueño en `docs/alojamiento.md`, §4.

1. **Disparador** `AFTER INSERT` en `public.jobs` (por sentencia), solo si
   entra un trabajo del trabajador (`media.*` o `source.extract`) que ya toca
   ejecutar: llama a `private.media_worker_wake()`, que hace con `pg_net`
   `POST https://api.machines.dev/v1/apps/{app}/machines/{id}/start`. `pg_net`
   envía tras el commit y sin garantía de entrega. Un fallo nunca impide encolar.
2. **`pg_cron` cada 2 minutos de respaldo** (`rrss-media-worker-wake`): llamadas
   perdidas, reintentos con espera y trabajos devueltos al apagar.
3. El token de Fly, la app y la máquina se pegan en **Plataforma →
   Integraciones → Trabajador de medios (Fly.io)** (el token, cifrado en Vault);
   de respaldo, los secretos sueltos de Vault `rrss_fly_*`. Nada en el SQL ni en
   el repositorio. Sin ellos, solo un aviso.
4. No llama si un trabajo del trabajador tiene la reserva viva (la máquina ya
   trabaja) ni más de una vez cada 10 s.

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
| FFmpeg / ffprobe                  | LGPL/GPL según compilación; la de Debian incluye x264 y es **GPL** | **Binario externo**: se lanza como proceso, no se enlaza ni se modifica. Si algún día se distribuye la imagen a terceros, hay que ofrecer el código fuente correspondiente |
| zod 4.6                           | MIT                                                                | Validación de cargas                                                                                                                                                       |
| unpdf 2.1.0 (incluye pdf.js)      | MIT (pdf.js: Apache-2.0)                                           | Texto de los PDF (`source.extract`)                                                                                                                                        |
| mammoth 1.13.0                    | BSD-2-Clause (jszip: MIT o GPL-3.0, se usa como MIT; pako: MIT y Zlib) | Texto de los Word .docx                                                                                                                                                |
| htmlparser2 12.0.0                | MIT                                                                | HTML a texto, sin ejecutar nada                                                                                                                                            |
| robots-parser 3.0.1               | MIT                                                                | robots.txt                                                                                                                                                                 |
| ipaddr.js 2.5.0                   | MIT                                                                | Clasificar IP (protección contra SSRF)                                                                                                                                     |
| typescript 5.9                    | Apache-2.0                                                         | Desarrollo                                                                                                                                                                 |
| vitest 3.2                        | MIT                                                                | Desarrollo                                                                                                                                                                 |
| @types/node 22                    | MIT                                                                | Desarrollo                                                                                                                                                                 |
| Montserrat ExtraBold y SemiBold (`fonts/`) | SIL Open Font License 1.1 (`fonts/OFL.txt`)               | Tipografía por defecto de los textos de los reels, dentro de la imagen                                                                                                    |
| DejaVu Sans (`font-dejavu`)       | Licencia libre de Bitstream Vera/DejaVu                            | Tipografía de reserva del sistema                                                                                                                                           |
| Node.js (imagen `node:22-trixie-slim`) | MIT                                                           | Entorno (Debian, no Alpine: onnxruntime-node solo trae binarios para glibc)                                                                                                 |
| onnxruntime-node 1.30.0           | MIT                                                                | Ejecuta BEN2 en CPU (`media.cutout`)                                                                                                                                       |
| BEN2 base fp16 (`onnx-community/BEN2-ONNX`) | MIT (ficha del modelo)                                   | Quitar el fondo; 219 MB dentro de la imagen, con sha256 fijado en el `Dockerfile`                                                                                           |
| sharp 0.34.5 (libvips)            | Apache-2.0 (libvips: LGPL-3.0, binario precompilado)               | Leer y escribir las fotos de `media.cutout`                                                                                                                                |

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

## `media.cutout` (quitar el fondo)

Foto de la biblioteca → PNG con alfa en `<org>/<marca>/ediciones/<uuid>.png`. Carga:
`{ source: { path }, output: { path }, model: "ben2-base-fp16", engine: "servidor" }`; la base de
datos fija todo menos la foto (`request_media_job`, migración `20261214010000`). Detalle, cadena
del panel y mediciones: `docs/edicion-fotos.md`, §7 («Quitar el fondo en el servidor»).

- **Memoria:** pico ~2,2–2,3 GB medido en escritorio (también con 12 MP) y ~3,1 GB en Fly → `fly.toml` con **4 GB**.
- **Sesión:** se abre al empezar cada trabajo y se libera al terminar (también si falla); 2 hilos,
  `enableCpuMemArena=false`.
- **De dónde sale el modelo:** del disco, **dentro de la imagen** (`Dockerfile`, `ADD --checksum` con el
  sha256 y la revisión fijados; 219 MB). No se descarga al arrancar ni en cada trabajo: Hugging Face solo
  interviene al construir la imagen. En cada arranque, `worker.cutout_model` lo deja dicho en el registro.
- **En un proceso hijo** (`src/cutout/process-engine.ts` → `src/cutout/child.ts`, uno por trabajo).
  `onnxruntime-node` carga e infiere de forma síncrona: dentro del proceso del trabajador lo dejaba sordo
  (sin renovar la reserva, sin atender SIGTERM y sin registro) lo que durase la inferencia. Con el hijo, el
  trabajador sigue vivo, **mata el hijo** si el trabajo se cancela o se pierde la reserva, y sobrevive si
  el sistema mata el hijo por falta de memoria. El hijo no recibe el token ni ninguna clave.
- **Registro por fases:** una línea `cutout.phase` por fase (`download`, `decode`, `model_fetch`, `load`,
  `inference`, `refine`, `encode`, `upload`) con `ms`, `cpuMs`, `rssMb` y, en Linux, `stealMs`, `iowaitMs` y
  `swapUsedMb`; un latido `cutout.heartbeat` cada 15 s mientras una fase sigue; `ok: false` si se corta.
  Sin rutas, nombres de archivo ni URL. Cómo leerlo y por qué a veces tarda minutos en Fly (cuota de
  procesador de las máquinas compartidas): `docs/alojamiento.md`, §3.1.
- **`result.timings`:** fases que no se solapan (`downloadMs`, `prepareMs`, `modelReadMs`, `loadMs`,
  `inferenceMs`, `postMs`, `encodeMs`, `uploadMs`): la base de datos las **suma** como tiempo de máquina
  (`private.job_machine_ms`). El procesador y la memoria van al registro, no ahí.
- **Código compartido con la aplicación:** `src/cutout/shared/` es una COPIA GENERADA de
  `src/features/photo-edit/cutout/{mask,refine,resample}.ts` (`npm run sync:cutout`); la prueba
  `tests/cutout.test.ts` falla si se desfasa.
- **Medir con el modelo real:** `node scripts/bench-cutout.ts <modelo.onnx> <foto>…` (un proceso por foto;
  `BENCH_OUT=<carpeta>` deja los PNG; `BENCH_PHASES=1` imprime las líneas `cutout.phase`;
  `BENCH_ENGINE=inline` mide sin el proceso hijo).
- **Sin modelo no se reclama:** en local, sin `WORKER_CUTOUT_MODEL`, el trabajador no atiende
  `media.cutout` (los trabajos quedan en cola).
