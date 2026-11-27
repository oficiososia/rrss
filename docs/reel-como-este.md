# Hacer un reel como este

Rama `f36/reel-como-este` (22/11/2026), desde `claude/focused-noether-hk502p`.
Estado: **implementado y probado en local con proveedores simulados; nada desplegado ni probado
contra un proveedor de IA real, Fly ni una red social.**

Una persona sube un reel o un vídeo que le gusta (o pega su enlace) y el sistema lo **estudia** y lo
rehace con las ideas y el material de la marca. El vídeo de referencia solo se analiza: no se
reutilizan sus imágenes, su música ni sus textos, no entra en la biblioteca y se borra al terminar
(salvo que se pida guardarlo como referencia privada).

## 1. Qué sale

| Salida | Qué es | Dónde queda |
| --- | --- | --- |
| 1. Plantilla | Nº de planos, duración de cada corte, tipo de plano (detalle, general, persona, texto), transiciones, textos en pantalla (posición, momento, tamaño), ritmo y compás, duración total y portada | En el análisis; con «Guardar como plantilla», en `brand_reel_templates` (formato compartido, origen `reference`) |
| 2. Guion y lista de planos | Qué grabar y en qué orden, con duración y un consejo por plano | En el análisis y, al abrir el editor, en el guion (`guide`) de la pieza |
| 3. Borrador | Un reel del editor con las fotos y clips de la biblioteca que encajan con cada plano; lo que no encaja queda como hueco «Falta grabar: …» | Pieza de formato reel, editable como cualquier otra |
| 4. Textos | Gancho, textos en pantalla y pie de foto con el tono de la marca | En el análisis; los de pantalla, también en el borrador |

## 2. Recorrido

Biblioteca → Reels → **«Hacer un reel como este»** (`/biblioteca/reels/como-este`).

1. **Subir o pegar el enlace.** Archivo MP4, MOV o WebM (hasta 3 minutos y 50 MB) o un enlace. Opcional:
   de qué quiere la marca que vaya su reel, «Transcribir lo que se dice» y «Guardar el vídeo como
   referencia privada». El **coste máximo estimado** está a la vista antes del botón.
2. **Progreso por pasos**: recibido → medir cortes, planos y ritmo (sin IA) → mirar los planos y
   escribir la versión de la marca (IA; empieza sola una vez, porque el coste ya se enseñó) → resultado.
   Si la IA falla se explica (el cupo, aparte) y hay «Reintentar»; no se reintenta sola.
3. **Resultado** con las cuatro salidas, el coste real y dos acciones: **«Abrir en el editor»** y
   **«Guardar como plantilla»**.

Cuándo se ofrece (nada simulado): `VITE_REEL_LIKE_ENABLED=true` **y** `VITE_MEDIA_WORKER_ENABLED=true`
**y** la función `ai-reel-like` responde que la marca puede (hay un modelo con visión cargado y con
precio, la marca tiene perfil y, en modo agencia, quien pregunta es personal de la agencia). Si la función
no contesta o dice que no, el botón no sale.

## 3. Qué se hace sin IA y qué con IA

| Paso | Dónde | IA de pago |
| --- | --- | --- |
| Duración, tamaño, fotogramas por segundo | Trabajador (`ffprobe`) | No |
| Cortes secos y transiciones suaves → planos y su duración; si un plano es imagen fija | Trabajador (FFmpeg `scdet`, `worker/src/analyze/scenes.ts`) | No |
| Un fotograma por plano (hasta 12, 512 px de lado) | Trabajador | No |
| Volumen, golpes y tempo; qué parte de los cortes cae en un golpe | Trabajador (`analyze/rhythm.ts`, la misma cuenta que el editor de reels, y `analyze/audio.ts`) | No |
| Trozos de sonido para transcribir (hasta 120 s) | Trabajador | No |
| Bajar el vídeo de un enlace | Trabajador (`analyze/download.ts`) | No |
| Emparejar cada plano con la biblioteca (tipo, etiquetas, carpeta, nombre) y montar el borrador | Navegador (`src/features/reels/like/draft.ts`) | No |
| Convertir la estructura en plantilla de reel de la marca | Navegador (`like/template.ts`) | No |
| Lo que se dice en el vídeo | `ai-reel-like` → transcripción de OpenAI (la de `ai-transcribe`) | **Sí** (opcional) |
| Tipo de cada plano, rótulos (papel, posición, tamaño) y el reel rehecho para la marca (qué grabar, gancho, textos, pie) | `ai-reel-like` → **una** llamada a un modelo con visión | **Sí** |

