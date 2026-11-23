# Reels con calidad de profesional

Rama `f54/reels-calidad` (worktree `rrss-f54-reels-calidad`), desde `claude/focused-noether-hk502p`,
23/11/2026. Petición del dueño tras ver los reels de staging de ese día: «la calidad de los reels
es muy mala, no queda nada profesional». Pruebas del problema en
`rrss-recursos-comparativa/e2e-calidad/capturas/` (`ct-manual-reel.mp4`, `ct-ia-reel.mp4`).
Montajes de antes y después en `rrss-recursos-comparativa/reels-calidad/` (`comparativa.html`).

## Principio

Todo reel acaba en el trabajador (`worker/src/reel/build.ts`), venga del editor, de una
plantilla, de «Hacer un reel como este» o de un encargo antiguo. Por eso **la calidad mínima la
pone el trabajador con cualquier plan** (encuadre, textos, zonas seguras, gradación,
codificación, sonido) y la aplicación solo decide lo que el trabajador no puede saber (qué
material, con qué colores de la marca y con qué cierre).

## Qué cambió, punto por punto

| # | Problema | Qué se hizo | Dónde |
| --- | --- | --- | --- |
| 1 | Textos superpuestos («Vaca nA la brasa60 días») | Cada texto se mide con la tipografía real (`fontmetrics.ts` lee `head`, `hhea`, `hmtx` y `cmap`) y se coloca en su franja. Si dos coinciden a la vez y en la vertical, el segundo **se apila** debajo o encima dentro de la zona segura; si no cabe, **se encadena** (el primero sale antes y el segundo entra después). Nunca se dibujan dos textos en el mismo sitio. Lo mismo con los subtítulos. En la aplicación, `separateTexts` hace lo mismo por franjas para que la vista previa no los pinte encima | `worker/src/reel/textlayout.ts` (`layoutText`, `placeTexts`), `src/features/reels/quality.ts` |
| 2 | Letra fina, pequeña (~60 px), blanca con sombra mínima, cortes feos, sin animación | **Papeles** (`headline`, `label`, `price`, `cta`) con tamaño mínimo (titular ≥ 92 px, rótulo ≥ 60 px, precio ≥ 81 px, llamada ≥ 78 px en 1080 de ancho). Si el plan no dice el papel, se deduce (el primer texto del primer segundo es el gancho; una llamada «Reserva…» al final es `cta`; con «€» es precio). Tipografía de reserva **Montserrat ExtraBold / SemiBold** (SIL OFL 1.1) dentro de la imagen; la de la marca manda si la hay. Cortes de línea **equilibrados** y sin dejar «de», «la», «y»… al final de una línea («Lo que sale / de la cocina»). Legibilidad garantizada: un texto pequeño sin caja lleva **caja translúcida**; uno grande, **contorno fino y sombra**. Fundido mínimo de 0,2 s (antes, el estilo «Corte rítmico» los hacía aparecer de golpe) y, con papel explícito, animación por defecto (subir, zoom). `y_align=font`: todas las líneas con la misma caja | `textlayout.ts`, `build.ts` (`legible`, `draw`), `worker/fonts/`, `src/features/reels/quality.ts` (`roleTextStyle`) |
| 3 | Llamada final en una cajita dorada diminuta, sin cierre de marca | **Cierre con la marca** (`plan.outro`): la última foto muy desenfocada y oscurecida (o el color de fondo de la marca), el **logotipo** con fundido, la **llamada grande** en caja del color de acento, y usuario y dirección si los hay, durante 1,5–3 s (2 por defecto), con fundido de entrada. En la aplicación, `brandReelKit(perfil)` y `brandOutro`/`withBrandOutro` lo arman desde el perfil (colores por papel, `channels` de Instagram, `business.locations`, `voice.callsToAction`) | `build.ts` («Cierre con la marca»), `schema.ts` (`outroSchema`), `quality.ts` |
| 4 | Fotos horizontales recortadas por el centro (encimera, cables, zapatillas) | **Encuadre por sujeto**: la máscara de «Quitar el fondo» de esa foto si el plan la trae (`subjectMaskPath`), el punto guardado (el `focalPoint` del plan; la aplicación lo saca de los recortes guardados con `savedFocalPoints`) y, si no hay nada, **saliencia** sin modelos (lo que se aparta del color del borde, contraste y detalle, con preferencia suave por el centro). El recorte se centra ahí y **la cámara se acerca hacia el sujeto** con movimiento **suavizado** (entrada y salida lentas). Si el sujeto no cabe en 9:16 (una bandeja alargada en una foto horizontal: a pantalla llena se vería menos del 60 % del plato), la foto se reduce (como mucho al 62 %) sobre una copia suya desenfocada en vez de cortar el plato. La portada de foto también se recorta sobre el sujeto | `worker/src/reel/subject.ts`, `build.ts` (`photoFraming`), `handlers/reel-template.ts` |
| 4b | Color desigual | **Gradación** ligera e igual en todo el reel (`plan.grade`: `natural` por defecto, `warm` o `none`): algo más de contraste y color, enfoque suave y viñeteado apenas visible, después de unir los planos y antes de los textos. No se fuerza la matriz BT.709: con FFmpeg 9 anulaba parte de los filtros de color que trabajan en RGB. | `build.ts` (`GRADE_CHAINS`) |
| 5 | La misma foto en 3 planos; fotos de móvil flojas antes que las buenas | **Sin repetir**: `buildReelFromTemplate` quita los repetidos (con menos fotos distintas que planos, se quitan planos, como con poco material); `matchShots` («Hacer un reel como este») nunca usa dos veces el mismo archivo. **Por calidad**: `reelAssetScore` puntúa resolución, nitidez (bytes por píxel), proporción y procedencia (un PNG sin fondo, un recorte o una captura no son tomas) y `matchShots` la usa para desempatar y apartar lo flojo; `rankReelAssets` y `strongestFirst` quedan listos para los selectores. El trabajador avisa si un archivo sale varias veces | `src/features/reels/quality.ts`, `reelTemplate.ts`, `like/draft.ts`, `like/api.ts` (pide `width`, `height`, `bytes`) |
| 6 | Pista de audio a 2 kbps (silencio) | Sin música y sin sonido de clips, el vídeo sale **sin pista de audio** (antes, una pista muda). Con sonido, AAC a **160 kbps**. El resultado del trabajo dice de dónde sale el sonido (`result.output.audio`: `music`, `clips` o `none`) y `reelAudioNotice(plan)` da el aviso «Sin música». No se incluye ninguna pista de música (ver fuentes abajo) | `build.ts`, `handlers/reel-template.ts`, `quality.ts` |
| 7 | H.264 a 2,9–3,7 Mbps | **High 4.2, ~9 Mbps** (`-b:v 9000k`, `-maxrate 12150k`, `-bufsize 18000k`, `preset medium`), GOP de 2 s, 30 fps, `yuv420p` y `+faststart` (campo `export.videoBitrateKbps` de las plantillas del trabajador; sin él, el CRF de antes) | `build.ts` (`reelVideoArgs`), `worker/templates/*.json` |
| 8 | Ritmo plano, sin gancho | El titular del principio entra en el **primer segundo** (si un gancho empieza entre 0,15 y 1 s, se adelanta a 0,15 s). En el catálogo: movimientos al 8–10 % (antes, zooms del 15 % que mareaban), fotos de 1,5 s en «Fotos con ritmo» (antes 1,3 s), tipos de transición por plano ya variados (corte, fundido, deslizar). Con música, el editor ya tiene «Ajustar los cortes a la música» | `build.ts`, `agency/catalogo/reels.ts` |

