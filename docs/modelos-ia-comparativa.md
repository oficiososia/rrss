# Comparativa de modelos de IA (22/11/2026)

Estudio del 22/11/2026 para decidir qué claves poner. **Solo documentación:** no
se ha tocado código ni configuración, no se ha llamado a ninguna API de pago y
no se ha leído ninguna clave. Los precios y las clasificaciones se han
consultado hoy en las páginas que se citan (§13); lo que no se ha visto en una
fuente oficial va marcado **NO CONFIRMADO** y los cálculos propios, como
*estimación*. Ningún adaptador de rrss está probado todavía contra su servicio
real, así que la calidad es la de las clasificaciones públicas, no una medida
nuestra (salvo el copiloto con Claude, `docs/copiloto-voz.md` §8).

No repite lo ya estudiado: `docs/ia-medios.md` (adaptadores de imagen y vídeo,
§13 OpenAI, §14 Workers AI), `docs/servidor-gpu.md` (GPU propia frente a API),
`docs/copiloto-voz.md` §9 (modelo del copiloto), `docs/ia-texto.md`,
`docs/edicion-fotos.md` y `docs/editor-reels.md`.

**Prioridad del dueño.** Más que generar imágenes desde cero, la IA debe ayudar
a **montar** las piezas y a **animarlas** a partir de fotos reales del negocio.
Por eso el orden es: (a) animar una foto real conservando el plato, (b) animar
carteles y textos, (c) montar y maquetar, (d) editar fotos sin tocar el plato.
Generar imágenes queda como capacidad secundaria (§8).

**Moneda.** USD sin impuestos. Recargo por procesar en la UE: +10 % en OpenAI
(modelos desde el 05/03/2026), Mistral (punto regional) y Claude por Vertex o
Bedrock (punto regional o multirregión).

**Adaptadores que ya existen en rrss** (ninguno probado con el servicio real):
imagen `openai`, `bfl`, `ideogram`, `google-vertex`, `comfyui`; vídeo
`higgsfield` y `fal`; texto `openai`, `anthropic`, `anthropic-vertex`,
`anthropic-bedrock`, `mistral`; transcripción `openai`. En las tablas,
«Integración»: **Hay** = adaptador escrito; **Ajuste** = el adaptador existe
pero hay que añadir el modelo o una operación; **Nuevo** = adaptador nuevo.

---

## 1. Resumen y recomendación

| Capacidad | Principal | Respaldo | Coste orientativo |
|---|---|---|---|
| (a) Animar una foto real | **Movimiento sin IA** en el trabajador (zoom, paneo y parallax con FFmpeg): plato intacto, 0 $. Con IA, solo para vapor, líquidos o cámara real: **MiniMax H3** por fal.ai (`minimax/h3/image-to-video`, 768p) | **Kling v3 Standard** por fal.ai (misma clave). A probar en cuanto haya adaptador: **Gemini Omni 1.2 Flash** (n.º 1 en arena.ai y de los más baratos) | Clip de 5 s: 0,30 $ (H3), 0,42 $ (Kling v3), 0,35 $ (Omni). Reel de 15 s: 0,90 / 1,26 / 1,05 $ |
| (b) Animar carteles y textos | **Sin IA generativa**: animaciones prediseñadas que el modelo de texto elige y el trabajador dibuja (FFmpeg hoy; Remotion o Lottie si se quiere más). El texto no se deforma | Vídeo generativo solo para el fondo del cartel, con el texto superpuesto después | 0 $ por clip (CPU del trabajador) |
| (c) Montar y maquetar | **Claude Haiku 5.5** por Vertex en la UE con herramientas sobre el editor (el copiloto de hoy, calidad medida 12/12) | **Claude Sonnet 5.5** (mismo adaptador) para montajes desde cero; con la clave de OpenAI, `gpt-6.1-terra` | ≈ 0,0004 $ por orden; ≈ 0,0009-0,018 $ por montaje con foto |
| (d) Editar fotos reales | **Recorte en el navegador + volver a pegar el plato** (ya hecho) y el fondo con OpenAI `gpt-image-2.5-sunburst`. Mejorar: sin IA (ya hecho) | **MAI-Image-2.7** (n.º 1 en edición según Artificial Analysis, ≈ 0,04 $) o **Nano Banana 2.1**. Ampliar: SeedVR2 o Topaz por fal.ai | ≈ 0,10 $ por cambio de fondo (OpenAI); 0,03-0,05 $ con los respaldos |
| Pies de foto en español | **Claude Sonnet 5.5** (Vertex UE) | `gpt-6.1-terra` (OpenAI UE) | 0,0077 $ / 0,0039 $ por pie |
| Subtítulos de reels | **OpenAI `gpt-transcribe`** (ya integrado, admite UE) | **Voxtral Mini Transcribe 3** (Mistral, punto UE) o **Scribe v3** (ElevenLabs) | 0,0045 $/min (0,0035 / 0,0033) |
| Generar imágenes (secundaria) | OpenAI `gpt-image-2.5-flare` (calidad media) | Nano Banana 2.1 por Vertex (UE por confirmar) | ≈ 0,05 $ / 0,034 $ por imagen |

**Claves, en este orden:**

1. **OpenAI** (la que el dueño ya iba a poner). Cubre desde el primer día:
   cambiar el fondo y mejorar con IA, generar imágenes, subtítulos y, mientras
   no haya Vertex, texto (`gpt-6-luna` o `gpt-6.1-terra` para el copiloto y
   `gpt-6.1-terra` para los pies). Antes de pagar: pedir a ventas la
   **residencia en Europa** y, aparte, la **aprobación de imagen en Europa**
   (la guía de residencia dice que las imágenes en la UE «requieren aprobación
   adicional»), y comprobar si la organización necesita verificarse para GPT
   Image. OpenAI no tiene vídeo en su página de precios: no anima fotos.
2. **Google Cloud (Vertex AI)**. Claude Haiku 5.5 y Sonnet 5.5 en la UE con el
   adaptador que ya existe: es lo único con calidad medida para montar. De paso
   deja Nano Banana 2.1 como respaldo de imagen.
3. **fal.ai**. Una sola clave para animar fotos (MiniMax H3, Kling v3, Wan 3.0,
   Veo 3.1…), ampliar (SeedVR2, Topaz) y probar alternativas de edición
   (MAI-Image-2.7, Seedream 5.5). El adaptador de vídeo ya existe. **No ofrece
   UE**: solo con `AI_MEDIA_ALLOW_NON_EU` y sin datos personales en las fotos.
4. **Opcional: Mistral.** El adaptador de texto ya existe y la misma clave da
   Voxtral para subtítulos con punto europeo (`api.eu.mistral.ai`).

**Lo que conviene hacer antes de gastar en vídeo generativo:** terminar el
movimiento sin IA (zoom y paneo ya existen en los reels; faltan el parallax y
las animaciones de texto, apuntadas como pendientes en `docs/editor-reels.md`).
Es lo único que garantiza el plato y el texto intactos, y sale gratis.

**Coste mensual con la opción recomendada** (§11): unos **72 $** para 5-10
marcas, **217 $** con el triple de uso y **723 $** con diez veces más. La más
barata razonable: 26 / 78 / 261 $. Con solo la clave de OpenAI y sin vídeo
generativo: 50 / 151 / 504 $.

---

## 2. Supuestos de los cálculos

