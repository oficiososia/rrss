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

## 9. Plantillas de reel por marca (rama `f35/catalogo-plantillas`, 22/11/2026)

Hasta aquí un reel solo partía de un **estilo** del trabajador (`worker/templates/*.json`: transición,
duración de foto y estilo de texto). Una **plantilla de reel** dice además qué planos lleva, cuánto dura
cada uno, qué textos salen y cuándo, con qué animación, qué movimiento de cámara y qué música le va. El
paso «Empieza tu reel» las ofrece: se elige una, pide N fotos o clips y deja el reel montado.

### Decisiones

| Tema | Decisión | Por qué |
| --- | --- | --- |
| Qué es | Un documento JSON propio (`kind: "rrss.reel-template"`, `schemaVersion: 1`) con **huecos** (`slots`), no un plan v2 con rutas falsas | Una plantilla no lleva archivos; el plan v2 exige rutas reales de la marca |
| Qué sale al usarla | Un **proyecto de reel normal** (plan v2 sobre un estilo del trabajador) | No cambian ni el trabajador, ni `request_media_job`, ni la publicación: nada que redesplegar salvo la migración y la aplicación |
| Estilo base | `style.id` es uno de `worker/templates` (lienzo, exportación, volúmenes y estilo de texto por defecto); la plantilla solo cambia lo que quiere | Los tres estilos siguen siendo la única fuente de lo que el trabajador sabe montar |
| Dónde se guarda | Tabla `brand_reel_templates` (una fila por plantilla y marca), no en el perfil ni en el código | Son varias por marca, se entregan una a una y las de cada marca llevan sus colores |
| Música | Solo una **sugerencia escrita** (`music.suggestion`, pulsaciones orientativas, si pide cortes al golpe) | La plantilla nunca incluye una canción: la licencia es de la marca (§2) |
| Tipografía | La plantilla no la lleva; al montar se pone la tipografía de reels de la marca, como en un texto nuevo | La base de datos rechaza cualquier `path` o `fontPath` en una plantilla |
| Colores | Hex en el documento guardado. El catálogo de la agencia los escribe por **papeles** (acento, fondo oscuro…) y los resuelve con el perfil de la marca al cargar | Sin código por cliente |

### Esquema compartido (`src/features/reels/reelTemplate.ts`)

Es el **único** validador: lo usan la aplicación (zod 3), `agency/` (lo importa tal cual) y la prueba del
catálogo. Quien genere plantillas de reel (el catálogo, «un reel como este» a partir de un vídeo de
referencia, o un futuro «Guardar como plantilla») escribe **este** documento y lo entrega con
`deliver_reel_templates`.

```jsonc
{
  "kind": "rrss.reel-template",
  "schemaVersion": 1,
  "purpose": "Para qué sirve, en una frase",            // ≤ 200
  "whenToUse": "Cuándo usarla",                          // ≤ 240
  "material": "4 a 6 fotos o clips, en este orden: …",   // ≤ 240
  "style": { "id": "corte-ritmico" },                    // un estilo de worker/templates
  "slots": [                                             // 1 a 30 planos, en orden; ≤ 90 s entre todos
    { "id": "resultado", "label": "Plato terminado", "hint": "El mejor plano: es el gancho.",
      "kind": "any",                                     // any | photo | video: pista, no obliga
      "shot": "detail",                                  // opcional: detail | wide | person | text (tipo de plano)
      "seconds": 1.8,                                    // 0,5 a 60 (una foto no pasa de 10)
      "motion": "zoom-in", "motionAmount": 0.15,         // si se llena con una foto
      "transition": { "type": "cut", "seconds": 0 },     // con la que entra; la del estilo si falta
      "volume": 0.7,                                     // si se llena con un clip; el del estilo si falta
      "optional": true }                                 // de los que se quitan si falta material
  ],
  "texts": [                                             // textos de MUESTRA (se sustituyen), hasta 30
    { "id": "gancho", "role": "hook",                    // hook | title | step | detail | cta
      "text": "Así se hace",
      "from": "resultado", "offset": 0,                  // entra con ese plano, tantos segundos después
      "to": "resultado", "endOffset": 0,                 // sale con ese (el mismo si falta), tantos antes (≤ 0)
      "position": "center",                              // top | center | bottom
      "style": { "sizeRatio": 0.085, "color": "#FFFFFF", "box": null,
                 "outline": { "color": "#000000", "widthRatio": 0.08 } },   // parcial: lo demás, del estilo
      "animation": { "in": "zoom", "out": "fade", "seconds": 0.4 } }        // las del plan v2
  ],
  "music": { "suggestion": "Instrumental con pulso marcado…", "bpm": { "min": 100, "max": 125 }, "cutsOnBeat": true },
  "cover": { "slot": "resultado", "offset": 0.9 },       // portada: fotograma de ese plano
  "origin": { "note": "De dónde sale", "url": "https://…" }   // opcional, solo informa
}
```

Reglas (todas en `reelTemplateSchema`): forma cerrada (un campo de más invalida), identificadores de plano
únicos, al menos un plano no opcional, textos que apuntan a planos que existen y no salen antes de entrar,
portada en un plano que existe. Funciones que se exportan:

