# Editor de reels

Rama `f11/editor-reels` (worktree `rrss-f13-reels`), desde `claude/focused-noether-hk502p`.
Plan escrito antes de programar (21/11/2026); al final, lo que quedó hecho y lo que no.

## 1. Punto de partida

- **Hoy** el reel se encarga desde Biblioteca → Reels (`src/features/reels/ReelsPage.tsx`):
  una de tres plantillas (`worker/templates/*.json`: corte rítmico, fundido suave, pase
  lateral), fotos y clips de la biblioteca, segundos por pieza, textos con su momento,
  desenfoque y música. `request_media_job` (SQL) valida la carga y el trabajador
  (`worker/src/reel/build.ts`) la monta con FFmpeg a 1080×1920.
- Sin línea de tiempo, sin vista previa, sin subtítulos, sin recortes de principio y
  final del clip, sin volumen por clip, un solo estilo de texto (el de la plantilla) y
  el resultado no queda unido a ninguna pieza: al programar un reel vale cualquier vídeo
  de la marca (`private.publication_media_problem`).

## 2. Decisiones

| Tema                             | Decisión                                                                                                                                                                                                                                                                                                                                                                  | Por qué                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dónde vive el reel               | Una **pieza** (`content_items`, formato `reel`) cuyas versiones (`content_versions.data`) son un **proyecto de reel**: `{ "kind": "reel", "template": { "id" }, "plan": <plan v2> }`, `schema_version` = 2                                                                                                                                                                | Reutiliza versiones, estados, aprobación, historial, calendario y «Publicar ahora» sin tablas nuevas. `migrateDocument` rechaza ese JSON (no tiene `schemaVersion`), así que el editor de imagen y las vistas previas de campañas lo tratan como «no es un documento» sin romperse |
| Qué editor abre una pieza `reel` | El editor de reels. Una pieza `reel` antigua con un diseño por capas se puede seguir abriendo en el de imagen (`?editor=imagen`)                                                                                                                                                                                                                                          | Lo de antes sigue funcionando                                                                                                                                                                                                                                                      |
| Plan del reel                    | **Versión 2** en `worker/src/reel/schema.ts` y en `src/features/reels/editor/project.ts`. El plan v1 sigue admitido: el trabajador lo **migra** a v2 al leerlo (`migratePlanV1`) y lo monta con el mismo motor                                                                                                                                                            | Un solo motor; los encargos v1 dan el mismo vídeo                                                                                                                                                                                                                                  |
| Transiciones                     | Por elemento (`clip.transition`, la que entra desde el anterior), con los tipos que ya tienen las plantillas (`cut`, `fade`, `fadeblack`, `dissolve`, `slideleft`, `slideup`). Cadena mixta: corte = `concat`, el resto = `xfade`                                                                                                                                         | Las plantillas pasan a ser el punto de partida: rellenan transición, duración de foto, estilo del texto y volúmenes                                                                                                                                                                |
| Subtítulos                       | Se guardan **en cada clip, en tiempo del archivo** (`clip.subtitles`): al recortar o mover el clip siguen sincronizados. El trabajador los pasa a la línea de tiempo y los quema con `drawtext` (no hace falta libass)                                                                                                                                                    | Un solo camino de texto, con la tipografía de la marca                                                                                                                                                                                                                             |
| Transcripción                    | Edge Function nueva `ai-transcribe` con el **servicio de IA** de siempre (`createAiService`: reserva de cupo → proveedor → coste en `ai_generations`, tarea `transcription`, que el plan cubre con `ai_text`). Proveedor OpenAI con la clave `OPENAI_API_KEY` de Integraciones                                                                                            | Coste y cupo por organización, como la IA de texto                                                                                                                                                                                                                                 |
| Cómo se consiguen los tiempos    | El navegador decodifica el sonido del tramo usado del clip, lo pasa a 16 kHz mono, lo corta en trozos de voz (≤ 8 s, por pausas) y manda los trozos en WAV; el servidor transcribe cada trozo; cada trozo es un subtítulo con su principio y su final                                                                                                                     | El modelo vigente (`gpt-transcribe`) no devuelve marcas de tiempo; `whisper-1` sí, pero se apaga el 26/02/2027. Así funciona con cualquier modelo                                                                                                                                  |
| Interruptor                      | `VITE_REEL_SUBTITLES_ENABLED=true` **y** el servidor dice `reelSubtitles` (OpenAI cargable con el criterio de la UE). Sin OpenAI, los botones no salen                                                                                                                                                                                                                    | Lo que no funciona no sale                                                                                                                                                                                                                                                         |
| Vista previa                     | En el navegador, un lienzo 9:16 que compone en cada fotograma: clips (`<video>` sincronizados), fotos (con el mismo movimiento y desenfoque), transiciones aproximadas, textos y subtítulos (mismas cuentas de tamaño, márgenes y cortes de línea que el trabajador) y sonido (volumen por clip, música con entrada y salida suaves). Se avisa de lo que se verá distinto | Lo más fiel posible sin FFmpeg en el navegador                                                                                                                                                                                                                                     |
| Música                           | Pista de tipo audio de la biblioteca, volumen, entrada y salida suaves, punto de inicio. Al elegirla, aviso de licencia y confirmación obligatoria (`music.license.confirmed`), que va en el plan y en la procedencia del vídeo                                                                                                                                           | La licencia es responsabilidad de la marca                                                                                                                                                                                                                                         |
| Montaje unido a la pieza         | `request_media_job` admite `content: { id, version }` (de la misma marca, formato `reel`, versión existente). El vídeo resultante lleva `content_id` y `content_version` en su procedencia; programar y «Publicar ahora» proponen el montaje de la versión vigente                                                                                                        | «Con lo que ya existe»: la regla de publicación de reels no cambia                                                                                                                                                                                                                 |
| Límite                           | 90 s en v2 (máximo del esquema de plantillas). En v1, el de la plantilla, como antes                                                                                                                                                                                                                                                                                      |                                                                                                                                                                                                                                                                                    |