| Concepto | Volumen base (5-10 marcas) | Supuesto |
|---|---|---|
| Imágenes creadas | 300 | ~1 MP |
| Ediciones de foto | 250 | Todas «cambiar el fondo» a ~1-1,5 MP (lo más caro). Quitar el fondo y mejorar ya se hacen sin IA en el navegador, así que el coste real será menor |
| Órdenes del copiloto | 3.000 | 2.300 tokens de entrada y 200 de salida (`docs/copiloto-voz.md` §9): 6,9 M y 0,6 M |
| Pies de foto | 1.000 | 1.500 de entrada y 400 de salida (`docs/servidor-gpu.md` §2.1): 1,5 M y 0,4 M |
| Audio para subtítulos | 100 min | — |
| **Clips animados con IA** | **60 de 5 s (300 s)** | **Supuesto propio**: el encargo no daba volumen de vídeo. Equivale a un par de clips por marca y semana |

Escenarios: base, ×3 y ×10. Sin caché, sin lotes y sin contar los tokens de
razonamiento (que se facturan como salida). Un «reel de 15 s» se calcula de dos
formas: 15 s generados enteros, o **1 clip de 5 s con IA + 10 s sin IA**, que es
lo recomendado y cuesta lo que el clip.

---

## 3. (a) Animar una foto real del plato (imagen → vídeo)

Lo que se pide: movimiento de cámara, vapor o parallax **sin que el plato
cambie**. Hay dos caminos y conviene tener los dos.

### 3.1 Sin IA generativa (recomendado como base)

| Técnica | Qué hace | Fidelidad al plato | Coste | Integración |
|---|---|---|---|---|
| Zoom y paneo («Ken Burns») | Acercar, alejar o desplazar la foto | Total: son los píxeles de la foto | 0 $ (CPU del trabajador) | **Hay**: las fotos de los reels ya llevan movimiento (`docs/editor-reels.md`) |
| Parallax 2,5D | Un mapa de profundidad separa plato y fondo y los mueve a distinta velocidad | Total en el plato; puede verse un borde estirado si el movimiento es grande | 0 $ | **Nuevo** en el trabajador. Modelo de profundidad abierto (Depth Anything V2 Small, Apache-2.0 según su repositorio; **licencia no revisada hoy**: las variantes grandes son no comerciales) |
| Plato fijo + fondo animado | El recorte del plato (ya existe: BEN2/IS-Net) se queda quieto y solo se anima el fondo o un vapor superpuesto | Total | 0 $ si el vapor es un vídeo de biblioteca | **Nuevo**: composición con FFmpeg |

### 3.2 Con IA generativa (para vapor, líquidos y cámara real)

Clasificaciones: arena.ai Image-to-Video (actualizada el 08/11/2026) y
Artificial Analysis AA-Video-I2V v2.1 (consultada hoy, sin fecha en la página).
Precio por segundo; **clip de 5 s** y **reel de 15 s** generado entero.

| Modelo (id) | Vía y precio visto hoy | 5 s | 15 s | Clasificación | Duración y control | Datos / UE | Integración |
|---|---|---|---|---|---|---|---|
| **MiniMax H3** (`minimax/h3/image-to-video`) | fal.ai: 0,05 $/s (480p), **0,06 $/s (768p)**, 0,13 (2K), 0,16 (4K) | **0,30 $** | **0,90 $** | arena n.º 3 (1.493); AA n.º 5 (1.136) | 5-15 s. La foto es el primer fotograma y se puede fijar el último. Proporción la de la foto. Cámara solo por texto | Proveedor chino vía fal.ai (EE. UU.): **sin UE** | **Ajuste** (adaptador `fal`: cambia el modelo y sus campos) |
| **Kling v3 Standard** (`fal-ai/kling-video/v3/standard/image-to-video`) | fal.ai: **0,084 $/s** sin audio; 0,126 con audio | **0,42 $** | **1,26 $** | Fuera de los 15-20 primeros hoy. Una guía de Krea lo da como el más seguro para la forma y las etiquetas del producto (fuente secundaria) | 3-15 s. Último fotograma opcional | Kuaishou vía fal.ai: **sin UE** | **Ajuste** (`fal`). También **Hay** por `higgsfield` (0,112 $/s sembrado, **NO CONFIRMADO**: 0,56 / 1,68 $) |
| **Gemini Omni 1.2 Flash** (`gemini-omni-1.2-flash`) | Google (API de Gemini): ≈ **0,07 $/s** a 720p; 0,023 (360p); 0,104 (1080p); 0,209 (4K). Por la API de Runway: 0,10 $/s | **0,35 $** | **1,05 $** | **arena n.º 1 (1.503)**; AA n.º 15 (1.086) | Entrada de texto, imagen y vídeo. Límites de duración no vistos hoy | Google. En Vertex y en la UE: **NO CONFIRMADO** | **Nuevo** |
| **Seedance 2.5** (ByteDance) | API de Runway: 0,20 $/s (480p), **0,30 (720p)**, 0,68 (1080p); mínimo 0,80 $. Precio oficial de BytePlus: **NO CONFIRMADO** | 1,50 $ | 4,50 $ | **AA n.º 1 (1.162)**; arena n.º 2 (1.494). Una prueba de getimg.ai con un producto le da la mejor nota de estabilidad (una imagen, un intento) | Referencias gratis | ByteDance: **sin UE** | **Nuevo** (Runway) |
| **Wan 3.0** (`alibaba/wan-3.0/image-to-video`) | fal.ai: 0,05 $/s (480p), **0,10 (720p)**, 0,20 (1080p) | 0,50 $ | 1,50 $ | arena n.º 5 (1.482); AA n.º 12 (1.110) | 2-30 s, 9:16, primer y último fotograma, audio | Alibaba vía fal.ai: **sin UE** | **Ajuste** (`fal`) |
| Runway Gen-4 Turbo / Gen-4.5 | Runway: 0,05 / 0,12 $/s | 0,25 / 0,60 $ | 0,75 / 1,80 $ | Fuera de las listas de hoy | — | EE. UU. | **Nuevo** |
| FLUX 3 Video (BFL) | BFL: 0,15 $/s (HD), 0,24 (FHD); borrador 0,06 $/s. En fal.ai (`blackforestlabs/flux-3-max/image-to-video`): 0,085 $/s | 0,75 $ (borrador 0,30) | 2,25 $ (0,90) | arena n.º 11 (1.451); AA n.º 16 (1.072) | Hasta 20 s; audio incluido | Empresa alemana; punto UE de vídeo **NO CONFIRMADO** | **Nuevo** (el adaptador `bfl` es de imagen) o **Ajuste** por `fal` |
| Veo 3.1 Fast | fal.ai: 0,15 $/s. Precio oficial de Google no visto hoy | 0,75 $ | 2,25 $ | arena n.º 15 (Veo 3.1 con audio) | — | Google vía fal.ai | **Ajuste** (`fal`) |
| Grok Imagine Video 1.5 / Lite | Runway: 0,16 / 0,03 $/s a 720p. fal.ai anuncia 0,01 $/s (**contradictorio: NO CONFIRMADO**) | 0,80 / 0,15 $ | 2,40 / 0,45 $ | arena n.º 10 (1.453) | — | EE. UU. | **Nuevo** o **Ajuste** (`fal`) |

**Reel de 15 s recomendado = 1 clip de 5 s con IA + 10 s sin IA** (otras fotos
con zoom o parallax, textos animados y subtítulos): cuesta lo que el clip,
**0,30-0,42 $**, frente a 0,90-1,26 $ si se generan los 15 s.