**Texto en pantalla (OCR).** No se ha metido un OCR en el trabajador: los rótulos de un reel van
sobre vídeo, con tipografías decorativas, contornos y animaciones, y un OCR ligero (Tesseract) falla
ahí mucho y habría engordado la imagen de Fly. Los lee el modelo de visión en la misma llamada.

Lo medido (cuántos planos, cuánto dura cada uno, cómo se pasa de uno a otro, el compás) **no lo decide
el modelo**: `buildReelLikeResult` lo toma de la medición. El modelo solo aporta lo que hay que mirar
o escribir. Una imagen fija medida es «foto» diga lo que diga el modelo.

### Límites de la detección (son estimaciones)

- Corte seco: fotograma con `score` de `scdet` ≥ 10. Transición suave: racha de 0,15 a 2 s con el
  cambio de imagen ≥ 1,8 veces el del segundo anterior del mismo plano. Un movimiento brusco y corto de
  cámara puede contarse como transición; un encadenado muy largo (más de 2 s), no.
- Con más de 30 cortes se quedan los 29 más claros (se avisa). Con más de 12 planos, los fotogramas se
  reparten y el tipo de los planos no vistos es una suposición (se avisa).
- El sonido no distingue la voz de la música: «Transcribir lo que se dice» manda a transcribir los
  tramos con sonido; con solo música conviene desmarcarlo.

## 4. Enlaces: sin trucos

El trabajador hace una petición HTTP normal, con las protecciones contra SSRF de la lectura de webs
(`extract/net.ts`), agente `rrss-referencias` y respeto de `robots.txt`. Vale un enlace directo a un
archivo de vídeo o una página que declare su vídeo en los metadatos públicos para compartir
(`og:video`). **No** se inicia sesión, no se usan cookies, no se ejecuta JavaScript, no se leen los datos
internos del reproductor ni se usan herramientas de descarga.

En la práctica Instagram, TikTok y YouTube **no** ofrecen el archivo así: el trabajo falla sin
reintento con un mensaje del tipo «Instagram no deja descargar este vídeo desde un enlace (…).
Descarga el vídeo en tu dispositivo y súbelo aquí como archivo», que es lo que ve la persona junto a
«Subir el archivo». El vídeo bajado de un enlace vive en la carpeta temporal del trabajo y nunca se guarda.
Del enlace solo se guarda el dominio en `reel_references.source_host` (la dirección completa queda en la
carga del trabajo, `jobs.payload`).

## 5. Archivos y borrado

| Archivo | Dónde | Cuándo se borra |
| --- | --- | --- |
| Vídeo subido | `<org>/<marca>/referencias/<uuid>.<ext>` (Supabase Storage, carpeta privada; no es un recurso de la biblioteca) | Al guardar el resultado de la IA, salvo «Guardar como referencia privada» |
| Fotogramas y trozos de sonido | `<org>/<marca>/referencias/<id del análisis>/` | Al guardar el resultado de la IA, siempre |

`ai-reel-like` los borra en el acto (en R2 o en Supabase). Además, al terminar, fallar, cancelarse,
descartarse o **caducar** (un análisis medido que nadie termina en 24 h), sus rutas pasan a
`storage_cleanup_queue`, que barre la limpieza de siempre. Límite honesto: esa cola la vacía la
aplicación cuando alguien que edita la marca abre la biblioteca o descarta un análisis; no hay una
tarea programada propia. El vídeo guardado como referencia se ve desde el resultado («Ver el vídeo de
referencia») y se borra al descartar el análisis.