### Plantillas del catálogo (10 de restaurante)

Revisadas las diez (`agency/catalogo/juegos.ts` → `reels.ts`). Cambios en los estilos comunes, que
usan todas:

| Estilo | Antes | Ahora |
| --- | --- | --- |
| Gancho (titular) | 0,085 (92 px), contorno 8 % (de dibujo animado) | 0,095 (103 px), contorno 4 % + sombra del trabajador, interlineado 1,1 |
| Rótulo | 0,055 (59 px), caja al 75 % | 0,064 (69 px), caja oscura de la marca al 85 %, interlineado 1,45 (cajas que casi se tocan) |
| Llamada / acento | 0,06 (65 px), margen 37 % | 0,078 (84 px), caja del acento de la marca, margen 26 % |
| Pie | margen 37 % | margen 26 % (zona segura de abajo: 400 px = 20,8 %) |
| Movimiento | zoom 15 % en el primer plano | 10 % (y 8 % en las que alternan) |

Además, la prueba del catálogo comprueba ya las zonas seguras del dueño (250 px arriba, 400 px
abajo) y que ningún texto baje de ~60 px. Con el cierre de la marca, la llamada de la plantilla
pasa al cierre (`withBrandOutro`) en vez de salir dos veces.

## Plan v2: campos nuevos (todos opcionales)