**Fidelidad: lo que dicen las fuentes y lo que no.**

- Todos toman la foto como primer fotograma, pero **ninguno garantiza el plato
  después**: los bordes se ablandan y los logotipos o textos cambian al moverse
  la cámara (comparativa de WaveSpeed y reseña de Kittl, fuentes secundarias).
  No se ha encontrado ninguna prueba pública con comida.
- Cómo reducirlo: clips cortos (3-5 s), movimiento suave descrito con
  precisión («cámara lenta hacia delante, vapor ligero, el plato no cambia»),
  fijar como último fotograma la misma foto donde el modelo lo admite (H3,
  Kling v3, Wan 3.0) y **animar antes de poner textos** (los textos los dibuja
  después el trabajador).
- *Idea sin probar:* pedir cámara fija y volver a pegar el plato original en
  cada fotograma con la máscara del recorte, igual que «Proteger el plato» en
  las fotos. Daría vapor y fondo vivos con el plato exacto.
- **Recomendación:** antes de elegir, una prueba a ciegas con 5 fotos reales en
  H3, Kling v3 y Wan 3.0 (misma clave de fal.ai; unos 6 $ en total) y, si hay
  adaptador, Omni 1.2 Flash. Mirar los fotogramas del final, no el primero.

**Licencia y uso comercial.** fal.ai marca cada modelo con «Commercial use» o
«Research only»; las fichas leídas hoy no lo decían: **comprobarlo en la ficha
antes de activar**. Runway, Google y BFL: condiciones no revisadas hoy.

---

## 4. (b) Animar carteles y textos

Un vídeo generativo sobre un cartel ya diseñado **deforma el texto** (letras
pequeñas y textos en los bordes se emborronan al moverse la cámara, según la
reseña citada). Para un negocio que anuncia precios y horarios no sirve. Lo que
funciona es que la IA **decida** la animación y un motor determinista la
**dibuje**.

| Opción | Cómo | Coste por clip de 5 s / reel de 15 s | Licencia | Integración en rrss |
|---|---|---|---|---|
| **FFmpeg en el trabajador** | Entradas y salidas de texto (`drawtext` con expresiones), zoom, transiciones `xfade` | 0 $ / 0 $ | LGPL o GPL según la compilación | **Ajuste**: el trabajador ya monta reels con FFmpeg; «textos con animaciones prediseñadas» está apuntado como pendiente en `docs/editor-reels.md` |
| Fotogramas del propio editor | Dibujar el diseño (Konva) fotograma a fotograma en el servidor y pasarlo a FFmpeg: lo animado se ve igual que en el editor | 0 $ / 0 $ | Konva MIT (**no revisada hoy**) | **Nuevo** (esfuerzo medio-alto) |
| Remotion | Plantillas animadas en React, renderizadas a vídeo | 0 $ de uso; licencia de empresa | De pago para empresas a partir de cierto tamaño; **precio NO CONFIRMADO** (la página no cargó) | **Nuevo**: necesita Chromium en el trabajador |
| Lottie / Rive | Animaciones hechas por un diseñador con huecos para texto y foto | 0 $ | lottie-web MIT (**no revisada hoy**) | **Nuevo**: hace falta quien diseñe las plantillas y un render a vídeo |
| API de plantillas (Shotstack) | Se envía un JSON con capas y animaciones y devuelve el vídeo | 0,20 $/min de pago por uso (0,05-0,16 con plan): ≈ 0,017 $ / 0,05 $ | Servicio | **Nuevo**. Duplica lo que ya hace el trabajador. Creatomate: **NO CONFIRMADO** (la página no cargó) |
| Vídeo generativo solo en el fondo | Animar la foto o el fondo (§3) y superponer el texto después | Lo del clip (0,30-0,42 $) | — | Lo de §3 más el montaje que ya existe |
| IA que elige la animación | El modelo de texto devuelve la animación de cada capa de una lista cerrada (entrada, salida, ritmo) | ≈ 0,0004 $ por orden (§5) | — | **Ajuste**: operaciones nuevas del copiloto |

**Recomendación:** FFmpeg con una lista corta de animaciones prediseñadas
(aparecer, deslizar, máquina de escribir, latido del precio) y el copiloto
eligiéndolas. Remotion o Lottie solo si más adelante se quiere un acabado de
agencia y hay quien diseñe las plantillas.

---

## 5. (c) Montar y maquetar: modelo de texto con herramientas sobre el editor

Aquí la IA **no pinta píxeles**: elige plantilla, coloca la foto y el texto y
decide colores y animaciones con operaciones de una lista cerrada que el editor
valida. Es lo que ya hacen `editor.copilot` y `campaign.plan`
(`docs/ia-texto.md` §4). Hace falta un modelo que siga un esquema estricto, no
invente texto y conteste rápido. Los modelos de imagen que «diseñan» (Canva
Craft, Recraft, Ideogram) devuelven una imagen plana y no editable: no sirven
para esto.

Coste por orden del copiloto (2.300 + 200 tokens), por **montaje con foto**
(*estimación*: 5.000 de entrada con dos fotos y el catálogo de plantillas, 600
de salida) y por pie de foto (1.500 + 400). Calidad: Intelligence Index de
Artificial Analysis (variante indicada) y Text Arena de arena.ai (20/11/2026).
Velocidad: Artificial Analysis, con su carga de prueba, no la nuestra.

| Modelo (id) | Precio entrada / salida por millón | Orden | Montaje | Pie | Calidad | Velocidad (AA) | UE | Integración |
|---|---|---|---|---|---|---|---|---|
| **Claude Haiku 5.5** (`claude-haiku-5-5`) | 0,10 / 0,50 (hasta 100.000 tokens de prompt). Vertex o Bedrock UE: 0,11 / 0,55 | 0,00036 $ | 0,0009 $ | 0,0004 $ | **Medida en rrss: 12/12**. AA: 19 (esfuerzo bajo) a 36 (máximo) | 216 tokens/s; 5,7 s hasta la primera palabra **con razonamiento** en esfuerzo bajo | Vertex `eu` o Bedrock `eu-`. La API directa solo ofrece `us` o `global` | **Hay** |
| **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | 2 / 10. UE: 2,20 / 11 | 0,0073 $ | 0,018 $ | 0,0077 $ | **Medida: 12/12**. AA: 55 (máximo) | No consultada hoy | Igual | **Hay** |
| `gpt-6-luna` (OpenAI) | 0,10 / 0,50. UE: 0,11 / 0,55 | 0,00036 $ | 0,0009 $ | 0,0004 $ | AA: 9 (sin razonar) a 28 (máximo). Sin medir en rrss | 90 tokens/s; 1,5 s sin razonar; 2,5 s en bajo | `eu.api.openai.com` con residencia | **Hay** |
| `gpt-6.1-terra` (OpenAI) | 1 / 5. UE: 1,10 / 5,50 | 0,0036 $ | 0,0088 $ | 0,0039 $ | AA: 31 (sin razonar) a 51 (máximo). Sin medir en rrss | 62 tokens/s; 2,2 s sin razonar | Igual | **Hay** |
| `gpt-6.2-sol` (OpenAI) | 2 / 10. UE: 2,20 / 11 | 0,0073 $ | 0,018 $ | 0,0077 $ | AA: 57 (máximo) | 84 s en máximo (no vale para el copiloto así) | Igual | **Hay** |
| Gemini 3.8 Flash (`gemini-3.8-flash`) | 0,75 / 3,75 hasta el 31/12/2026; **1,50 / 7,50 desde el 01/01/2027** | 0,0025 $ (0,005) | 0,006 $ (0,012) | 0,0026 $ (0,0053) | Text Arena n.º 12 (1.497) | No consultada | Vertex, +10 % fuera de `global` | **Nuevo** (no hay adaptador de Gemini para texto) |
| Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) | 0,30 / 2,50 | 0,0012 $ | 0,003 $ | 0,0015 $ | AA: 12 | 311 tokens/s; 4,7 s | Igual | **Nuevo** |
| Mistral Small 4 | 0,15 / 0,60. Punto UE: ×1,1 | 0,0005 $ | 0,0011 $ | 0,0005 $ | AA: 4 (razonando) | 123 tokens/s; 1,6 s sin razonar | `api.eu.mistral.ai` (solo llamadas a funciones como herramienta regional) | **Hay** |
| Mistral Large 4 | 0,70 / 2,10 | 0,0020 $ | 0,0048 $ | 0,0019 $ | AA: 26 | 65 s en alto | Igual | **Hay** |
| `openai/gpt-oss-120b` en Groq | 0,15 / 0,60 | 0,0005 $ | 0,0011 $ | 0,0005 $ | AA: 4 | **500 tokens/s** (dato de Groq) | No consta | **Ajuste** (compatible con el adaptador `openai` cambiando la URL; sin probar) |