**Qué sale hacia el proveedor de IA**: los fotogramas (hasta 12 JPEG pequeños) y, si se pidió, el sonido
de los tramos con voz, además del perfil de la marca y la medición. Van al proveedor configurado con el
mismo criterio de datos que el resto de la IA de texto (endpoint de la UE salvo que se acepte lo
contrario). Son imágenes de un vídeo de un tercero y pueden llevar personas: el modelo recibe la orden
de no describir personas reconocibles, marcas ni lugares concretos, y de ese vídeo no se guarda ni se
publica nada. **Pendiente de revisión legal** junto al resto de tratamientos (`docs/PENDIENTES.md`).

## 6. Coste

Precio de ejemplo: OpenAI `gpt-6.1-terra` con el recargo de la UE (1,10 / 5,50 USD por millón de tokens
de entrada / salida, `docs/ia-texto.md`) y `gpt-transcribe` (0,00495 USD/min). Cifras calculadas con el
código (`reelLikeWorstCaseInput`), no medidas contra el proveedor.

| Concepto | Máximo que se reserva | Lo normal (estimación) |
| --- | --- | --- |
| Mirar y escribir (una llamada) | 17.800 tokens de entrada (12 fotogramas a 820 de cota cada uno, 30 planos, perfil, transcripción) + 12.000 de salida ≈ **0,086 USD** | Reel de 7 planos sin voz: ≈ 5.000 de entrada + 2.000 de salida ≈ **0,02 USD** |
| Transcribir la voz | 120 s ≈ **0,010 USD** | 30 s ≈ 0,0025 USD |
| **Total** | **≈ 0,10 USD** | **≈ 0,02 USD** |

Con `gpt-6-luna` el máximo baja a ≈ 0,02 USD; con `gpt-5.4-mini`, ≈ 0,084 USD. Medir (FFmpeg) no gasta IA:
solo tiempo de máquina de Fly (segundos).

- La pantalla enseña el máximo **con el precio configurado** (`ai-reel-like`, acción `options`): mirar y
  escribir + la voz que se vaya a transcribir. Después enseña el coste real.
- Cupo y registro, los de siempre: `ai_reserve_generation` → `ai_generations` con los propósitos
  `reel.like` (tarea `text`) y `reel.like.transcript` (tarea `transcription`). Sin cupo o con la IA en
  pausa por el tope global, no se llama al proveedor y el análisis queda medido para reintentar.
- Cada imagen reserva 820 tokens (cota: OpenAI en detalle bajo cobra 85 fijos o por teselas, hasta
  ≈ 630; Anthropic ≈ 350). **Sin comprobar** cuánto cobra de verdad cada modelo por imagen.

## 7. Modelo y modo agencia

- **Modelo**: `AI_TEXT_REEL_LIKE_PROVIDER` / `AI_TEXT_REEL_LIKE_MODEL` como secretos de la función o, si no
  están, el general de «Integraciones → IA de texto» (`AI_TEXT_PROVIDER` / `AI_TEXT_MODEL`), con su precio
  en `AI_PRICES` (`_shared/ai/text/reel-like-config.ts`). No se ha añadido a las tareas de Integraciones.
  Tiene que admitir imágenes: `openai` y los tres de Anthropic (`anthropic`, `anthropic-bedrock`,
  `anthropic-vertex`); con `mistral` la función no se ofrece y el registro dice por qué.
- **Modo agencia** (decisión a confirmar por el dueño): se aplica la regla de la IA de imagen y de vídeo
  (`ai_brand_access`): en una marca en modo agencia lo usa el personal de la agencia o de la plataforma;
  el resto recibe 409 `agency_mode` antes de tocar el cupo. Se eligió esa y no la del texto (cerrado para
  todos) porque la herramienta es hoy de uso interno de la agencia y sus marcas están en modo agencia.

## 8. Piezas