| Función | Para qué |
| --- | --- |
| `validateReelTemplate(raw, styleIds?)` | Valida un documento; con `styleIds`, además que el estilo exista |
| `validateReelTemplatesDelivery(raw, styleIds?)` | Valida un archivo de entrega `{ format: "rrss.agency-reel-templates", version: 1, note, templates: [{ key, name, document }] }` (1 a 12) |
| `reelTemplateNeeds(t)` / `describeNeeds(t)` | Mínimo y máximo de piezas y duración: «4 a 6 fotos o clips · unos 13 s» |
| `slotsFor(t, n)` | Qué planos se usan con `n` piezas: si faltan, se quitan primero los opcionales (los últimos antes) y, por debajo del mínimo, los del medio (se conservan el primero y el último) |
| `buildReelFromTemplate(t, assets, style, { font })` | El proyecto de reel: cada pieza en su plano, textos con su plano (los de un plano quitado no salen), portada; sin música |

### Base de datos (migración `20261224010000_reel_templates.sql`, con vuelta atrás)

- Tabla `brand_reel_templates`: `brand_id`, `organization_id`, `template_key` (única por marca: entregar otra
  vez la misma la actualiza), `name` (≤ 80), `document` (lo de arriba; la base comprueba `kind`, versión,
  de 1 a 30 planos y ≤ 64 KiB) y `source`: `catalog` (catálogo de la agencia), `reference` (de un vídeo de
  referencia) o `editor` (guardada desde el editor).
- RLS: la ve quien ve la marca; sin políticas de escritura.
- `deliver_reel_templates(p_brand_id, p_templates jsonb, p_source default 'catalog')`: quien **edita** la
  marca; de 1 a 12 por llamada; rechaza lo que no es una plantilla de la versión 1, un estilo sin forma de
  identificador y cualquier `path` o `fontPath`; tope de **60 por marca**.
- `delete_reel_template(p_template_id)`: quien edita la marca.
- Casos en `tests/db/aislamiento.test.ts` («plantillas de reel por marca»).

### En el editor

- `useBrandReelTemplates` (`editor/api.ts`) lee las de la marca y deja fuera las que la aplicación no sabe
  montar (mal formadas o de un estilo que no existe).
- `Starter.tsx`: si la marca tiene plantillas, «Empieza con una plantilla» (nombre, para qué sirve, lo que
  necesita y la música que le va) encima de los tres pasos de siempre. Sin plantillas, la pantalla es la de
  antes.
- Al elegir una, `MediaPicker` enseña los planos en orden («1. Plato terminado · 2. …»), marca cuál toca y
  deja confirmar con menos piezas avisando de cuántas faltan. Al confirmar, `buildReelFromTemplate` y un
  aviso con la música sugerida. Es un paso del historial: «Deshacer» lo quita.

### Catálogo

Cuatro juegos (`restaurante`, `cocteleria`, `gimnasio`, `generico`) con 10 plantillas de reel y 10 de
publicación cada uno, en `agency/catalogo/`. Cómo se cargan: `agency/README.md`. Por qué estas:
`docs/plantillas-competencia.md`.

### Probado

- Unitarias (`reelTemplate.test.ts`): forma, rechazos, qué planos se usan según el material y montaje
  (duraciones, transiciones, tiempos de los textos, portada, clip corto, foto en plano largo).
- Componentes (`editorReels.test.tsx`): la pantalla de salida ofrece las plantillas de la marca, el selector
  guía por planos, el reel queda montado y se guarda como plan v2.
- Base de datos: aislamiento, permisos, rechazos, tope y borrado; la migración se deshace y se vuelve a aplicar.
- `agency/tests/catalogo.test.ts`: las 40 plantillas de reel con tres temas montan un plan v2 válido con el
  mínimo y con todo el material, con fotos y con clips.

### Sin probar

- **Ningún reel de plantilla se ha montado con el trabajador ni se ha visto en un navegador real**: las
  duraciones, los textos y las animaciones están comprobados contra los esquemas y las cuentas de la línea
  de tiempo, no a ojo. Antes de darlas por buenas hay que montar al menos una por juego en staging.
- La migración en staging.
- No hay todavía pantalla para borrar o renombrar plantillas de reel (existe `delete_reel_template`).

### Para llevarlo a staging

1. Migración `20261224010000_reel_templates.sql`.
2. La aplicación (Vercel). El trabajador no cambia.
3. Cargar el catálogo en cada marca (`agency/`, en seco primero).

### «Hacer un reel como este» escribe este formato (rama `f36/reel-como-este`, 22/11/2026)

«Guardar como plantilla» en el resultado de un análisis convierte su estructura a este documento
(`src/features/reels/like/template.ts`) y lo entrega con `deliver_reel_templates(marca, [...], 'reference')`:
la plantilla aparece en «Empieza con una plantilla» junto a las del catálogo. Para llevar el tipo de
plano que ve el modelo se añadió `slots[].shot` (`detail`, `wide`, `person`, `text`), **opcional**: las
plantillas de antes siguen siendo válidas y `buildReelFromTemplate` no lo usa (solo informa). El gancho
ya tenía sitio (`texts[].role = "hook"`). Correspondencia completa en `docs/reel-como-este.md` §8.

## 10. Editor «como los de móvil» (rama `f39/reels-editor-movil`, 22/11/2026)

Petición del dueño: que montar un reel sea tan fácil como en CapCut o en el editor de reels de Instagram. Se
toman sus **patrones de uso** (cómo se reparte la pantalla y qué gestos hay), no su aspecto, sus iconos ni
sus nombres: el diseño sigue siendo el de la aplicación. Antes de tocar nada se miró cómo lo hacen hoy.

### Qué hacen esos editores (consultado el 22/11/2026)