**Lecturas:**

- **El objetivo de 1-2 s no está asegurado con ninguno.** Con 200 tokens de
  salida, solo generar ya son 0,9 s en Haiku 5.5, 1,6 s en Mistral Small 4,
  2,2 s en `gpt-6-luna` y 3,2 s en `gpt-6.1-terra`, más la espera hasta la
  primera palabra. Los modelos actuales razonan por defecto: el adaptador de
  Claude de rrss no envía `thinking` (cada modelo usa su valor) y sí admite
  `effort`. Para el copiloto conviene `effort: low` y probar con el
  razonamiento apagado (Haiku 5.5 lo admite hasta esfuerzo alto, según la
  referencia de la API de Claude). **Es un cambio de código que no se ha hecho;
  hay que medirlo en la primera llamada real.**
- **El copiloto hoy no ve la foto**: recibe el identificador de las fotos
  elegidas y el resumen de las capas. Para que maquete sin tapar el plato hay
  dos caminos: enviarle la imagen (Claude, GPT-6 y Gemini aceptan imágenes;
  Mistral Small 4 y `gpt-oss`, sin comprobar hoy) o, más barato,
  **pasarle como dato la caja del plato** que el recorte del navegador ya
  calcula. Lo segundo no necesita visión ni sube el coste.
- **Pies de foto en español:** no se ha encontrado ninguna clasificación pública
  específica de español (Text Arena no enseña hoy categoría por idioma).
  Sonnet 5.5 y `gpt-6.1-terra` son los candidatos; decidir con una prueba a
  ciegas de 20 pies reales (coste: céntimos).
- **Precios que cambian pronto:** Gemini 3.8 Flash se duplica el 01/01/2027.

**Recomendación:** Haiku 5.5 por Vertex UE para órdenes y animaciones;
Sonnet 5.5 para montar una pieza desde cero y para los pies. Mientras solo haya
clave de OpenAI: `gpt-6.1-terra` (calidad) o `gpt-6-luna` (precio y rapidez),
pasando antes los 12 casos de `docs/copiloto-voz.md` §8.

---

## 6. (d) Editar fotos reales sin tocar el plato

**La fidelidad no la da el modelo, la da el montaje.** Ningún modelo generativo
garantiza hoy que el plato quede idéntico: OpenAI dice que la máscara «guía»
pero puede no respetar su forma; BFL, que los píxeles fuera de la zona
«normalmente» se quedan igual; MAI-Image-2.7 ni siquiera tiene parámetro de
máscara en fal.ai. Lo único seguro es lo que rrss ya hace: recortar el plato en
el navegador, dejar que la IA pinte el fondo y **volver a pegar el plato
original** (`docs/edicion-fotos.md` §8). Con eso, el modelo solo decide cómo
queda el fondo, y se puede elegir por precio.

Clasificaciones: Artificial Analysis AA-Image-Editing v2.1 (hoy) y arena.ai
Image Edit (16/11/2026). «Por edición» es *estimación* a ~1-1,5 MP.

| Opción (id) | Precio visto hoy | Por edición | Clasificación | Fidelidad al plato | UE / datos | Integración |
|---|---|---|---|---|---|---|
| **Recorte en el navegador + pegar el plato** (BEN2 / IS-Net) | 0 $ | 0 $ | — | **Total** | La foto no sale del dispositivo | **Hay** |
| **Mejora automática sin IA** (luz, color, nitidez) | 0 $ | 0 $ | — | **Total** (no inventa nada) | Igual | **Hay** |
| **OpenAI `gpt-image-2.5-sunburst`** (`/v1/images/edits`) | Por tokens: imagen 8 $ entrada y 30 $ salida por millón; texto 5 $ | ≈ 0,10 $ (cota de rrss: 0,26 $). **Tarifa por imagen de 2.5 NO CONFIRMADA**: la guía remite a una calculadora | **arena n.º 1 (1.519)**; AA n.º 4 (1.201, calidad máxima) | Máscara orientativa; con el plato pegado, total | UE con residencia **y aprobación de imagen** (ventas). Admite retención cero. No entrena con datos de la API por defecto | **Hay** |
| OpenAI `gpt-image-2.6-sunburst` | Mismas tarifas | ≈ 0,10 $ | AA n.º 2 (1.211); arena n.º 3 (1.481, calidad media) | Añade edición guiada por marcas sobre la imagen | **No figura en la lista de residencia UE** de hoy | **Ajuste** (nombre del modelo) |
| **MAI-Image-2.7** (Microsoft, en vista previa) | Por tokens: texto 5 $, imagen 8 $ entrada y 34 $ salida (fal.ai y Vercel AI Gateway). **Precio oficial de Azure NO CONFIRMADO** (la página sale sin cifras) | ≈ 0,043 $ (ejemplo de fal.ai) | **AA n.º 1 (1.215)**; arena n.º 4 (1.475) | Sin máscara; hasta 5 imágenes; hasta 2048 × 2048 | Regiones y zona de datos UE de Azure: **NO CONFIRMADO** | **Nuevo** (Azure Foundry, fal.ai o Vercel) |
| MAI-Image-2.7-Flash | 1,75 $ entrada y 10 $ salida por millón (Vercel) | ≈ 0,010 $ (precio de AA) | AA n.º 7 (1.179) | Igual | Igual | **Nuevo** |
| **Nano Banana 2.1** (`gemini-nano-banana-2.1`) | 0,0336 $ (1K), 0,0504 $ (2K), 0,113 $ (4K); entrada 1,50 $ por millón | ≈ 0,036 $ | AA n.º 10 (1.152); arena n.º 9 (1.427) | Sin máscara, por instrucción | Vertex en la UE: **NO CONFIRMADO** (la versión anterior sí tenía multirregión `eu`) | **Ajuste** (`google-vertex` genera; falta editar) |
| Seedream 5.5 (ByteDance) | ≈ 0,020 $ por salida + 0,008 $ por imagen de entrada (agregadores; **BytePlus oficial NO CONFIRMADO**) | ≈ 0,028 $ | AA n.º 8 (1.159) | Por instrucción | Sin UE | **Nuevo** |
| FLUX 3 Image (`flux-3-image`, BFL) | 0,048 $ (1K), 0,07 $ (1,5K), 0,10 $ (2K); referencias gratis | 0,048-0,07 $ | AA n.º 22 (1.120) | Sin máscara: instrucción y cajas; tiene vista de «píxeles cambiados» | Punto UE: **NO CONFIRMADO hoy** (el adaptador usa `api.eu.bfl.ai`, documentación del 17/11) | **Ajuste** (`bfl`: endpoint nuevo) |
| FLUX.1 Fill [pro] (BFL) | 0,05 $ por imagen | 0,05 $ | — | **Con máscara** (relleno) | Igual | **Ajuste** (`bfl`) |
| Ideogram (cambiar fondo) | «Al precio de generar»: 4.0 Turbo 0,03 $; Precise Edit 4.5: 0,008-0,22 $ | 0,03-0,06 $ | Fuera de las listas de hoy | — | No documentada | **Ajuste** (`ideogram`) |
| Recraft | Cambiar fondo 0,04 $; quitar fondo 0,01 $ | 0,04 $ | — | — | No consta | **Nuevo** |
| Photoroom (Image Editing API) | 0,10 $ por imagen; quitar fondo 0,02 $ | 0,10 $ | — | Pensado para producto; que conserve los píxeles: **NO CONFIRMADO** | RGPD solo citado en el plan Enterprise | **Nuevo** |
| Bria (Fibo 2 Edit por fal.ai) | 0,04 $; quitar fondo RMBG 2.0: 0,018 $ | 0,04 $ | — | — | Entrenado con datos licenciados e indemnidad comercial (su documentación) | **Nuevo** |

