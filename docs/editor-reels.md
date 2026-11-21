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

| Tema | Decisión | Por qué |
|---|---|---|
| Dónde vive el reel | Una **pieza** (`content_items`, formato `reel`) cuyas versiones (`content_versions.data`) son un **proyecto de reel**: `{ "kind": "reel", "template": { "id" }, "plan": <plan v2> }`, `schema_version` = 2 | Reutiliza versiones, estados, aprobación, historial, calendario y «Publicar ahora» sin tablas nuevas. `migrateDocument` rechaza ese JSON (no tiene `schemaVersion`), así que el editor de imagen y las vistas previas de campañas lo tratan como «no es un documento» sin romperse |
| Qué editor abre una pieza `reel` | El editor de reels. Una pieza `reel` antigua con un diseño por capas se puede seguir abriendo en el de imagen (`?editor=imagen`) | Lo de antes sigue funcionando |
| Plan del reel | **Versión 2** en `worker/src/reel/schema.ts` y en `src/features/reels/editor/project.ts`. El plan v1 sigue admitido: el trabajador lo **migra** a v2 al leerlo (`migratePlanV1`) y lo monta con el mismo motor | Un solo motor; los encargos v1 dan el mismo vídeo |
| Transiciones | Por elemento (`clip.transition`, la que entra desde el anterior), con los tipos que ya tienen las plantillas (`cut`, `fade`, `fadeblack`, `dissolve`, `slideleft`, `slideup`). Cadena mixta: corte = `concat`, el resto = `xfade` | Las plantillas pasan a ser el punto de partida: rellenan transición, duración de foto, estilo del texto y volúmenes |
| Subtítulos | Se guardan **en cada clip, en tiempo del archivo** (`clip.subtitles`): al recortar o mover el clip siguen sincronizados. El trabajador los pasa a la línea de tiempo y los quema con `drawtext` (no hace falta libass) | Un solo camino de texto, con la tipografía de la marca |
| Transcripción | Edge Function nueva `ai-transcribe` con el **servicio de IA** de siempre (`createAiService`: reserva de cupo → proveedor → coste en `ai_generations`, tarea `transcription`, que el plan cubre con `ai_text`). Proveedor OpenAI con la clave `OPENAI_API_KEY` de Integraciones | Coste y cupo por organización, como la IA de texto |
| Cómo se consiguen los tiempos | El navegador decodifica el sonido del tramo usado del clip, lo pasa a 16 kHz mono, lo corta en trozos de voz (≤ 8 s, por pausas) y manda los trozos en WAV; el servidor transcribe cada trozo; cada trozo es un subtítulo con su principio y su final | El modelo vigente (`gpt-transcribe`) no devuelve marcas de tiempo; `whisper-1` sí, pero se apaga el 26/02/2027. Así funciona con cualquier modelo |
| Interruptor | `VITE_REEL_SUBTITLES_ENABLED=true` **y** el servidor dice `reelSubtitles` (OpenAI cargable con el criterio de la UE). Sin OpenAI, los botones no salen | Lo que no funciona no sale |
| Vista previa | En el navegador, un lienzo 9:16 que compone en cada fotograma: clips (`<video>` sincronizados), fotos (con el mismo movimiento y desenfoque), transiciones aproximadas, textos y subtítulos (mismas cuentas de tamaño, márgenes y cortes de línea que el trabajador) y sonido (volumen por clip, música con entrada y salida suaves). Se avisa de lo que se verá distinto | Lo más fiel posible sin FFmpeg en el navegador |
| Música | Pista de tipo audio de la biblioteca, volumen, entrada y salida suaves, punto de inicio. Al elegirla, aviso de licencia y confirmación obligatoria (`music.license.confirmed`), que va en el plan y en la procedencia del vídeo | La licencia es responsabilidad de la marca |
| Montaje unido a la pieza | `request_media_job` admite `content: { id, version }` (de la misma marca, formato `reel`, versión existente). El vídeo resultante lleva `content_id` y `content_version` en su procedencia; programar y «Publicar ahora» proponen el montaje de la versión vigente | «Con lo que ya existe»: la regla de publicación de reels no cambia |
| Límite | 90 s en v2 (máximo del esquema de plantillas). En v1, el de la plantilla, como antes | |

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

| Modelo | Estado | Precio | Marcas de tiempo |
|---|---|---|---|
| `gpt-transcribe` | Recomendado | 0,0045 $/min (estimado por OpenAI) | No |
| `whisper-1` | Obsoleto, se apaga el 26/02/2027 | 0,006 $/min | Sí (`verbose_json`) |
| `gpt-4o-transcribe` / `-mini-` / `-diarize` | Obsoletos, mismo apagado | 0,006 / 0,003 / 0,006 $/min | Solo `-diarize` |

Por defecto se usa `gpt-transcribe` y se reserva **0,00495 $/min** (82,5 micros por segundo):
el precio publicado más el 10 % que OpenAI cobra por el procesamiento regional (UE) a los
modelos publicados desde el 05/03/2026; la página no dice si ese recargo alcanza a este
modelo, así que se cuenta como cota. Un reel de 30 s de voz: ≈ 0,0025 $. Se cambia sin tocar
código con `AI_TRANSCRIPTION_MODEL` y `AI_PRICES` (`"openai/<modelo>": { "audio_seconds": … }`).
Sin comprobar: si OpenAI redondea cada petición (cada trozo) al segundo o al minuto.