Casi todo sale de guías de terceros de 2025-2026; CapCut no publica una lista oficial de atajos y la ayuda de
Instagram no se dejó leer. Fuentes:

- CapCut móvil y escritorio: hollyland.com/blog/topics/capcut-video-editing (22/06/2026),
  videoproc.com/video-editor/how-to-use-capcut.htm (15/01/2026), unifab.ai/resource/how-to-use-capcut.htm
  (10/11/2026), capcutguide.com/capcut-playhead (15/11/2026), capcut.com/resource/capcut-tutorial-for-beginners
  (oficial, 20/08/2026) y fastshortcuts.com/shortcuts/capcut (27/09/2026).
- Instagram «Edits»: about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app (oficial),
  buffer.com/resources/how-to-use-instagram-edits (23/04/2025) y socialmediatoday.com (12/11/2026, curvas de
  velocidad).
- Editor integrado de reels de Instagram: socialmediaexaminer.com (12/06/2023) y guidingtech.com (16/05/2024),
  ya antiguas.
- TikTok: newsroom.tiktok.com/en-us/editing-tools (2022). No aporta nada distinto.

| Patrón | Quién lo hace | Aquí |
| --- | --- | --- |
| Vista previa arriba, línea de tiempo debajo y **barra inferior que cambia con lo elegido** (sin selección: añadir; con un clip: dividir, velocidad, volumen, sustituir…) | CapCut móvil, Edits | **Adoptado** (`ContextBar.tsx`). Nada elegido → Añadir, Texto, Música, Estilo, Plantilla, Subtítulos, Portada. Clip → Dividir, Recortar, Velocidad, Volumen, Silenciar, Filtro, Sustituir, Duplicar, Subtítulos, Borrar (una foto: Movimiento en lugar de velocidad y volumen). Texto → Editar, Estilo, Animación, Duración, Duplicar, Borrar. Música → Volumen, Al ritmo, Cambiar, Quitar |
| **Tira de fotogramas** en cada clip | CapCut, Edits | **Adoptado**, perezosa: solo de lo que está a la vista, de uno en uno y en pausa mientras se reproduce |
| El instante se elige **deslizando la pista bajo el cabezal** | CapCut móvil (descrito así en capcutguide; ninguna fuente dice literalmente «cabezal fijo en el centro») | **Adoptado** con el cabezal fijo en el centro, también en escritorio: un solo modelo, y la inercia la pone el desplazamiento del navegador |
| **Pellizco** para ampliar la línea; en escritorio, Ctrl + rueda | CapCut, Edits, editor de Instagram | **Adoptado** (pellizco, Ctrl + rueda y botones, con «ajustar») |
| Pistas apiladas de texto, audio y subtítulos; **onda** en el audio | CapCut, Edits de escritorio | **Adoptado**: textos en hasta tres filas, subtítulos, música con onda y golpes |
| **Dividir** el clip elegido en el cabezal | Todos | **Adoptado** (botón y tecla S) |
| **Velocidad** por clip | CapCut 0,1×–100× y curvas; Edits 0,1×–10×; Instagram 0,3×–4× | **Adoptado de 0,5× a 2×**: es lo que `atempo` de FFmpeg hace en un paso, en cualquier versión y sin cambiar el tono. Sin curvas |
| **Volumen** por clip y silenciar | CapCut, Edits | **Adoptado** (de 0 a 100 %; sin refuerzo por encima) |
| **Sustituir** conservando duración y efectos | CapCut, Edits | **Adoptado** |
| Botón pequeño **entre dos clips** para la transición, con «aplicar a todos» | CapCut, editor de Instagram, TikTok | **Adoptado**, con vista previa al elegirla |
| Texto: arrastrar y escalar sobre la vista previa, zonas seguras, estilos guardados | CapCut; Edits (zonas seguras y guías desde 2026) | **Adoptado**: arrastrar, esquina y pellizco para el tamaño, guías de centro, zonas de Instagram al arrastrar, dos toques para escribir y cuatro estilos prediseñados |
| **Borradores que se guardan solos**; deshacer y rehacer junto a la línea | CapCut | **Adoptado** (borrador en el servidor, ver abajo) |
| Marcadores de ritmo en la música | CapCut; Edits (junio de 2026) | Ya estaba (§8); ahora «Al ritmo» está en la barra de la música |
| Atajos: Espacio reproduce, flechas por fotograma, Ctrl+Z, Supr | CapCut escritorio | **Adoptado.** Dividir es **S** (así lo pidió el dueño; en CapCut es Ctrl+B, que aquí pliega el menú lateral) |

**No se adopta, y por qué:**

- Rotar un texto y curvas de velocidad: el trabajador no los monta; habría que ampliar el motor.
- Varias pistas de vídeo, pegatinas, efectos, pantalla verde, voz en off y extraer el sonido: otro alcance.
- Catálogo de música: la licencia es de la marca; se sube la pista propia (ver «Otros cambios»).
- Velocidad fuera de 0,5×–2×: encadenar `atempo` degrada el sonido.
- Reordenar con solo arrastrar en móvil: sigue siendo con pulsación larga, para que el dedo desplace la línea.

### Plan v2: campos nuevos (opcionales, sin nulos)