**Ampliar** (lo fiel es lo no generativo):

| Opción | Precio | Fidelidad | Integración |
|---|---|---|---|
| SeedVR2 por fal.ai (`fal-ai/seedvr/upscale/image`) | 0,001 $ por megapíxel | Restaurador; revisar que no invente textura | **Nuevo** (imagen por fal.ai) |
| Topaz por fal.ai (`fal-ai/topaz/upscale/image`) | 0,08 $ hasta 24 MP; 0,16 $ hasta 48 MP | Familia «Precision»: fiel. Familia «Generative»: inventa detalle, no usar | **Nuevo** |
| Recraft Crisp Upscale | 0,004 $ | Fiel | **Nuevo** |
| Real-ESRGAN en ComfyUI propio | Coste de la GPU (`docs/servidor-gpu.md`) | Fiel | **Hay** (flujo escrito) |
| Ideogram Upscale / Recraft Creative Upscale | 0,06 $ / 0,25 $ | Generativos | — |

**Recomendación:** seguir con OpenAI `gpt-image-2.5-sunburst` y el plato
pegado. En cuanto haya clave de fal.ai, comparar a ciegas con MAI-Image-2.7 y
Seedream 5.5 en 10 fotos: si el fondo queda igual de bien, la edición baja de
0,10 $ a 0,03-0,04 $. «Mejorar» se queda sin IA. «Ampliar»: SeedVR2 o Topaz
Precision.

---

## 7. Transcripción para subtítulos en español

Todos cuestan céntimos: se decide por calidad en español, marcas de tiempo y
UE. La tasa de error (AA-WER) de Artificial Analysis **es solo de inglés**. En
español solo se ha encontrado una tabla de un proveedor (AssemblyAI, a
verificar): Scribe v2 ≈ 8,9 % de error en español con acento, Universal-3.5 Pro
≈ 9,4 % y Voxtral Mini Transcribe 2 ≈ 11,8 %.

| Modelo | Precio por minuto | 100 min | AA-WER (inglés) y velocidad | UE / datos | Integración |
|---|---|---|---|---|---|
| **OpenAI `gpt-transcribe`** | 0,0045 $ (estimado por OpenAI) | 0,45 $ | 3,3 % (n.º 24); ×63 | En la lista de residencia UE | **Hay**. Sin marcas de tiempo: rrss trocea el audio por pausas |
| **ElevenLabs Scribe v3** | 0,20 $/h = 0,0033 $ | 0,33 $ | **1,9 % (n.º 2)**; ×60 | La página de precios no habla de UE: **NO CONFIRMADO** | **Nuevo** |
| **Mistral Voxtral Mini Transcribe 3** | 0,0035 $ (punto UE: ×1,1) | 0,35 $ | 2,2 % (n.º 7); ×66 | `api.eu.mistral.ai` | **Nuevo** (transcripción); la clave es la del adaptador `mistral` |
| Mistral Voxtral Small Transcribe 3 | 0,004 $ | 0,40 $ | 2,1 % (n.º 5) | Igual | **Nuevo** |
| Microsoft MAI-Transcribe-2 | ≈ 0,0017 $ (precio de AA; **Azure oficial NO CONFIRMADO**) | 0,17 $ | 2,0 % (n.º 4); **×340** | Azure; UE **NO CONFIRMADO** | **Nuevo** |
| AssemblyAI-STT-3.7 (`assemblyai-stt-3-7`) | 0,21 $/h = 0,0035 $ | 0,35 $ | 2,5 % (n.º 11) | `api.eu.assemblyai.com`, mismo precio. Español en este modelo: **NO CONFIRMADO** (32 idiomas) | **Nuevo** |
| Google Gemini 3.5 Transcribe (`gemini-3.5-transcribe`) | ≈ 0,005 $ | 0,50 $ | 2,6 % (n.º 13) | Vertex UE **NO CONFIRMADO** | **Nuevo** |
| Deepgram Nova-3 multilingüe | 0,0052 $ | 0,52 $ | Fuera de los 25 primeros | `api.eu.deepgram.com`; 200 $ de crédito inicial | **Nuevo** |
| Gladia Solaria-3 | 0,16 €/h = 0,0027 € | 0,27 € | 3,2 % (n.º 23) | Empresa francesa. En autoservicio entrena con los datos salvo que se desactive | **Nuevo** |
| Groq `whisper-large-v3-turbo` | 0,04 $/h = 0,0007 $ | 0,07 $ | — | No consta UE | **Ajuste** (API compatible con la de OpenAI; sin probar) |
| Cloudflare Workers AI `whisper-large-v3-turbo` | ≈ 0,0005 $ | 0,05 $ | — | Sin garantía de UE | **Nuevo** |

**Recomendación:** empezar con `gpt-transcribe` (ya está, misma clave, UE).
Si los subtítulos fallan en español real (ruido de cocina, acentos), probar
Voxtral Mini Transcribe 3 o Scribe v3 con 5 reels: una tarde de trabajo y
céntimos de coste. Marcas de tiempo por palabra de cada uno: **no comprobadas
hoy**.

---

## 8. Generar imágenes con texto legible (secundaria)

En rrss el texto de un cartel lo pone el editor (siempre legible y corregible),
así que la imagen generada sirve sobre todo de fondo o ilustración. Si se
quiere el texto dentro de la imagen, estos son los mejores hoy. Clasificaciones:
Artificial Analysis AA-Image-T2I v2.1 (hoy; precio por imagen de 1024 × 1024
según AA) y arena.ai Text-to-Image (21/11/2026).