En el trabajador son `.nullable().default(null)` (un nulo es ausente; `request_media_job` hace
`jsonb_strip_nulls`). En SQL, migración `20270113010000_reels_calidad.sql` (vuelta atrás en
`supabase/rollbacks/`). Esquemas publicados regenerados (`npm run schemas`).

| Dónde | Campo | Valores |
| --- | --- | --- |
| Foto | `subjectMaskPath` | PNG de «Quitar el fondo» de esa foto (imagen de la marca) |
| Texto | `role` | `headline`, `label`, `price`, `cta` |
| Reel | `outro` | `{ cta (1–60), seconds? (1,5–3, 2), handle?, address?, logoPath? (imagen o logotipo de la marca), background?, accent?, accentText? }` |
| Reel | `grade` | `natural` (por defecto), `warm`, `none` |

Sin estos campos, el reel sale igualmente con todo lo de arriba (papel deducido, saliencia,
gradación natural…); solo el cierre necesita `outro`.

## Lo que falta en las pantallas (de otros agentes)

El esquema del proyecto del editor (`src/features/reels/editor/project.ts`, zona de la rama f52)
es estricto y todavía **no** guarda `role`, `outro`, `grade` ni `subjectMaskPath`: un proyecto con
ellos no se podría abrir. Por eso las plantillas y «Hacer un reel como este» no los escriben aún.
Para activarlos:

1. `project.ts`: añadir los cuatro campos como opcionales (sin nulos), igual que en la tabla.
2. Al crear un reel desde plantilla o desde «Hacer un reel como este»: `brandReelKit(perfil, rutaDelLogo)`
   → `withBrandOutro(plan, kit, duración)`, y en `buildReelFromTemplate` pasar `colors: kit.colors`
   y `focalPoints: savedFocalPoints(biblioteca)`; la máscara, con `subjectMasks(biblioteca)`.
3. **Aviso «Sin música»**: `reelAudioNotice(plan).notice`, junto a «Montar el vídeo» y en el panel
   «Vídeo final»; cuando el trabajo termina, `jobs.result.output.audio` lo confirma.
4. Selectores de material (rama f49): ordenar con `rankReelAssets` y no dejar elegir dos veces el
   mismo archivo (`uniqueAssets`).
5. Vista previa (`compose.ts`): para parecerse al vídeo, aplicar los mínimos de `textlayout.ts`
   (tamaño por papel, caja translúcida en rótulos pequeños sin caja, cortes equilibrados, zonas
   seguras 250/400/60 px y apilado). Hoy la vista previa puede enseñar un texto más pequeño o
   en otro sitio que el vídeo.

## Música: fuentes propuestas (para que elija el dueño)

No se ha metido ninguna pista. Condiciones según lo que se sabía a 23/11/2026, **sin volver a
leerlas en línea hoy**: hay que leer los términos vigentes antes de elegir.