| Pieza | Archivo |
| --- | --- |
| Trabajo `media.reel.analyze` | `worker/src/handlers/reel-analyze.ts`, `worker/src/analyze/` (carga: `schemas/reel-analyze-payload.v1.schema.json`) |
| Encargo y análisis | Migración `20261223010000_reel_like.sql`: `request_media_job` admite el tipo, tabla `reel_references`, `reel_reference_finish/claim`, `discard_reel_reference`, `set_reel_reference_content`, caducidad |
| Formato del análisis | `supabase/functions/_shared/reels/like.ts` (sin dependencias) |
| Visión en los adaptadores | `AiInput.images`; `_shared/ai/text/vision.ts`, `openai.ts`, `anthropic-messages.ts` |
| Tarea y función | `_shared/ai/text/tasks/reel-like.ts`, `supabase/functions/ai-reel-like/` |
| Pantalla | `src/features/reels/like/` (`ReelLikePage`, `api`, `draft`, `template`, `GuidePanel`, `useDraft`) |
| En el editor | `ReelEditor` abre una pieza sin versiones con `?referencia=<id>`; `project.ts` admite `guide` |

### Borrador y huecos

`matchShots` puntúa cada recurso de la biblioteca contra las palabras de búsqueda del plano (etiqueta 3,
carpeta 2, nombre 1; sin acentos ni plurales), suma 1 si el tipo coincide (foto o vídeo) y resta 1 si el
clip es más corto que el plano. Sin ninguna palabra en común no encaja: es un hueco. Cada recurso se usa
una vez. `buildDraft` monta un proyecto de reel normal (plan v2) con los planos que encajan, su duración
y su transición, los textos de los planos que existen y el guion. En el editor, el panel «Guion: qué
grabar» lista los planos; «Elegir de la biblioteca» rellena un hueco en su sitio (`fillGuideShot`), trae
su texto y es un paso más de «Deshacer». El guion se guarda con la versión (`content_versions.data.guide`)
y **no** viaja al trabajador. Un reel del editor dura como mucho 90 s: de una referencia más larga se
usan los planos que caben (se avisa).

### Convergencia con las plantillas de reel por marca

No hay tabla ni formato propios de plantillas. «Guardar como plantilla» convierte la estructura del
análisis al formato compartido `rrss.reel-template` (`src/features/reels/reelTemplate.ts`,
`docs/editor-reels.md` §9) y la entrega con `deliver_reel_templates(marca, [...], 'reference')`: aparece
en «Empieza con una plantilla» del editor junto a las del catálogo. Correspondencia:

| Análisis | Plantilla (`rrss.reel-template`) |
| --- | --- |
| Plano: duración, transición, foto o vídeo | `slots[]`: `seconds`, `transition`, `kind` |
| Tipo de plano | `slots[].shot` (`detail`, `wide`, `person`, `text`): **ampliación compatible** del formato, opcional |
| Descripción genérica y consejo | `slots[].label` y `hint` |
| Texto en pantalla: papel, plano, posición, tamaño | `texts[]`: `role` (`hook`, `step`, `detail`, `cta`), `from`/`to`, `position`, `style.sizeRatio`; el texto de muestra es el escrito para la marca |
| Compás medido | `music`: sugerencia escrita, `bpm` (±5) y `cutsOnBeat` (≥ 60 % de cortes en el golpe) |
| Portada | `cover`: plano y desfase |
| De dónde vino | `origin.note` (solo el dominio; nunca la dirección ni un archivo) |

## 9. Prueba real de un comando

Hoy OpenAI en staging devuelve 401 (clave de proyecto no europeo contra `eu.api.openai.com`, decisión
pendiente del dueño). Cuando haya clave válida:

```bash
node scripts/reel-como-este-prueba.ts            # en seco: modelo, lo que falta y coste máximo
node scripts/reel-como-este-prueba.ts --apply    # genera el vídeo de ejemplo, lo mide y llama UNA vez al modelo
```