| Modelo (id) | Precio | Por imagen | AA | arena.ai | UE | Integración |
|---|---|---|---|---|---|---|
| **OpenAI `gpt-image-2.5-flare`** / `-sunburst` | Por tokens (imagen 30 $ por millón de salida) | ≈ 0,05 $ en calidad media (*estimación* con la tarifa histórica de `gpt-image-2`; **NO CONFIRMADO para 2.5**); 0,21 $ en máxima (AA) | n.º 5 y n.º 2 (1.209 y 1.230, en máxima) | **n.º 3 y n.º 1** (1.400 y 1.429) | Con residencia y aprobación de imagen | **Hay** |
| OpenAI `gpt-image-2.6-sunburst` / `-flare` | Mismas tarifas | Igual | **n.º 1** y n.º 3 (1.263 y 1.226) | n.º 2 y n.º 6 (calidad media) | No figura en la lista UE de hoy | **Ajuste** |
| MAI-Image-2.7 / 2.7-Flash (Microsoft) | Texto 5 $ y salida 34 $ por millón / 1,75 $ y 10 $ | ≈ 0,035 $ / 0,010 $ (AA) | n.º 4 (1.215) / n.º 11 (1.159) | n.º 4 (1.385) | **NO CONFIRMADO** | **Nuevo** |
| Nano Banana 2.1 (`gemini-nano-banana-2.1`) | 0,0336 $ (1K), 0,0504 $ (2K) | 0,034 $ | n.º 8 (1.175) | n.º 9 (1.305) | Vertex UE **NO CONFIRMADO** | **Hay** (`google-vertex`, fila ya sembrada) |
| Seedream 5.5 (ByteDance) | ≈ 0,02 $ (**oficial NO CONFIRMADO**) | 0,02 $ | n.º 14 (1.135) | — | Sin UE | **Nuevo** |
| FLUX 3 Image / FLUX 3 Image Klein (BFL) | 0,048 $ / 0,009 $ a 1K | Igual | n.º 21 (1.114) / sin clasificar | — | Punto UE **NO CONFIRMADO hoy** | **Ajuste** (`bfl`) |
| Ideogram 4.0 (Turbo / Default / Quality) | 0,03 / 0,06 / 0,10 $ | Igual | Fuera de los 25 primeros | Fuera de los 15 primeros | No documentada | **Ajuste** (`ideogram` usa el endpoint v3) |
| Recraft V4 | 0,04 $ (vectorial 0,08 $) | Igual | Fuera de las listas | — | No consta | **Nuevo** |

- **Texto legible:** no se ha encontrado una clasificación pública vigente solo
  de tipografía (la categoría «Text & Typography» de Artificial Analysis no
  enseña ranking hoy). OpenAI reconoce que la colocación y la nitidez del texto
  «pueden seguir siendo difíciles» y que un encargo complejo tarda hasta 2
  minutos. Microsoft anuncia en MAI-Image-2.7 mejor texto en carteles y
  etiquetas (afirmación del fabricante).
- Ideogram y Recraft, que eran la referencia para carteles, **ya no aparecen
  arriba** en ninguna de las dos clasificaciones.
- **Recomendación:** `gpt-image-2.5-flare` en calidad media para el día a día
  y `-sunburst` para la pieza importante. Respaldo: Nano Banana 2.1.

---

## 9. Agregadores: varias alternativas con una sola clave

| Agregador | Qué cubre | Recargo | UE y datos | Integración |
|---|---|---|---|---|
| **fal.ai** | Vídeo (H3, Kling, Wan, Veo, Seedance, FLUX 3…), imagen y edición (MAI-Image-2.7, Nano Banana, Seedream, FLUX), ampliar (SeedVR2, Topaz), quitar fondo. Transcripción: no aparece en su página de precios | Precio por modelo; a veces por encima del oficial (Nano Banana 2.1: 1,764 $ y 35,29 $ por millón frente a 1,50 $ y 30 $ de Google) | Guarda las salidas al menos 7 días por defecto (se cambia por cabecera). Entrenamiento, regiones y RGPD: **no constan** en su FAQ. Los modelos de socios los aloja el socio | **Hay** para vídeo; imagen y ampliar, **Nuevo** |
| **Replicate** | Catálogo abierto: FLUX 1.1 pro 0,04 $, FLUX dev 0,025 $, FLUX schnell 0,003 $, Ideogram v3 Quality 0,09 $, Recraft v3 0,04 $; modelos propios por segundo de GPU (T4 0,000225 $/s) | Precio por modelo | Datos y regiones: no constan en la página | **Nuevo** |
| **OpenRouter** | Texto de casi todos los proveedores y una API de imágenes (`POST /api/v1/images`). Transcripción y vídeo: **NO CONFIRMADO** | Sin recargo sobre el modelo; 5,5 % al comprar crédito (mínimo 0,80 $). Con clave propia, gratis hasta 25.000 $ al mes | No guarda los prompts por defecto. `eu.openrouter.ai` descifra en la UE y enruta solo a proveedores en Europa (UE/EEE, Reino Unido y Suiza). Contrato de tratamiento con cláusulas tipo | Texto: **Ajuste** (compatible con el adaptador `openai`, sin probar). Imagen: **Nuevo** |
| **Vercel AI Gateway** | Texto, imagen (GPT Image 2 a 2.6, MAI-Image, Seedream, FLUX, Recraft), vídeo (Kling, Seedance, Veo, Wan, MiniMax H3, FLUX 3) y transcripción (`gpt-transcribe`, Voxtral, Scribe v2, MAI-Transcribe-2, Gemini 3.5 Transcribe) | **0 %**, también con clave propia | Retención cero por petición sin coste. Punto regional `eu.ai-gateway.vercel.sh` en beta: +5 % y solo planes Pro o Enterprise; fija dónde recibe la pasarela, no dónde infiere el proveedor | **Nuevo** (o **Ajuste** si su API compatible con OpenAI sirve: **NO CONFIRMADO**). rrss ya está en Vercel |
| **Cloudflare Workers AI** | Generar con FLUX.2 klein (≈ 0,015 $/MP), Whisper (≈ 0,0005 $/min), texto abierto. Sin edición fiel, sin ampliar y sin vídeo (`docs/ia-medios.md` §14, sigue igual hoy) | 0,011 $ por 1.000 neuronas; 10.000 gratis al día | Sin garantía de UE | **Nuevo** |

**Veredicto.** Ningún agregador mejora a la clave directa de OpenAI (mismo
precio o más, y un encargado del tratamiento más). Sí compensan como **segunda
clave**: fal.ai para vídeo y ampliación (el adaptador ya existe) y, si más
adelante se quiere respaldo de texto, imagen y transcripción de varios
proveedores sin abrir más cuentas, Vercel AI Gateway (0 % de recargo, mismo
proveedor donde ya vive rrss) u OpenRouter (punto europeo documentado).

---

## 10. UE, RGPD y licencias por proveedor