| Fuente | Licencia | Para qué sirve | Ojo |
| --- | --- | --- | --- |
| **Colección de sonidos de Meta** (Meta Sound Collection, en Meta Business Suite / Creator Studio) | Gratis, licencia de Meta para usar en vídeos publicados en **Facebook e Instagram** | Lo más directo para reels de Instagram: es la que ya recomienda el catálogo | Solo vale para publicar en Meta; no para TikTok, web ni anuncios fuera de Meta |
| **Pixabay Music** | Licencia de contenido de Pixabay: uso comercial gratis y sin atribución | Pistas instrumentales para todas las redes | No se puede revender la pista tal cual; algunas pistas tienen reclamaciones de Content ID en YouTube |
| **Epidemic Sound** (plan para empresas) | Suscripción de pago con licencia comercial para redes sociales de la empresa | Catálogo grande y profesional, sin dudas de licencia | Hay que mantener la suscripción; comprobar que el plan cubre a cada marca si la agencia publica por varias |

En la aplicación la licencia ya la confirma la marca al subir la pista (`music.license.confirmed`).

## Montajes de muestra

`rrss-recursos-comparativa/reels-calidad/` (con su hoja de fotogramas cada uno y
`comparativa.html`): las dos composiciones de las pruebas (`ct-manual-*`, `ct-ia-*`) y tres
plantillas del catálogo (`cat-asi-se-hace-*`, `cat-oferta-semana-*`, `cat-paseo-*`), antes (código de
`claude/focused-noether-hk502p`) y después (esta rama), con fotos reales de Casa Tomás.
El «después» lleva el cierre con el campo `outro`, como saldrá cuando el editor lo guarde.

## Probado

- Trabajador (`worker/tests/reel-quality.test.ts`): medidas de la tipografía, cortes equilibrados,
  mínimos por papel, zonas seguras con cualquier posición y desplazamiento, apilar y encadenar,
  el caso de las pruebas sin solapes, encuadre sobre la máscara, sujeto ancho, saliencia,
  orientación EXIF, argumentos de codificación, sin pista de audio, cierre, esquema; y con
  **FFmpeg real**: plato descentrado dentro del cuadro, sin pista de audio, High,
  `moov` antes de `mdat`, cierre y aviso de textos separados.
- Base de datos (`tests/db/editor-reels.test.ts`): campos nuevos admitidos, rechazos (papel,
  gradación, cierre, colores, logotipo y máscara de otra marca, máscara en un vídeo) y nulos.
- Aplicación (`src/features/reels/quality.test.ts` y los de plantillas y «como este»): material sin
  repetir y por calidad, puntos y máscaras guardados, estilos por papel, textos que no se pisan,
  cierre desde el perfil y aviso «Sin música».

## Sin probar

- La imagen del trabajador en Fly (Debian trixie, FFmpeg 7.1): `y_align` y `boxw` existen desde
  FFmpeg 6.1, pero todo se probó con FFmpeg 9 local. Tiempo de montaje con `preset medium` en la
  máquina de Fly (en local, ~2,5× lo de antes).
- Publicar en Instagram un reel **sin pista de audio** (la API de Meta no lo exige según lo que
  se sabe, pero no se ha probado contra Meta real).
- La saliencia con fotos muy cargadas (sala llena, fondo con mucho detalle): acierta con platos
  sobre mantel o encimera, puede dudar en planos generales.
- Las pantallas (editor, selectores) no usan aún lo nuevo; ver «Lo que falta en las pantallas».

## Para llevarlo a staging

1. Migración `20270113010000_reels_calidad.sql` (antes del trabajador: el trabajador nuevo acepta
   los planos de antes, pero la base de datos vieja rechazaría los campos nuevos).
2. Redesplegar el trabajador (`worker-fly.yml`): imagen nueva con `worker/fonts/` y
   `WORKER_FONT_FILE=/app/fonts/Montserrat-ExtraBold.ttf`.
3. La aplicación (Vercel): plantillas y «Hacer un reel como este» con el material y los estilos nuevos.
4. Volver a cargar el catálogo de plantillas en las marcas (`agency/`, en seco primero) para que
   las plantillas guardadas tengan los estilos nuevos.