## 3. Plan v2 (resumen)

```jsonc
{
  "version": 2,
  "clips": [
    { "id": "c1", "type": "photo", "path": "<org>/<marca>/…", "seconds": 2.5, "blur": 0,
      "motion": "zoom-in", "focalPoint": { "x": 0.5, "y": 0.5 },
      "transition": { "type": "fade", "seconds": 0.5 } },
    { "id": "c2", "type": "video", "path": "…", "in": 1.2, "out": 4.8, "volume": 0.6,
      "transition": { "type": "slideleft", "seconds": 0.4 },
      "subtitles": [{ "start": 1.3, "end": 3.1, "text": "…" }] }   // tiempo del archivo
  ],
  "texts": [
    { "id": "t1", "text": "…", "start": 0.3, "end": 2.5, "position": "bottom",
      "style": { "fontPath": "<org>/<marca>/fonts/x.ttf", "fontFamily": "X", "color": "#FFFFFF",
                 "sizeRatio": 0.06, "marginRatio": 0.2, "maxWidthRatio": 0.84, "lineHeight": 1.3,
                 "box": null, "outline": { "color": "#000000", "widthRatio": 0.06 }, "fadeSeconds": 0.25 } }
  ],
  "subtitles": { "enabled": true, "position": "bottom", "style": { … } },
  "music": { "path": "…", "startAt": 0, "volume": 0.35, "fadeInSeconds": 0.5, "fadeOutSeconds": 1,
             "license": { "confirmed": true, "note": "…" } },
  "fontPath": "…"   // tipografía por defecto de la marca (la pone la base de datos)
}
```

## 4. Fases (un commit por fase)

1. **Plan v2 y migración** — esquema v2 y `migratePlanV1` en el trabajador (zod 4) y en la
   aplicación (zod 3, `src/features/reels/editor/project.ts`), línea de tiempo calculada igual
   en los dos lados, esquemas JSON publicados (`npm run schemas`), contrato con un ejemplo
   compartido. Pruebas unitarias del plan y de la migración.