| Proveedor | Procesar en la UE | Datos y entrenamiento | Uso comercial de lo generado |
|---|---|---|---|
| OpenAI | Sí: proyecto con región Europa + `eu.api.openai.com`, pidiendo elegibilidad a ventas; **imagen con aprobación adicional**; +10 %. Cubre `gpt-image-2.5-*`, `gpt-transcribe`, `gpt-6-luna`, `gpt-6.1-terra` y GPT-6.2 | No entrena con datos de la API por defecto; registros antiabuso hasta 30 días; retención cero disponible en imágenes y transcripción. Contrato de tratamiento: **no visto hoy** | Condiciones **no revisadas hoy** |
| Anthropic (API directa) | **No**: inferencia solo `us` o `global` y almacenamiento solo `us` | — | — |
| Claude por Vertex o Bedrock | Sí (`eu` / `eu-…`), +10 %. Precio en la consola: **NO CONFIRMADO** | Los de Google Cloud o AWS | — |
| Google (Vertex / API de Gemini) | Vertex tiene multirregión `eu`; para Nano Banana 2.1, Omni 1.2 Flash y 3.5 Transcribe: **NO CONFIRMADO**. La página de precios de Vertex no cargó | — | — |
| Microsoft (MAI en Azure Foundry) | **NO CONFIRMADO** (el catálogo no lista regiones) | «Gestionado por Microsoft»; sin detalle | — |
| Black Forest Labs | `api.eu.bfl.ai` según la documentación leída el 17/11; hoy no se ha encontrado la página | Puede entrenar con las entradas salvo contrato enterprise (`docs/ia-medios.md`); hoy sin confirmar | API de pago: comercial. Pesos abiertos: licencias por niveles |
| Mistral | `api.eu.mistral.ai`, +10 %; los metadatos de cuenta pueden salir de la región | Entrenamiento con datos de la API: la página no lo dice | — |
| ElevenLabs | **NO CONFIRMADO** | Retención cero solo citada para el modelo médico | — |
| Deepgram / AssemblyAI | Puntos UE propios (`api.eu.deepgram.com`, `api.eu.assemblyai.com`) | — | — |
| fal.ai, Runway, Replicate | Sin UE declarada | Ver §9 | fal.ai: licencia por modelo («Commercial use» / «Research only») |
| MiniMax, Kling, Seedance, Wan (vía fal.ai o Runway) | No | Proveedores de China a través de un intermediario de EE. UU. | Por modelo; **comprobar** |
| Ideogram | No documentada | La página no explica qué hace con lo enviado por la API | «Libre para cualquier uso, incluido el comercial» (su FAQ) |

**Consecuencias prácticas:**

- Las fotos de platos no suelen ser datos personales; **las fotos con personas
  y el audio de los reels sí**. Lo que lleve personas, solo por proveedores con
  UE (OpenAI con residencia, Vertex, Mistral, Deepgram, AssemblyAI) o sin IA.
- El vídeo generativo no tiene hoy ninguna opción con UE confirmada: se activa
  con `AI_MEDIA_ALLOW_NON_EU` y avisando en la interfaz, solo con fotos sin
  personas.
- Cada proveedor que se active hay que añadirlo a `docs/rgpd.md` §3 y a
  `legal.ts`, y firmar su contrato de tratamiento.

---

## 11. Coste mensual en tres escenarios

Volúmenes del §2 (base, ×3 y ×10). Dólares al mes, sin impuestos.

### 11.1 Por capacidad

| Capacidad (volumen base) | Opción | Base | ×3 | ×10 |
|---|---|---|---|---|
| Animar fotos (60 clips de 5 s) | Sin IA (zoom, parallax) | 0 | 0 | 0 |
| | MiniMax H3 768p, 0,06 $/s (**recomendada**) | 18,00 | 54,00 | 180,00 |
| | Gemini Omni 1.2 Flash 720p, 0,07 $/s | 21,00 | 63,00 | 210,00 |
| | Kling v3 Standard, 0,084 $/s | 25,20 | 75,60 | 252,00 |
| | Seedance 2.5 720p, 0,30 $/s (mejor en AA) | 90,00 | 270,00 | 900,00 |
| | MiniMax H3 480p, 0,05 $/s (más barata fiable) | 15,00 | 45,00 | 150,00 |
| Animar carteles y textos | FFmpeg en el trabajador | 0 | 0 | 0 |
| Órdenes del copiloto (3.000) | Claude Haiku 5.5, Vertex UE (**recomendada**) | 1,09 | 3,27 | 10,89 |
| | `gpt-6-luna`, UE | 1,09 | 3,27 | 10,89 |
| | `gpt-6.1-terra`, UE | 10,89 | 32,67 | 108,90 |
| | Claude Sonnet 5.5, Vertex UE | 21,78 | 65,34 | 217,80 |
| | Claude Haiku 5.5, API directa (más barata) | 0,99 | 2,97 | 9,90 |
| Pies de foto (1.000) | Claude Sonnet 5.5, Vertex UE (**recomendada**) | 7,70 | 23,10 | 77,00 |
| | `gpt-6.1-terra`, UE | 3,85 | 11,55 | 38,50 |
| | Claude Haiku 5.5, API directa (más barata) | 0,35 | 1,05 | 3,50 |
| Ediciones de foto (250) | OpenAI `gpt-image-2.5-sunburst`, UE, ≈ 0,11 $ (**recomendada**) | 27,50 | 82,50 | 275,00 |
| | OpenAI a calidad alta (cota de rrss, 0,26 $) | 65,00 | 195,00 | 650,00 |
| | MAI-Image-2.7, ≈ 0,043 $ | 10,75 | 32,25 | 107,50 |
| | Nano Banana 2.1, ≈ 0,036 $ | 9,00 | 27,00 | 90,00 |
| | Seedream 5.5, ≈ 0,028 $ (más barata) | 7,00 | 21,00 | 70,00 |
| Subtítulos (100 min) | OpenAI `gpt-transcribe`, UE (**recomendada**) | 0,50 | 1,49 | 4,95 |
| | ElevenLabs Scribe v3 (mejor en AA) | 0,33 | 1,00 | 3,33 |
| | Groq `whisper-large-v3-turbo` (más barata) | 0,07 | 0,20 | 0,67 |
| Imágenes creadas (300) | OpenAI `gpt-image-2.5-flare` media, UE, ≈ 0,058 $ (**recomendada**) | 17,49 | 52,47 | 174,90 |
| | OpenAI `gpt-image-2.6-sunburst` máxima, 0,211 $ (mejor en AA) | 63,30 | 189,90 | 633,00 |
| | Nano Banana 2.1, 0,0336 $ | 10,08 | 30,24 | 100,80 |
| | FLUX 3 Image Klein, 0,009 $ (más barata) | 2,70 | 8,10 | 27,00 |

### 11.2 Totales

| Combinación | Qué lleva | Base | ×3 | ×10 |
|---|---|---|---|---|
| **Recomendada** | H3 por fal.ai + Haiku 5.5 y Sonnet 5.5 por Vertex UE + OpenAI UE para editar, generar y transcribir | **72** | **217** | **723** |
| Recomendada sin vídeo generativo | Lo mismo, con todo el movimiento sin IA | 54 | 163 | 543 |
| Solo la clave de OpenAI (primer día) | `gpt-6-luna` en el copiloto, `gpt-6.1-terra` en los pies, edición, generación y subtítulos; movimiento sin IA | 50 | 151 | 504 |
| Calidad máxima | Seedance 2.5 + Sonnet 5.5 en todo el texto + OpenAI a calidad alta y máxima + Scribe v3 | 248 | 744 | 2.481 |
| Más barata | H3 480p + Haiku 5.5 directo + Seedream 5.5 + FLUX 3 Klein + Whisper en Groq (sin UE; un adaptador nuevo y varios ajustes) | 26 | 78 | 261 |

- La partida que manda es la **imagen** (editar y generar) y, si se usa, el
  vídeo. El texto y los subtítulos son calderilla en cualquier escenario.
- Pasar las ediciones de OpenAI a MAI-Image-2.7 o Seedream 5.5 ahorraría unos
  17-20 $ al mes en el escenario base y 170-200 $ en el ×10: merece la prueba a
  ciegas del §6 cuando el volumen crezca.