| Dónde | Campo | Valores | Trabajador |
| --- | --- | --- | --- |
| Clip | `speed` | 0,5 a 2 (ausente = 1) | Lee `seconds × speed` del archivo, `setpts=(PTS-STARTPTS)/speed` y `atempo=speed`. El tramo dura `(out − in) / speed`; los subtítulos del clip (en tiempo del archivo) siguen a la imagen |
| Clip y foto | `filter` | `bw`, `sepia`, `vivid`, `warm`, `cool`, `fade`, `drama` | Los nombres de los filtros rápidos de las fotos, **aproximados** con `hue`, `eq`, `colorbalance`, `colorchannelmixer`, `curves` y `unsharp` (`CLIP_FILTER_CHAINS`). No es la misma cuenta píxel a píxel que en las fotos: se avisa |
| Texto | `offset` | `{ x, y }`, de −0,5 a 0,5 (fracción del ancho y del alto) | Se suma en píxeles enteros a la `x` y la `y` de `drawtext`, también con animación |

Dividir, sustituir, duplicar y silenciar no añaden campos: dividir deja dos elementos seguidos del mismo
archivo (el segundo entra con corte seco), así que el reel dura lo mismo. Sin `speed`, `filter` ni `offset`,
la orden de FFmpeg es la de antes, carácter a carácter. Ejemplo compartido por los dos lados:
`worker/tests/fixtures/plan-v2-pro.json`.

### Borrador automático

- Tabla `reel_drafts` (migración `20261228010000_reel_editor_pro.sql`, con vuelta atrás): una fila por pieza
  de formato reel con el montaje tal cual está, aunque esté incompleto. La ve y la escribe quien **edita** la
  marca (`save_reel_draft`, `discard_reel_draft`); al guardar una versión, un disparador la borra.
- El editor guarda 1,5 s después del último cambio, al ocultar la pestaña y al salir de la pantalla
  (`useAutosave.ts`). El indicador dice «Guardando…», «Borrador guardado», «Guardado» o «Sin guardar», y solo
  dice «guardado» cuando el servidor lo confirma.
- Al abrir la pieza, si hay borrador de la versión vigente se abre con él (y se puede descartar); si es de
  una versión anterior, se ofrece recuperarlo. Un reel sin ninguna versión también vuelve como se dejó.
- Si el guardado no llega (sin conexión), queda una copia en el navegador (`localStorage`) que se usa al
  volver, y al salir por un enlace de la aplicación se pregunta antes. Si la tabla no responde (migración
  sin aplicar), el editor funciona como antes, sin guardado automático.
- **No es una versión**: no entra en el historial y no se puede montar, enviar a revisión ni aprobar.
  «Montar el vídeo» sigue guardando una versión antes.
- Un solo borrador por pieza: si dos personas editan a la vez el mismo reel, manda el último que guarda.

### Rendimiento de la vista previa

- El cabezal no es estado de React (`clock.ts`): al reproducir se dibuja el lienzo y se desliza la línea, y
  solo el reloj se repinta (cada décima).
- `prepareFrames`: el movimiento de cada foto, las líneas de cada texto y los subtítulos se calculan una vez
  por montaje, no en cada fotograma.
- Los `<video>` se crean cuando hacen falta (el que se ve y el siguiente, ya colocado en su entrada antes
  del corte) y nunca hay más de cuatro; las fotos de más de 1600 px de alto se reducen al cargarlas.
- Miniaturas: un fotograma por cada medio segundo de archivo, guardado y reutilizado a cualquier zoom.

### Otros cambios de esta rama

- Pantalla de trabajo: la página mide la ventana; solo se desplazan la línea de tiempo y el panel. En móvil
  el panel es una hoja que sube al pedir una herramienta.
- «Ver el vídeo» lo reproduce dentro del editor, con «Descargar», «Abrir en la biblioteca» y «Publicar ahora».
- Música: «Subir un audio» en el propio diálogo (MP3, M4A o WAV). **No hay pistas incluidas**: no se puede
  garantizar una licencia de uso comercial sin que el dueño elija la fuente.
- Un texto nuevo dura 2,5 s (antes, 0,5 s si el cabezal estaba al final).
- `?plantilla=<clave>` (lo pone «Nueva idea → Reel») abre el selector de esa plantilla de reel de la marca; y
  «Plantilla», en la barra, reparte el material que ya tiene el reel en los planos de una plantilla.

### Probado

- Trabajador con FFmpeg real (`worker/tests/reel-editor-pro.test.ts`): velocidad al doble y a la mitad (dónde
  cae el cambio de color y cuánto dura), un clip dividido da el mismo vídeo que entero, volumen por parte,
  filtros y texto desplazado.
- Base de datos (`tests/db/editor-reels.test.ts`, `aislamiento.test.ts`): campos nuevos admitidos y
  rechazados, nulos quitados, borrador (permisos, piezas que no son reels, archivadas, borrado al guardar
  versión), aislamiento entre organizaciones, y la migración se deshace y se vuelve a aplicar.
- Aplicación: `editorPro.test.ts` (operaciones, plan igual que el trabajador, barra, estilos, borrador, onda),
  `editorReels.test.tsx` y `timelineTactil.test.tsx` (barra por selección, dividir, sustituir, duplicar,
  velocidad, filtro, transición, textos sobre el vídeo, guardado automático y vuelta, música subida,
  plantilla por URL).
- **Navegador real** (Chromium, `tests/layout/reel-editor.spec.ts`, sin Supabase): sin scroll de página a
  1440×900, 1366×768 y 375×812 con 12 elementos; el cabezal en el centro; reproducción de 15 elementos a más
  de 20 fotogramas por segundo; fotogramas del clip en la tira y en la vista previa; onda de la música;
  Ctrl + rueda; arrastrar y editar un texto sobre el vídeo.