2. **Montaje v2 en el trabajador** — recortes (`in`/`out`), duración por foto, transición por
   elemento (cadena mixta), textos con estilo y tipografía propios, subtítulos quemados, mezcla
   (volumen por clip, música con volumen, entrada, salida e inicio). Pruebas con FFmpeg real.
3. **Base de datos y transcripción** — migración `20261207010000_reel_editor.sql` (+ vuelta
   atrás): carga v2 y enlace con la pieza en `request_media_job`, tipografías por texto
   comprobadas contra `brand_fonts`, procedencia con la pieza y la licencia de la música.
   Función `ai-transcribe` (OpenAI y simulado local), disponibilidad `reelSubtitles`. Pruebas
   en `tests/db` (incluido aislamiento).
4. **Editor** — línea de tiempo (pistas de vídeo/foto, texto, subtítulos y audio; arrastrar
   para ordenar, recortar, duración, transición, cabezal, zoom, deshacer/rehacer), inspector,
   plantillas como punto de partida, vista previa sincronizada con avisos, música con aviso de
   licencia, subtítulos automáticos y corrección a mano. Pruebas de componentes.
5. **Guardado y publicación** — versiones de la pieza, estados y aprobación, «Montar el vídeo»
   de la versión guardada, encargos de la pieza, programar/publicar proponiendo el montaje de
   la versión; e2e con el trabajador real y la transcripción simulada; `docs/ESTADO.md`.

## 5. Coste de los subtítulos