Lee del entorno la misma configuración que la función (`AI_TEXT_PROVIDER`/`_MODEL` o
`AI_TEXT_REEL_LIKE_*`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AI_PRICES`); con `--apply` avisa del coste
máximo (≈ 0,03 USD con `gpt-6.1-terra` para el vídeo de ejemplo), pide confirmación, respeta
`--max-coste` (0,25) y deja `resultado.json` con el consumo y el coste reales. No toca Supabase.
Opciones: `--video`, `--voz`, `--idea`, `--perfil`. **No se ha ejecutado con `--apply`.**

## 10. Probado

- **Trabajador** (FFmpeg real, `worker/tests/reel-analyze.test.ts`, 25): cuentas de cortes, planos, sonido
  y compás; descarga contra un servidor local (directo, `og:video`, `robots.txt`, 403/404, tope de peso,
  SSRF); y el trabajo entero con un vídeo de 4 planos con rótulos generado con FFmpeg: 4 planos a menos
  de 0,1 s de lo esperado, dos cortes secos y un encadenado de 0,5 s, 120 pulsaciones, fotogramas y sonido.
- **Base de datos y función** (`tests/db/reel-como-este.test.ts`, 30, y casos en `aislamiento.test.ts`):
  encargo, permisos, plan, final del trabajo, fallo, cancelar, descartar, caducidad, RLS; función con
  proveedores simulados (coste máximo, cupo, permiso, modo agencia, reintentos, borrado de archivos);
  visión en OpenAI y Anthropic (cuerpo de la petición, sin red); entrega de la plantilla con origen
  `reference`; y **de punta a punta**: vídeo generado con FFmpeg → trabajador real → cola y base de datos
  reales (PGlite) → función con IA simulada → plantilla con los cortes y duraciones del vídeo, y ni rastro
  del vídeo. Esa prueba (y la del script) se salta donde no hay FFmpeg ni `worker/node_modules` (el
  trabajo `comprobar` del CI); en el trabajo `trabajador` del CI corre la del análisis.
- **Aplicación**: unitarias (`like/draft.test.ts`, `like/template.test.ts`), componentes
  (`like/reelLike.test.tsx`, 11: cuándo se ofrece, coste, subir, enlace que no deja, resultado, guardar
  plantilla, abrir en el editor y rellenar un hueco, solo lectura, errores) y maquetación en Chromium
  real (`tests/layout/reel-como-este.spec.ts`, 8: a 375 px y 1366 px sin scroll lateral en inicio,
  progreso, resultado y editor).

## 11. Sin probar

- Ningún proveedor real: ni la visión de OpenAI o Anthropic (formato de las imágenes, tokens que cobra
  cada una, calidad de lo que escribe), ni la transcripción con trozos en AAC (`audio/mp4`).
- El trabajador en Fly con este trabajo (el FFmpeg de la imagen Debian tiene `scdet`, pero no se ha
  ejecutado allí) ni `worker-gateway` con él; la función `ai-reel-like` desplegada (solo su lógica en Node).
- Enlaces reales de Instagram, TikTok o YouTube (no se ha llamado a ninguna red).
- Vídeos reales de móvil (HEVC, 4K, 60 fps, con rotación): la detección de cortes solo se ha visto con
  vídeos sintéticos.
- La e2e completa en navegador contra el stack local (no hay Docker en el PC de desarrollo; no se ha
  escrito un archivo de `tests/e2e` para esto).

## 12. Para llevarlo a staging

1. Migraciones, en orden: `20261223010000_reel_like.sql` y `20261224010000_reel_templates.sql` (la de
   las plantillas de reel; «Guardar como plantilla» la necesita). Vueltas atrás en `supabase/rollbacks/`.
2. Función nueva `ai-reel-like`. No hace falta redesplegar `worker-gateway` (el tipo `media.%` ya pasa)
   ni `ai-transcribe`. Las demás funciones de IA comparten `_shared/ai` (cambios compatibles: `images`
   opcional); se pueden redesplegar cuando toque.
3. Trabajador: redesplegar la imagen de Fly (Action `worker-fly.yml`) para que atienda
   `media.reel.analyze`. Sin eso, el análisis se queda «Midiendo» (en cola).
4. Proveedor: un modelo con visión en Integraciones → IA de texto (o los secretos
   `AI_TEXT_REEL_LIKE_PROVIDER` / `_MODEL` de la función) con su precio en `AI_PRICES`; la marca necesita
   perfil y plan con `reels` y `ai_text`.
5. Prueba real: `node scripts/reel-como-este-prueba.ts --apply` (§9).
6. Interruptor: construir la aplicación con `VITE_REEL_LIKE_ENABLED=true` (además de
   `VITE_MEDIA_WORKER_ENABLED=true`).

## 13. Tras la prueba real del 23/11/2026 (`f56/copiloto-fiable`)

Prueba de punta a punta en staging (`rrss-recursos-comparativa/e2e-calidad/INFORME.md`, apartados
1.5 y 3.5, fallo 5). Probado en componentes con la red simulada; nada contra servicios reales.

- **Vídeo de la biblioteca.** Antes: solo subir un archivo o pegar un enlace. Ahora: pestaña «De la
  biblioteca» con los vídeos de la marca (`useLibraryVideos`). Se lee el elegido con su dirección
  firmada y se sube una **copia** a la carpeta privada de referencias (`fetchLibraryVideo`): sigue el
  camino de siempre (`request_media_job` con `source.path`) y se borra al terminar; el vídeo de la
  biblioteca no se toca. Su duración ajusta el coste máximo de la voz. Formato, peso y duración se
  comprueban antes (`libraryVideoProblem`). Sin migraciones ni cambios en el trabajador.
- **Enlaces de Instagram.** Antes: se decía que no se podía descargar después de pegar el enlace y
  estudiarlo. Ahora: el aviso está en la pestaña antes de pegar nada, y un enlace de Instagram,
  TikTok, YouTube o Facebook (`closedNetwork`) se dice al momento y no se manda a estudiar. Un enlace
  directo a un archivo sigue como antes.
- **Pieza nueva.** Antes: «Seguir en el editor» abría la pieza ya apuntada en el análisis, aunque
  estuviera archivada («Prueba UX reel como este»). Ahora: el botón crea **siempre** una pieza nueva
  («Abrir en el editor» la primera vez, «Hacer otro reel con esto» después) y la apunta en el
  análisis. La anterior solo se enlaza («Ya hiciste un reel con este análisis: …») si sigue viva
  (`useLinkedPiece`: ni borrada ni archivada).
- **El nombre escrito.** Antes: «Nuevo reel → Hacer un reel como este» perdía el nombre. Ahora: el
  diálogo lo pasa en `?nombre=` (`withName`), la pantalla lo enseña en «Nombre del reel», viaja con
  el análisis y es el título de la pieza que se crea (si está vacío, el del guion).
- **El pie del análisis.** Antes: el reel se creaba sin pie y se publicaba sin texto. Ahora: el
  borrador lleva `copy` con el pie y los hashtags que propuso el análisis, marcado `aiGenerated`
  (`likeCopy` de `useDraft.ts`); es el `copy` que el editor de reels ya admite («Exportar» lo deja
  cambiar) y el publicador lee de la versión aprobada.

Pruebas: `like/reelLike.test.tsx` (15; nuevas: enlaces cerrados avisados antes, enlace directo,
vídeo de la biblioteca, el nombre, pieza nueva con la anterior archivada y el pie en la versión
guardada).

## 14. Papeles y cierre de la marca (`f67/pendientes-reels`, 23/11/2026)

Antes: el borrador salía sin cierre de marca y sus textos sin papel (el trabajador lo deducía). Ahora
`buildDraft` escribe `role` en cada texto (lo «grande», titular; lo demás, rótulo; la llamada del final,
`cta`) y, con el perfil de la marca (`BrandLook.kit`, que arma `useDraft` con `brandReelKit` y
`reelLogoPath`, como el editor), pone `outro` con `withBrandOutro`: la llamada del guion pasa al cierre si
está en el reel; si no, la del perfil. Al rellenar después el hueco de la llamada, también va al cierre.
Los textos acaban cuando entra el cierre. El borrador espera al perfil y a sus logotipos, y las fotos
llevan su punto de interés y su máscara guardados. Pruebas: `like/draft.test.ts` (5 nuevas) y
`like/reelLike.test.tsx` (perfil con logotipo oscuro y claro: el cierre lleva el claro).