### Sin probar

- **Un móvil de verdad**: el pellizco, la inercia y la pulsación larga solo están probados con eventos
  simulados.
- **Safari / iOS**: el filtro del lienzo (`ctx.filter`, que ya usaba el desenfoque) y las unidades de
  contenedor con las que se ajusta la vista previa.
- Archivos reales de móvil en R2 (HEVC, vídeos largos): las miniaturas dependen de que el navegador los
  decodifique.
- El FFmpeg de la imagen de Fly (Alpine): las pruebas son con FFmpeg 9.0.2 local. `atempo` y los filtros de
  color existen desde hace muchas versiones, pero no se ha montado allí.
- La e2e `29-editor-reels.spec.ts` (adaptada a la barra nueva, sin ejecutar: necesita el stack local).
- La migración en staging.

### Para llevarlo a staging

1. Migración `20261228010000_reel_editor_pro.sql` (vuelta atrás en `supabase/rollbacks/`). Es independiente
   de `20270101010000_asset_usage.sql`, que tiene fecha posterior.
2. Redesplegar el trabajador (`worker-fly.yml`): el anterior rechaza un plan con `speed`, `filter` u `offset`.
3. La aplicación (Vercel), después de lo anterior.

## 11. Como CapCut, con un solo «Exportar» (rama `f52/reels-capcut`, 23/11/2026)

Cambio n.º 1 de la propuesta de simplificación que aceptó el dueño (`rrss-recursos-comparativa/simplificacion/`,
R1–R6 y R8), más lo que salió de la prueba de punta a punta del 23/11 (`rrss-recursos-comparativa/e2e-calidad/INFORME.md`,
fallos 4, 9, 10, 11, 12 y 24). Solo interfaz: sin migraciones, sin tocar el plan v2 ni el trabajador.

### Pantalla

- **Cabecera mínima:** volver, nombre, estado del guardado (automático), deshacer y rehacer, «⋯» y **un único
  «Exportar»**. En modo agencia, además, la etiqueta del estado de la pieza; si ya está en Instagram, «Publicada».
- **Una sola barra de herramientas** que cambia con lo elegido (`ContextBar.tsx`). Sin nada: Añadir, Texto, Música,
  Subtítulos y Estilo (y Guion si el reel sale de un análisis). Con un clip: Dividir, Duración, Velocidad (vídeo) o
  Movimiento (foto), Filtro, Sustituir y **«Más»** (Volumen, Silenciar y Subtítulos del clip si es vídeo; Duplicar y
  Borrar). Con un texto: Editar, Estilo, Animación, Duración y «Más» (Duplicar, Borrar). Música y transición, como antes.
- **Cada herramienta abre solo su ajuste** (`Inspector.tsx`, `sectionShown`): en escritorio, un panel estrecho al lado
  del vídeo que solo existe mientras está abierto (el vídeo ocupa el resto); en móvil, la hoja de abajo. Elegir algo
  ya no abre nada: cambia la barra. Una transición sí abre su ajuste al elegirla (es lo único que tiene).
- **Plantilla dentro de «Estilo»:** el diálogo tiene «Estilos» y «Plantillas de la marca».
- **Transporte:** reproducir y el reloj. «Volver al principio» es la tecla Inicio (o deslizar la línea).
- **Línea de tiempo** con su duración y su zoom encima (escritorio); en móvil, el zoom es el pellizco.
- **Móvil:** el editor ocupa la pantalla entera (`max-lg:fixed inset-0 z-40`), por encima de la cabecera de la marca y
  de la barra inferior de la aplicación (también la nueva con «＋ Crear»), sin tocar `src/layout/`. «Rehacer» pasa al
  «⋯» por debajo de 640 px. Los siete botones de un clip caben a 375 px sin deslizar la barra.
- **Avisos flotantes** (`notify.ts`): en móvil bajan hasta debajo de la cabecera y duran 3 s, para no tapar
  «Exportar», deshacer ni la barra de herramientas (antes el toque se lo quedaba el aviso).
- **«Nuevo reel → Desde una plantilla»** (`?plantilla=`): mientras llegan las plantillas de la marca no se enseña la
  galería; se piden directamente las fotos de la elegida, sin la galería detrás.

### «Exportar»

`ExportSheet.tsx` (hoja en móvil, diálogo en escritorio) y `exportFlow.ts` (puro):

- Al pulsarlo **se monta si hace falta**: si lo que se ve no tiene vídeo, guarda la versión (sin aviso) y encarga el
  montaje. Espera a que llegue la lista de montajes («Comprobando…») para no montar otra vez lo que ya está. Un
  montaje que falló no se repite solo: se dice por qué y se ofrece «Probar otra vez».
- **El vídeo de lo que se ve se reconoce por su montaje** (`renderOfPlan`: mismo estilo y mismo plan, con las claves
  ordenadas y sin la tipografía que añade la base de datos), no por el número de versión. Cambiar solo el pie, o
  volver a algo ya montado, **no pide montar otra vez**. Para publicar un reel vale cualquier vídeo de la marca
  (`private.publication_media_problem`), así que esto no cambia ninguna regla.
- Tres salidas: **Descargar**, **Guardar en la biblioteca** (el vídeo ya se guarda solo en «Reels»: el enlace lo abre
  allí; no se finge un guardado) y **Publicar o programar**. Debajo, los avisos de la vista previa en una línea (sin
  jerga: ni .ttf, ni DejaVu, ni FFmpeg, ni «trabajador»), la **Portada** y los **Vídeos anteriores**.