Precio de OpenAI consultado el 21/11/2026 en <https://developers.openai.com/api/docs/pricing>
(modelos en <https://developers.openai.com/api/docs/guides/speech-to-text>):

| Modelo                                      | Estado                           | Precio                             | Marcas de tiempo    |
| ------------------------------------------- | -------------------------------- | ---------------------------------- | ------------------- |
| `gpt-transcribe`                            | Recomendado                      | 0,0045 $/min (estimado por OpenAI) | No                  |
| `whisper-1`                                 | Obsoleto, se apaga el 26/02/2027 | 0,006 $/min                        | Sí (`verbose_json`) |
| `gpt-4o-transcribe` / `-mini-` / `-diarize` | Obsoletos, mismo apagado         | 0,006 / 0,003 / 0,006 $/min        | Solo `-diarize`     |

Por defecto se usa `gpt-transcribe` y se reserva **0,00495 $/min** (82,5 micros por segundo):
el precio publicado más el 10 % que OpenAI cobra por el procesamiento regional (UE) a los
modelos publicados desde el 05/03/2026; la página no dice si ese recargo alcanza a este
modelo, así que se cuenta como cota. Un reel de 30 s de voz: ≈ 0,0025 $. Se cambia sin tocar
código con `AI_TRANSCRIPTION_MODEL` y `AI_PRICES` (`"openai/<modelo>": { "audio_seconds": … }`).
Sin comprobar: si OpenAI redondea cada petición (cada trozo) al segundo o al minuto.

## 6. Resultado (21/11/2026)

### Hecho

| Fase | Commit                                                                        | Qué                                                                                                                                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan | `docs(reels): plan del editor de reels`                                       | Este documento                                                                                                                                                                                                                                                                                             |
| 1    | `feat(reels): plan v2 del reel y migración del v1`                            | Esquema v2 en los dos lados, `migratePlanV1`, línea de tiempo y cuentas de texto iguales, ejemplo compartido `worker/tests/fixtures/plan-v2.json`, esquemas JSON `reel-plan.v2` y `reel-payload.v2`. El motor del trabajador monta v1 y v2 por el mismo camino (las pruebas v1 de siempre siguen en verde) |
| 2    | `test(worker): montaje real de un plan v2 del editor de reels`                | `worker/tests/reel-editor-render.test.ts` con FFmpeg real                                                                                                                                                                                                                                                  |
| 3    | `feat(reels): encargo del plan v2 unido a la pieza y subtítulos automáticos`  | Migración `20261207010000_reel_editor.sql` (+ vuelta atrás), función `ai-transcribe`, ajuste `AI_TRANSCRIPTION_MODEL`, disponibilidad `reelSubtitles`, `VITE_REEL_SUBTITLES_ENABLED`                                                                                                                       |
| 4    | `feat(reels): editor de reels con línea de tiempo, vista previa y subtítulos` | `src/features/reels/editor/` (línea de tiempo, vista previa, inspector, historial, subtítulos), enrutado de las piezas reel, «Crear con el editor» en Biblioteca → Reels, propuesta del montaje de la versión al programar                                                                                 |
| 5    | `feat(reels): e2e del editor de reels y estado`                               | `tests/e2e/29-editor-reels.spec.ts` (escrita, sin ejecutar: Docker parado), documentación                                                                                                                                                                                                                  |

Dónde está cada cosa:

- `src/features/reels/editor/project.ts` — proyecto y plan v2, plantilla como punto de partida, migración v1, línea de tiempo, cuentas de texto, comprobaciones.
- `ops.ts` / `history.ts` — cambios puros y deshacer/rehacer (los arrastres y lo que se escribe en un campo se juntan en un paso).
- `Timeline.tsx` — pistas (vídeo y fotos, textos, subtítulos, música), arrastrar para ordenar (también Alt + flechas), recortes por los extremos, cabezal y zoom (20 a 200 px/s).
- `compose.ts` / `ReelPlayer.tsx` — vista previa: qué se ve y suena en cada instante y el lienzo que lo dibuja; `previewWarnings` dice lo que se verá distinto.
- `Inspector.tsx` — propiedades del elemento; subtítulos del clip (automáticos o a mano); estilo con la paleta y las tipografías .ttf/.otf de la marca.
- `subtitles.ts` — sonido del tramo (Web Audio, 16 kHz mono), trozos de voz por pausas, WAV y llamada a `ai-transcribe`.
- `ReelEditor.tsx` — la pantalla: versiones, estados, montaje, montajes de la pieza, «Publicar ahora» con el montaje de la versión.
- `supabase/functions/ai-transcribe/` y `_shared/ai/transcription/` — función, adaptador de OpenAI, configuración y simulado.

### Decisiones provisionales

- La transcripción se admite en marcas en modo agencia (como el copiloto por voz: copia lo que se dice, no redacta).
- La regla de publicación de reels no cambia (vale cualquier vídeo de la marca); el editor y el calendario proponen el montaje de la versión vigente.
- Un plan v1 migrado reparte la transición elemento a elemento (el v1 la limitaba por el elemento más corto de todo el reel): solo cambia algo si la transición de la plantilla pasaba de la mitad de una pieza.

### Probado

- Unitarias: plan, migración, línea de tiempo, cambios, historial, composición de la vista previa, cortes de voz, WAV y reparto de subtítulos.
- Componentes (`editorReels.test.tsx`): abrir una pieza reel, ordenar arrastrando y con el teclado, recortar arrastrando y con los campos, deshacer/rehacer, guardar versión, música con licencia, subtítulos a mano, interruptor y coste de los automáticos, montaje unido a la pieza, pieza con un diseño por capas.
- Trabajador con FFmpeg real: transiciones mixtas, recortes, texto con estilo, subtítulos quemados, volumen por clip, música, tipografía por texto y rechazo de la de otra marca.
- Base de datos: versiones del montaje, carga v2, enlace con la pieza, tipografías y archivos de la marca, licencia, procedencia, aislamiento y transcripción con cupo, permiso y coste (`tests/db/editor-reels.test.ts`, `tests/db/ia-transcripcion.test.ts`, casos nuevos en `aislamiento.test.ts`).

### Sin probar

- La e2e `29-editor-reels.spec.ts` (escrita; Docker no estaba arrancado el 21/11/2026).
- OpenAI de verdad: solo con HTTP simulado (sin clave). En particular, si `languages[]` es la forma correcta del campo para `gpt-transcribe` (la referencia no lo muestra) y si cada petición se redondea al segundo o al minuto.
- La vista previa en un navegador real (jsdom no dibuja): sincronía de clips y música, tipografías, desenfoque y tiempos con muchos clips; tampoco en tableta ni móvil.
- Leer el sonido de clips H.264/AAC en el navegador depende del navegador (Chromium sin códecs propietarios no los decodifica); los clips en R2 necesitan la regla CORS para poder leerlos.

### Para llevarlo a staging

1. Migración `20261207010000_reel_editor.sql` (vuelta atrás en `supabase/rollbacks/`).
2. Función nueva `ai-transcribe` y redesplegar `platform-integrations` (disponibilidad `reelSubtitles` y ajuste `AI_TRANSCRIPTION_MODEL`).
3. Vercel: `VITE_REEL_SUBTITLES_ENABLED=true` cuando haya clave de OpenAI (con el endpoint de la UE).
4. El trabajador, cuando se aloje, con esta versión (plan v2). Sin trabajador, el editor deja montar, previsualizar, guardar y aprobar, pero no «Montar el vídeo».

## 7. Editor más intuitivo (rama `f14/reels-intuitivo`, 21/11/2026)

Auditoría con el navegador en staging (escritorio y 375 px) y mejoras. **No cambia el plan v2 ni el
trabajador ni la base de datos**: todo es de la aplicación (y un arreglo en `media-storage`).

### Fricciones encontradas

| Fricción | Qué se hizo |
| --- | --- |
| Un reel nuevo era una pantalla negra con tres botones sueltos | Pantalla de salida «Empieza tu reel en tres pasos» (`Starter.tsx`): estilo, texto de apertura opcional y fotos, y el reel queda armado de un golpe (`startReel` en `ops.ts`) |
| El selector «Foto o clip» enseñaba 280 claquetas y añadía de una en una | `MediaPicker.tsx`: varias a la vez con número de orden, miniaturas de fotos y primer fotograma de los clips, filtro Todo/Fotos/Vídeos, buscador y «Ver más» por tandas de 48 |
| Las fotos salían como claquetas | Causa real: `media-storage/sign` devolvía 500 con ≥ ~100 rutas (la URL `in.(…)` de PostgREST pasaba el tope; reproducido en staging: 80 rutas 200, 150 rutas 500). Ahora consulta de 40 en 40 y registra el fallo. Hay que **redesplegar `media-storage`** |
| 4-5 respuestas 500 de `media-storage/sign` | La misma causa |
| En 375 px la página se salía de lado (scroll horizontal de 540 px) y la vista previa quedaba cortada | La rejilla no tenía `minmax(0,1fr)`; ahora una columna en móvil con este orden: vista previa, añadir, línea de tiempo, propiedades; en escritorio, como antes |
| Cabecera de tres filas de botones y título cortado | `PageHeader` común con el del editor de imagen: una acción principal, «Guardar versión» y «⋯» (Historial, cambiar nombre, pasos de estado, Publicar ahora, **Archivar**/Recuperar) |
| Sin «Archivar» ni cambiar el nombre | En «⋯» (con confirmación) |
| Montar exigía guardar antes (botón apagado sin explicación) y el estado del montaje estaba al final de la página | Panel «Vídeo final» bajo la vista previa: «Guardar y montar el vídeo» en un clic, estado (montando / listo con «Ver el vídeo» / fallo con el motivo) y «Montar otra vez» |
| Cambiar de plantilla era un desplegable sin pistas | Tarjetas con una muestra en movimiento (transición, zoom y posición del texto de cada estilo); «Estilo» en la barra, con aviso de qué se vuelve a poner |
| Duración y límites poco visibles | Barra de duración y texto de límites bajo la vista previa (máximo del reel y recomendación del estilo) |
| Instagram tapa partes del vídeo | Botón «Zonas que tapa Instagram» sobre la vista previa (arriba 12 %, abajo 22 %, derecha 14 %: aproximadas) |
| Asas de recorte de 8 px, imposibles con el dedo | 20 px en pantallas táctiles y sin que el gesto desplace la página |
| Mover/duplicar/quitar quedaba al final del panel | Arriba del panel del clip |
| Deshacer y rehacer eran dos iconos sin nombre | Botones con texto bajo la barra de añadir |

### Cómo probarlo

1. `media-storage`: en staging, tras redesplegar, abrir Biblioteca → Reels → Crear con el editor → «Elegir fotos y clips»: sin 500 en la red y con miniaturas.
2. Reel en un paso: Estilo (muestras en movimiento), texto de apertura, elegir 3 fotos en un orden → «Crear el reel con 3»: clips en ese orden y un texto al principio.
3. «Guardar y montar el vídeo» con cambios sin guardar: guarda la versión y encarga el montaje; el panel pasa por «Montando…» y acaba en «Listo · Ver el vídeo».
4. A 375 px: sin scroll lateral, vista previa entera, cabecera de una fila, asas de recorte grandes.
5. «⋯» → Archivar (pide confirmación) y Recuperar; «Cambiar el nombre».

### Comprobaciones de la auditoría que no cambian

- **Tipografía de marca**: si la marca no tiene .ttf/.otf el vídeo usa DejaVu Sans; ya se avisa en «Se verá distinto en el vídeo».
- **Subtítulos**: los automáticos solo salen con el interruptor y OpenAI en el servidor; sin ellos, el panel del clip dice que no están disponibles y deja escribirlos a mano. No se simula nada.

### Valorado y no hecho (pendiente)

- **(Hecho en §8)** **Cortes al compás de la música** y **portada del reel** (la publicación la manda desde f30, ver §8): necesitan detectar el ritmo (decodificar el audio) y un campo nuevo en el plan v2 con cambio a la vez en el trabajador, la base de datos y la publicación; es una fase aparte.
- **Textos con animaciones prediseñadas**: requieren que el trabajador anime `drawtext`; también cambia el plan.
- **Arrastrar para reordenar con el dedo** sigue dependiendo de los botones «Antes/Después» (un gesto sobre el clip choca con desplazar la línea de tiempo); un agarre largo sería la mejora.
- Probado solo con jsdom y con FFmpeg del trabajador sin cambios; **no se ha visto la pantalla nueva en un navegador** (la rama no trae `.env` y no se despliega): hay que mirarla en staging, sobre todo el móvil y las miniaturas de clips (`<video>` con `#t=0.1`, que depende del navegador y del CORS de R2).

## 8. Ritmo, textos animados, movimientos de cámara, portada y arrastrar (rama `f25/reels-ritmo-animacion`, 22/11/2026)

Lo que §7 dejó como «valorado y no hecho», hecho a la vez en la aplicación, el trabajador y la base de datos.

### Decisión: el plan v2 se amplía, no pasa a v3

Todo lo nuevo es **opcional** dentro del plan v2 (`version: 2`): los montajes ya guardados y los encargos
antiguos siguen siendo válidos y dan el mismo vídeo (sin `animation` el texto entra y sale con fundido, como
antes; la cadena de `drawtext` de un fundido no ha cambiado). Un v3 habría obligado a migrar versiones
guardadas sin ganar nada. Campos nuevos, sin ningún `null` (`request_media_job` pasa por `jsonb_strip_nulls`;
«sin valor» es campo ausente):

| Dónde | Campo | Valores |
| --- | --- | --- |
| Texto | `animation` | `{ in, out, seconds? }` con `in` ∈ none, fade, rise, typewriter, zoom, slide y `out` ∈ none, fade, fall, slide |
| Foto | `motion` | los de siempre + `pan-up`, `pan-down` |
| Foto | `motionAmount` | 0 a 0,3 (0,04 suave, 0,08 normal, 0,15 fuerte); sin él, el de la plantilla |
| Reel | `cover` | `{ type: 'frame', at }` (segundo del reel) o `{ type: 'photo', path }` (imagen de la marca) |

### 1. Música y cortes al ritmo (solo aplicación: `rhythm.ts`, `useBeats.ts`, `RhythmAndMotion.tsx`)

- `detectBeats`: curva de «novedad» del sonido (subida de energía por ventanas de ~12 ms) → autocorrelación entre 60 y
  180 pulsaciones por minuto (con preferencia por la gama media, para no confundir una octava) → fase con más energía
  en los golpes. Da `bpm`, `beats` (segundos de la canción) y `confidence`. `analyzeMusic` descarga y decodifica la
  canción con Web Audio, **solo al pulsar el botón**; el resultado se recuerda por ruta durante la sesión.
- «Ajustar los cortes a la música» (panel de la música): `fitCutsToBeats` reparte las duraciones para que cada
  corte (el centro de la transición) caiga en un golpe: de uno en uno, de 2 o de 4 (por defecto el que más se parezca
  al ritmo de ahora). Una foto dura de 0,5 a 10 s; un vídeo cambia su salida (nunca su entrada) sin pasar de lo que dura
  su archivo; si un clip no llega a su golpe se avisa y el siguiente corte se busca desde ahí. El orden no cambia.
  Es un cambio más del historial: **«Deshacer» lo quita** (probado: la función no toca el proyecto anterior).
- La línea de tiempo marca los golpes en la pista de música tras analizarla. Con música sin pulso claro
  (`confidence` < 0,25) se avisa.
- Límite: la fase es una estimación; si la música cambia de tempo, los cortes solo siguen el pulso global.
  La música con el principio en un silencio largo puede desplazar la fase.

### 2. Textos animados y movimientos de cámara

- **Una sola cuenta** para la vista previa y el vídeo: `textAnimState` (`worker/src/reel/animation.ts` y
  `src/features/reels/editor/animation.ts`, idénticas) y un ejemplo compartido
  (`worker/tests/fixtures/text-animation.json`) que las dos pruebas comparan. El trabajador la traduce a
  expresiones de `drawtext` (`alpha`, `x`, `y`, `fontsize`); la máquina de escribir, a un `drawtext` por línea y paso
  con el texto escrito hasta ese paso. Con FFmpeg real se comprueba **dónde está el texto** en fotogramas
  (deslizar, subir, zoom, máquina de escribir y bajar) contra la cuenta.
- Entradas: aparecer (la de siempre), subir (5 % del alto, con fundido), máquina de escribir (alineada a la
  izquierda del ancho útil, ~20 letras/s o la duración elegida), zoom (del 60 % al 100 %, con fundido), deslizar (desde
  la izquierda, con fundido). Salidas: desvanecer, bajar, deslizar (a la derecha), de golpe.
  Cada una dura `animation.seconds` o, por defecto, el fundido de la plantilla (0,4 s como mínimo en las nuevas) y
  nunca más de la mitad del texto.
- Panel del texto → «Animación»: dos desplegables y «Ver la animación» (reproduce la vista previa desde un poco antes).
- Panel de la foto → «Movimiento de cámara»: ocho tarjetas con la propia foto moviéndose en bucle (CSS; se paran con
  «reducir movimiento» del sistema) e «Intensidad» (suave/normal/fuerte). Nuevos: subir y bajar la cámara.
  La vista previa del reel dibuja el mismo movimiento (`panY`).
- Diferencias conocidas: en zoom, FFmpeg redondea el tamaño de letra a píxeles enteros y la franja detrás del texto no
  crece con la letra; la máquina de escribir con franja crece con el texto escrito.
- **No probado**: la imagen del trabajador es Alpine (FFmpeg 6.x probablemente). Las pruebas se hicieron con FFmpeg
  9.0.2 local; `fontsize` como expresión necesita FFmpeg ≥ 4.4. Comprobar con el despliegue en Fly.

### 3. Portada

- Panel «Portada» bajo la vista previa: «Usar el fotograma de ahora» (el del cabezal) o una de las fotos del reel.
- Al encargar el montaje, la base de datos pone `output.posterPath` (`<org>/<marca>/reels/<id>-cover.jpg`); el
  trabajador deja un JPEG: el fotograma del vídeo ya montado (con textos) o la foto girada y recortada a 9:16.
  Al terminar, el disparador nuevo `jobs_publish_reel_cover` lo da de alta en la biblioteca (carpeta «Reels», imagen,
  procedencia `role: 'cover'`, `cover_of_path` = ruta del vídeo, pieza y versión) y lo deja en `jobs.result.poster`
  (con `asset_id`). `jobs.result.assets` sigue empezando por el vídeo.
- **La publicación ya usa la portada** (migración `20261218010000`, rama `f30/instagram-pendientes`): el publicador
  busca el recurso con `provenance->>'role' = 'cover'` y `cover_of_path` igual al vídeo (`social_publication_cover`)
  y manda su dirección firmada como `cover_url` del contenedor `REELS`; sin portada, no manda nada. Qué parámetros
  admite Instagram y por qué siempre `cover_url`: `docs/publicacion.md`, «Portada del reel». Probado con la Graph API
  simulada; sin probar contra Meta real.
- Sin portada elegida, no se pide ninguna (como antes).

### 4. Arrastrar y recortar (solo aplicación: `Timeline.tsx`)

- Reordenar con el ratón, como antes (al instante). **Con el dedo, agarre largo** (350 ms, con vibración corta si el
  dispositivo la tiene): antes de eso el gesto sigue desplazando la línea; durante el arrastre la página no se mueve.
- Asas de recorte con el pulgar: 24 px en pantallas táctiles (antes 20) y con un agarre visible.
- Teclado: las asas son controles enfocables con el tabulador (`role="slider"`, valor leído por el lector de pantalla);
  flechas ±0,1 s y Mayús + flechas ±1 s, en el principio y final de clips, duración de fotos y entrada/salida de
  textos; Alt + flechas mueve el clip elegido. Cada ráfaga de teclas es un solo paso de «Deshacer».

### Probado

- Trabajador (FFmpeg real, `reel-animation.test.ts`): cuenta = ejemplo compartido; esquema (admite lo nuevo, rechaza lo
  inventado, sin nulos); posición real del texto en fotogramas para cada animación; subir/bajar la cámara; portada de
  fotograma y de foto (JPEG) y aviso si se pasa del final.
- Base de datos (`tests/db/editor-reels.test.ts`, +3): admite y rechaza (portada, animación, foto de otra marca), pone la
  ruta de la portada, y la portada del trabajo queda en la biblioteca unida al vídeo y a la pieza. Vuelta atrás en
  `supabase/rollbacks/20261215010000_reel_animation_cover.sql`.
- Aplicación: cuenta de animación igual que el trabajador, vista previa (compose) con máquina de escribir y subir,
  detección de ritmo con una pista sintética (120 y 90 pulsaciones, silencio), reparto de cortes (en un golpe, vídeo
  corto, sin música), portada y problemas, línea de tiempo (teclado, pulsación larga con el dedo, ratón, golpes) y
  paneles (animación, movimiento, cortes al ritmo).
- Reel de ejemplo con las animaciones, la cámara que sube y la portada, montado con el trabajador real.

### Sin probar

- En un navegador real: el análisis de ritmo con una canción de verdad (Web Audio; el formato depende del navegador y
  del CORS de R2), el agarre largo en un móvil real y la vista previa de animaciones (jsdom no dibuja).
- FFmpeg 6 de la imagen Alpine (ver arriba) y el despliegue de la migración en staging.

### Para llevarlo a staging

1. Migración `20261215010000_reel_animation_cover.sql` (vuelta atrás en `supabase/rollbacks/`).
2. Redesplegar el trabajador (Action `worker-fly.yml`): sin él, un plan con animaciones o portada falla en el esquema
   estricto del trabajador viejo.
3. La aplicación (Vercel), después de lo anterior.