- Cada reel con un clip de IA añade 0,30-0,42 $; generado entero, 0,90-1,26 $.
- El punto en que compensa una GPU propia sigue siendo el de
  `docs/servidor-gpu.md` §3.3.

---

## 12. Dudas sin confirmar

1. **Tarifa por imagen de `gpt-image-2.5` y `2.6`** en calidad media: OpenAI
   solo da tokens y una calculadora. Se ha usado la tarifa histórica de
   `gpt-image-2` (0,053 $). Medir con `usage` en la primera llamada.
2. **OpenAI en la UE:** hay que pedir elegibilidad a ventas y, para imagen, una
   aprobación aparte. `gpt-image-2.6` no está en la lista de residencia. Si
   `gpt-transcribe` lleva el +10 %, no lo dice.
3. **Precio de Claude en Vertex** (se aplica el +10 % que declara Anthropic; la
   página de Vertex no cargó) y nombre exacto del modelo en la consola.
4. **Latencia real del copiloto** (1-2 s) con Haiku 5.5: depende de bajar el
   esfuerzo o apagar el razonamiento, que el adaptador no hace hoy.
5. **Vertex en la UE** para Nano Banana 2.1, Gemini Omni 1.2 Flash y Gemini 3.5
   Transcribe.
6. **MAI-Image-2.7 y MAI-Transcribe-2:** precio oficial de Azure (la página
   sale sin cifras), regiones y si salen de vista previa.
7. **Seedream 5.5 y Seedance 2.5:** precio oficial de BytePlus.
8. **Fidelidad del plato en vídeo generativo:** no hay prueba pública con
   comida; decide la prueba con 5 fotos.
9. **Licencias no revisadas hoy:** uso comercial de cada modelo en fal.ai,
   Remotion (precio de la licencia de empresa), Depth Anything V2, Konva,
   lottie-web y las condiciones de salida de OpenAI, Google y Runway.
10. **Contratos de tratamiento** (DPA) de OpenAI, fal.ai, ElevenLabs y BFL, y
    si BFL entrena con lo enviado.
11. **Precios contradictorios en fal.ai:** Grok Imagine Video 1.5 (0,01 $/s
    frente a 0,16 $/s en Runway) y PixVerse V6 (0,005 $/s): no se han usado.
12. **Marcas de tiempo por palabra y español** en Scribe v3, Voxtral
    Transcribe 3 y AssemblyAI-STT-3.7.
13. **Volumen de vídeo** (60 clips al mes) es un supuesto propio.

---

## 13. Fuentes (consultadas el 22/11/2026)

Precios oficiales:

- OpenAI: <https://developers.openai.com/api/docs/pricing>,
  <https://developers.openai.com/api/docs/guides/image-generation>,
  <https://developers.openai.com/api/docs/guides/data-residency>,
  <https://developers.openai.com/api/docs/guides/your-data>
- Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing>,
  <https://platform.claude.com/docs/en/manage-claude/data-residency>
- Google (API de Gemini): <https://aistudio.google.com/docs/pricing>
  (redirige desde `ai.google.dev/gemini-api/docs/pricing`)
- Black Forest Labs: <https://bfl.ai/pricing>,
  <https://docs.bfl.ml/flux_3/flux3_image_layout.md>
- Ideogram: <https://ideogram.ai/pricing/?pricing_tab=api> («precios a 22 de
  noviembre de 2026»)
- Recraft: <https://www.recraft.ai/docs/api-reference/pricing>
- Photoroom: <https://www.photoroom.com/api/pricing>; Bria: <https://docs.bria.ai/>
- Microsoft: <https://ai.azure.com/catalog/models/MAI-Image-2.7>,
  <https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/>
  (sin cifras)
- Mistral: <https://docs.mistral.ai/inference/pricing>,
  <https://docs.mistral.ai/inference/regional-inference>
- ElevenLabs: <https://elevenlabs.io/pricing/api>; Deepgram:
  <https://deepgram.com/pricing>; AssemblyAI: <https://www.assemblyai.com/pricing>;
  Gladia: <https://www.gladia.io/pricing>; Groq: <https://console.groq.com/docs/models>
- Runway: <https://docs.dev.runwayml.com/guides/pricing/>; Shotstack:
  <https://shotstack.io/pricing/>
- fal.ai: <https://fal.ai/pricing>, <https://fal.ai/docs/model-apis/faq> y las
  fichas `https://fal.ai/models/<id>/llms.txt` de `minimax/h3/image-to-video`,
  `fal-ai/kling-video/v3/standard/image-to-video`,
  `alibaba/wan-3.0/image-to-video`, `microsoft/mai-image-2.7/edit`,
  `google/nano-banana-2.1/edit` y `fal-ai/topaz/upscale/image`
- Replicate: <https://replicate.com/pricing>; OpenRouter:
  <https://openrouter.ai/docs/faq>,
  <https://openrouter.ai/docs/features/multimodal/image-generation>; Vercel:
  <https://vercel.com/docs/ai-gateway/pricing> (actualizada el 08/09/2026),
  <https://vercel.com/ai-gateway/models>; Cloudflare:
  <https://developers.cloudflare.com/workers-ai/platform/pricing/>,
  <https://developers.cloudflare.com/workers-ai/models/>

Clasificaciones:

- Artificial Analysis: <https://artificialanalysis.ai/image/leaderboard/text-to-image>,
  <https://artificialanalysis.ai/image/leaderboard/editing>,
  <https://artificialanalysis.ai/video/leaderboard/image-to-video>,
  <https://artificialanalysis.ai/speech-to-text>,
  <https://artificialanalysis.ai/leaderboards/models> y las fichas de
  `claude-haiku-5-5`, `gpt-6-luna`, `gpt-6-1-terra`, `gemini-3-5-flash-lite`
  y `mistral-small-4` (ninguna enseña fecha de los datos)
- arena.ai (antes LMArena): <https://arena.ai/leaderboard/text-to-image>
  (21/11/2026), <https://arena.ai/leaderboard/image-edit> (16/11/2026),
  <https://arena.ai/leaderboard/image-to-video> (08/11/2026),
  <https://arena.ai/leaderboard/text> (20/11/2026)

Fuentes secundarias (no oficiales, usadas solo donde se indica):

- Fidelidad en vídeo: <https://getimg.ai/blog/best-image-to-video-model-for-product-ads-test>,
  <https://www.krea.ai/blog/top-6-ai-video-models-for-ecommerce-ads-in-2026>,
  <https://www.kittl.com/blogs/kittl-review-kling-3-0-4k/>,
  <https://wavespeed.ai/blog/video-model-access/image-to-video-ai-model-comparison/>
- Español en transcripción: <https://assemblyai.com/benchmarks>
- Seedream 5.5: <https://www.llmreference.com/model/seedream-v5.5/byteplus>,
  <https://www.productbuilder.net/models/seedream-5-5>
- MAI-Image-2.7: <https://www.llmreference.com/model/mai-image-2-7/microsoft-foundry>

No se pudieron leer: la tabla de Vertex AI
(<https://cloud.google.com/vertex-ai/generative-ai/pricing>), la licencia de
Remotion (<https://www.remotion.dev/docs/license>), los precios de Creatomate y
la página de precios de Groq (se usó la de modelos). La página de precios de
Vercel traía notas dirigidas a asistentes automáticos (seguir enlaces y enviar
comentarios); no se siguieron.