- Con un **archivo borrado** de la biblioteca (rama f49) no se monta: la hoja lo dice lo primero y «Ir a lo que falta»
  lleva a él. Sin trabajador en la instalación: «En esta instalación no se puede montar el vídeo».

### «Publicar o programar»

`PublishPanel.tsx`, dentro de la misma hoja:

- **Pie y hashtags**, como en las publicaciones, con «Redactar con IA» si la tarea `post.caption` está configurada y
  la marca no está en modo agencia. Se guardan en el proyecto del reel como `copy` (`{ caption, hashtags,
  aiGenerated? }`), el mismo campo que leen el publicador (`content_versions.data -> 'copy'`) y la etiqueta de
  contenido con IA. No va al trabajador. **Sin texto alternativo**: Instagram no lo admite en los reels (el
  publicador solo lo manda con imágenes).
- Si el reel sale de **«Hacer un reel como este»** y todavía no tiene pie, al abrir «Publicar o programar» se pone el
  que propuso el análisis (se puede deshacer). Si otra rama (f56) lo deja ya en el `copy` de la pieza, se usa tal cual.
- **Cuenta:** la primera de Instagram conectada (con selector si hay varias). **Sin cuenta, se dice antes**, con el
  enlace a Marca → Cuentas conectadas, y no se aprueba nada.
- **Cuándo:** «Ahora» o «Programar…» con día y hora en la zona de la marca. Se usa **el vídeo recién montado** sin
  pedir que se elija. «Ahora» abre el diálogo de siempre (`PublishNowDialog`) con la cuenta y el vídeo ya puestos.
- **Ya programada:** lo dice y deja cambiar la hora (la misma publicación) o publicarla ya.
- **Ya publicada:** «Publicada» con la fecha y «Ver en Instagram» (lee `scheduled_publications`). En lugar de
  «Publicar o programar» sale «Publicar otra vez», que avisa de que saldrá repetida y **hace una copia** del reel: la
  base de datos admite una sola publicación por pieza (`scheduled_publications_one_per_content_idx`) y no vuelve a
  publicar una ya publicada.

### Aprobación (decisión del dueño)

- **Autogestión** (`organizations.work_mode = 'self'`): no se ve. «Publicar o programar» guarda la versión si hay
  cambios y la aprueba por debajo con los pasos que exige `set_content_status` (`selfApprovalSteps`: idea → borrador →
  aprobada; borrador o en revisión → aprobada). Sin permiso de aprobar, el botón lo explica. No se ha cambiado ninguna
  tabla ni función de estado.
- **Modo agencia:** se conserva el flujo. El estado y su siguiente paso (Enviar a revisión, Aprobar) van en la hoja y
  en «Publicar o programar»; los demás cambios, en «⋯». «Ahora» solo con la pieza aprobada y sin cambios; programar
  sí, y queda en el calendario en espera hasta que se apruebe (como hasta ahora).
- Los textos de **cupo** desaparecen en autogestión («Hacer un reel como este» y subtítulos automáticos): se dice el
  coste. En modo agencia, igual que antes.

### Dónde ha ido cada cosa

| Antes | Ahora |
| --- | --- |
| «Guardar versión» (cabecera) | Guardado automático; «⋯ → Historial → Marcar esta versión» |
| «Enviar a revisión», «Aprobar», «Pasar a borrador» (cabecera y «⋯») | Autogestión: no se ven («Publicar o programar» aprueba). Agencia: el siguiente paso en «Exportar», el resto en «⋯» |
| «Guardar y montar el vídeo», «Montar otra vez» | «Exportar» (monta si hace falta) |
| «Ver el vídeo» (franja de estado, panel y montajes) | La hoja «Exportar» enseña el vídeo |
| «Publicar ahora» (cabecera, «⋯» y visor) | «Exportar → Publicar o programar → Ahora» |
| Franja de estado (Idea, Versión 1, aviso, «Listo») | Guardado en la cabecera; versión en «⋯ → Historial»; estado solo en modo agencia |
| Avisos fijos («1 aviso», «sin trabajador») | Una línea en «Exportar» |
| Portada y Montajes (barra y panel) | «Exportar → Portada» y «Exportar → Vídeos anteriores» |
| Plantilla (barra) | «Estilo → Plantillas de la marca» |
| Recortar, Volumen, Silenciar, Subtítulos, Duplicar y Borrar del clip | «Duración» (recortar); el resto, en «Más» de la barra |
| Volver al principio y zonas de Instagram (transporte) | Tecla Inicio; «⋯ → Ver lo que tapa Instagram» |
| Deshacer y rehacer (transporte) | Cabecera (en móvil, rehacer en «⋯») |
| Panel de propiedades fijo con todo a la vez y atajos escritos | Un ajuste cada vez; los atajos, en la ayuda de cada botón |

**Acciones a la vista con un clip elegido** (botones, enlaces y campos; sin la línea de tiempo ni los textos sobre el
vídeo; `tests/layout/reel-editor.spec.ts`): **52 → 13** a 1366 px y **22 → 12** a 375 px (antes, además, las 7 de la
cabecera y la barra de la aplicación). Sin nada elegido: 11 y 10. La propuesta hablaba de 49 y 22, contadas a ojo.

### Probado

- `exportFlow.test.ts` (estado de la hoja, montar solo si hace falta, el vídeo por su montaje aunque cambien la
  versión, el orden de las claves o la tipografía, y pasos de aprobación), `editorPro.test.ts` (barra y «Más»),
  `editorReels.test.tsx` (cabecera mínima, exportar sin y con cambios, estados de la hoja, un ajuste cada vez, marcar
  versión, autogestión y agencia, pie y hashtags en la versión, programar con el vídeo montado sin elegir, sin cuenta,
  pie del análisis, ya publicada, plantilla por URL sin galería), `mediosBorrados.test.tsx` (con un archivo borrado no
  se monta y se va a él) y `reelLike.test.tsx`.
- **Navegador real** (Chromium, `test:layout`): sin scroll de página a 1440, 1366 y 375 px; acciones contadas; el
  editor tapa la barra de la aplicación en móvil; el ajuste solo enseña su sección; la hoja «Exportar» y «Publicar o
  programar» caben a 375 px; un aviso no tapa la cabecera ni la barra, y «Exportar» responde con él a la vista.

### Sin probar

- Un móvil de verdad y Safari (la hoja, los avisos desplazados, `env(safe-area-inset-*)`).
- Publicar y programar contra Supabase y Meta reales: solo con la base simulada. La e2e `29-editor-reels.spec.ts`
  está adaptada al flujo nuevo, **sin ejecutar** (necesita el stack local).
- «Redactar con IA» con un proveedor real, y el pie del análisis cuando lo traiga f56.

## 12. «Terminar en Instagram (para poner música)» (rama `f62/terminar-en-instagram`, 23/11/2026)

Los reels se publican **sin música** (decisión del dueño): la API de Instagram no crea borradores ni pone canciones de
su biblioteca. Propuesta del dueño: «dejarlos preparados y que le metan la música en Instagram». Desde «Exportar» se
manda el vídeo montado y su pie al móvil, allí se abre Instagram, se pone la música y se publica; después la
aplicación sabe que salió. **El vídeo sale sin música, como antes**: aquí no se añade ninguna.

### El flujo

1. **«Exportar → Terminar en Instagram (para poner música)»**, debajo de «Publicar o programar». Se enciende con el
   vídeo listo y abre su paso con el **pie y los hashtags** (los mismos campos que «Publicar o programar»:
   `CopyFields`, sacado de `PublishPanel.tsx`) y, en modo agencia, el estado de la pieza.
2. **En el móvil** (`navigator.share` con archivos **y** pantalla táctil): «Compartir con Instagram». En el mismo toque
   se copia el pie con los hashtags al portapapeles (aviso «Pie copiado: pégalo en Instagram») y se abre el diálogo de
   compartir del sistema con el MP4, donde se elige Instagram. El MP4 se baja al abrir el paso («Preparando el
   vídeo…») porque el diálogo tiene que abrirse en el toque, sin esperar a una descarga. Cerrar el diálogo sin elegir
   nada no marca nada.
3. **En un ordenador** (sin `navigator.share` con archivos, o sin pantalla táctil: Chrome en Windows o macOS también
   comparte archivos, pero ese diálogo no lleva a Instagram): «Descargar, copiar el pie y abrir en el móvil» descarga el
   MP4, copia el pie y enseña un **código QR** con un enlace firmado al vídeo (15 min con el almacén de Supabase; con
   R2 lo fija `media-storage`: una hora) y los pasos en tres líneas: abre Instagram y crea un reel; elige el vídeo;
   añade música y pega el pie. La dirección es la firma del archivo (identificadores de la organización y la marca y el
   nombre del montaje): sin datos personales. El pie queda en el portapapeles del ordenador; se dice que, para tenerlo
   en el móvil, se abra el reel en la aplicación desde el móvil.
4. **Ayuda** («¿No te sale la canción que quieres?»): las cuentas de creador suelen tener la biblioteca de música de
   Instagram; las de empresa a veces solo tienen la música libre de Meta («Sound Collection») y no todas las canciones
   salen. Qué canciones hay lo decide Instagram (cambia con el país y la cuenta): no se promete nada más.
5. **Al mandarlo**, la pieza se deja lista como al publicar (`prepareForPublish`, que ahora comparte con «Publicar o
   programar»: guarda la versión si hay cambios y, en autogestión, la aprueba por debajo) y queda **«Pendiente de
   publicar en Instagram»** (`start_manual_publication`). En la cabecera, «Pendiente en Instagram» (oculto por debajo
   de 640 px); en «Exportar», la línea con «Ya lo publiqué», «Buscar en Instagram» (si hay cuenta) y «No lo voy a
   publicar». Mientras está pendiente, «Publicar o programar» no se deja (saldría dos veces); se puede volver a mandar
   al móvil. En modo agencia, como «Publicar ahora»: solo aprobada y sin cambios.
6. **«Ya lo publiqué»**, con el enlace del reel si se tiene (opcional, solo `instagram.com`): queda «Publicada (marcada
   a mano)». Sin enlace, «Añadir el enlace» después.
7. **Sola**: con una cuenta de Instagram conectada, al abrir el editor con algo pendiente (o marcado sin enlace) y al
   volver a la pestaña (de Instagram, en el móvil; como mucho una vez por minuto) se leen las últimas publicaciones de
   la cuenta y se empareja el reel. Si lo reconoce, queda «Publicada» con su enlace, sin pegarlo a mano.

### Emparejar (`manualFlow.ts`, `matchReel`)

La importación de publicaciones guarda de cada una el tipo, el pie, la fecha y el enlace, pero **la Graph API no da la
duración de un vídeo** (referencia de IG Media consultada el 23/11/2026: no hay `duration` ni nada parecido), así que
no se empareja por duración. Se empareja por:

- **tipo:** un vídeo (`VIDEO`) o un reel (`REELS`);
- **fecha:** publicado después de mandarlo al móvil (10 min de margen por los relojes) y como mucho un mes después;
- **pie:** el que se copió es lo que se pega en Instagram; vale si comparte al menos el 60 % de sus palabras (sin
  mayúsculas, tildes, signos ni emojis).

Varias publicaciones igual de buenas: no se elige ninguna y se dice («márcalo tú con “Ya lo publiqué”»). Sin pie, solo
vale un único vídeo publicado en los dos días siguientes. Una publicación de Instagram es de una sola pieza (la base de
datos lo exige) y nunca una que ya salió por la API.

### Leer las últimas publicaciones (`social-import/recent`)

Ruta nueva de la función `social-import` (`supabase/functions/_shared/social/recent.ts`): lee **una página** de
`/{ig-user-id}/media` (las 25 más recientes, la misma llamada que la importación) y la guarda en
`social_imported_media` con `social_recent_save`, **sin tocar ninguna importación en marcha ni su cursor**. Basta con
editar la marca (`social_recent_claim`); importar exige gestionarla. Token caducado: la cuenta pasa a «hay que volver a
conectarla», como en la importación. Cambios en la importación, mínimos: la ruta `recent` en
`social-import/handler.ts` (+25 líneas) y su conexión en `social-import/index.ts` (+3).

### Base de datos (migración `20270121010000_manual_publications.sql`, con vuelta atrás)

- **`manual_publications`**: una fila por reel entregado (pieza, versión aprobada, vídeo, pie copiado, cuándo se
  mandó). Estados `pending` → `published`, o `cancelled`. **Pendiente no es publicado**: «published» exige la fecha y
  cómo se supo (`manual` o `import`), y lo encontrado en la cuenta, el identificador de la red. No es
  `scheduled_publications`: allí «published» exige el identificador que da la red al publicar por la API, y la regla
  dura de aquella tabla no cambia.
- **Solo lo aprobado** (la versión vigente, sin archivar), **solo reels de Instagram** y con un MP4 o MOV de la
  biblioteca de la marca. Una pieza **o se publica por la API o se entrega a mano**: `start_manual_publication` se
  niega si está en el calendario, y un disparador nuevo en `scheduled_publications`
  (`scheduled_publications_manual_guard`, solo al insertar) se niega si está entregada a mano y sin cancelar.
- RPC con la capacidad `edit`: `start_manual_publication`, `confirm_manual_publication`, `match_manual_publication`
  (vídeo de una cuenta de la marca, posterior a la entrega, de ninguna otra pieza) y `cancel_manual_publication`. Del
  servidor (clave de servicio): `social_recent_claim` y `social_recent_save`. RLS de lectura para quien ve la marca; sin
  escritura directa. Auditoría de altas, cambios de estado y borrados.

### Probado

- **Unitarias** (`manualFlow.test.ts`): el texto que se pega, cuándo se comparte y cuándo se descarga, el enlace que se
  pega, el emparejado (tipo, fecha, pie, empates, sin pie, ya usado) y el QR.
- **Componentes** (`terminarEnInstagram.test.tsx`): compartir en el móvil con `navigator.share` (pie copiado y aviso,
  el MP4 como archivo, aprobado por debajo y pendiente); cerrar el diálogo no marca nada; en un ordenador sin
  `navigator.share`, descarga, pie copiado, QR con enlace de 15 min y los tres pasos; «Ya lo publiqué» con enlace
  (rechaza otro dominio; queda «Publicada»; «Publicar otra vez» en lugar de terminarla otra vez); emparejado automático
  con publicaciones simuladas; «todavía no aparece» y volver a buscar.
- **Base de datos** (`tests/db/terminar-en-instagram.test.ts`, PGlite con las migraciones reales y la Graph API
  simulada): pendiente no es publicado, solo lo aprobado y solo reels, una u otra con la API, «Ya lo publiqué» y el
  enlace, cancelar, emparejar y sus negativas, leer las últimas sin tocar las importaciones, permisos; más los casos de
  `aislamiento.test.ts`.
- **Navegador real** (`test:layout`, Chromium): el paso cabe a 375 y 1366 px, descarga `reel.mp4`, copia el pie y
  enseña el QR (≥ 140 px) y los pasos sin salirse.

### Sin probar

- **Compartir a Instagram desde un móvil de verdad** (Android e iOS): que Instagram aparezca en el diálogo de compartir
  con un MP4, que abra el editor de reels con él y que deje poner música. No se ha podido probar aquí.
- Escanear el QR con un móvil y guardar el vídeo (en iOS, desde Safari); el enlace con R2.
- La música en una cuenta de empresa y en una de creador: lo de «Sound Collection» es lo que dice Meta en general, sin
  comprobar con cuentas reales.
- Leer las últimas publicaciones contra la Graph API real (sin aplicación de Meta): solo contra la simulada.
- El calendario y la analítica no ven todavía lo publicado a mano (leen `scheduled_publications`): no salen su día ni
  sus métricas.

### Para llevarlo a staging

Migración `20270121010000_manual_publications.sql` y redesplegar la función `social-import` (ruta `recent`). La
dependencia nueva `qrcode-generator@2.0.4` (MIT, sin dependencias) va dentro de la aplicación.
