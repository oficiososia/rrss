# Copiloto por voz del editor

Estado a 19/11/2026. Rama `f4/copiloto-voz`. **Sin probar contra un proveedor
de IA real** (no hay cuentas) ni con el dictado real de un navegador: probado
con el proveedor simulado de pruebas locales y una Web Speech API simulada.

La persona dicta en el editor de una pieza («quiero hacer el menú de Navidad,
foto difuminada detrás, esta, encima el logotipo y el menú con estos platos…»)
y el copiloto va montando la composición con las capas del documento v2/v3:
foto de fondo (desenfocada si se pide), logotipo de la marca y textos con las
tipografías y los colores del perfil. **No genera imágenes ni redacta**: los
textos van exactamente como se dictan.

| Pieza | Estado |
|---|---|
| Desenfoque de imágenes en el documento (versión 3), lienzo, exportación y reels del trabajador | Implementado y probado (unitarias, base de datos y FFmpeg en el trabajador) |
| Tarea `editor.copilot` en `ai-generate` (esquema estricto, saneado, cupo y coste) | Implementada y probada con la base de datos real y el proveedor simulado |
| Interfaz (botón «Dictar», transcripción en vivo, órdenes, foto «esta», deshacer) | Implementada; prueba de extremo a extremo escrita (`tests/e2e/19-copiloto-voz.spec.ts`) |
| Dictado real del navegador y calidad con un modelo real | **Sin probar** |

## 1. Cómo funciona

```
voz ──(Web Speech API, es-ES)──► frase terminada = ORDEN
ORDEN + estado del documento + fotos elegidas ──► ai-generate (editor.copilot)
                                                  │  perfil de marca (lo lee la función, RLS)
                                                  ▼
                       operaciones validadas y saneadas en el servidor
                                                  ▼
 navegador: esquema estricto → textos dictados → aplicar (posición, tipografía, color)
            → validar el documento con su esquema → UN paso de deshacer
```

- **Dictado.** `src/features/content/copilot/speech.ts`. Continuo, con texto
  provisional en pantalla mientras se habla. Cada frase terminada es una orden;
  las órdenes van de una en una, cada una sobre el documento que dejó la
  anterior. Si el navegador corta tras un silencio, se vuelve a empezar solo
  hasta que se pulsa «Parar» o se cierra el copiloto. Si el navegador no tiene
  dictado, el botón no sale. En Chrome el reconocimiento lo hace un servicio
  de Google (el audio sale del navegador hacia Google): recogido en el registro
  de tratamientos (`docs/rgpd.md`, apartado 3); falta llevarlo a la política de
  privacidad y avisar antes del primer dictado, antes de activarlo con clientes.
- **Interpretación.** Tarea `editor.copilot`
  (`supabase/functions/_shared/ai/text/tasks/editor-copilot.ts`).
- **Aplicación.** `src/features/content/copilot/apply.ts`, pura: la IA dice qué
  (un título arriba, la foto de fondo difuminada) y el editor decide dónde y
  cómo: tamaños de letra por estilo, primera tipografía del perfil para títulos
  y segunda para el resto, primer color del perfil para títulos y segundo para
  el resto, textos que no se pisan, logotipo con sus proporciones.
- **Deshacer.** Cada orden aplicada es la acción `replace` del editor: un solo
  paso de Ctrl+Z, aunque haya puesto fondo, logotipo y tres textos.
- **«Esta foto».** Cuenta la imagen elegida en el lienzo y las fotos elegidas
  con «Elegir foto» en el panel del copiloto (de la biblioteca o subida desde
  el dispositivo; queda en la biblioteca). Si la orden pide una foto y no hay
  ninguna, se abre el selector; si se cierra sin elegir, se aplica el resto.
- **Marca «Generado con IA».** El copiloto no la pone: los textos son los de la
  persona y las fotos, suyas. Si coloca una imagen generada con IA de la
  biblioteca, la marca sale por esa imagen como siempre.

## 2. Operaciones

Lista cerrada (`op`); cada operación trae todos los campos, a `null` los que no
aplican: `target` (capa existente), `text`, `style` (`title`, `subtitle`,
`body`, `small`), `assetId`, `position` (`top`, `upper`, `middle`, `lower`,
`bottom`), `align`, `color`, `font`, `blur` (0–100).

| `op` | Qué hace |
|---|---|
| `add_text` | Añade un texto dictado |
| `update_text` | Cambia el texto o el estilo de una capa de texto |
| `set_background_image` | Pone (o cambia) la foto que cubre todo el lienzo; con `blur`, difuminada |
| `blur_image` | Desenfoca una imagen (sin `target`, la de fondo) |
| `add_logo` | Pone un logotipo del perfil |
| `move_layer` | Mueve una capa a una posición o alineación |
| `remove_layer` | Quita una capa |
| `set_background_color` | Color de fondo del lienzo |

## 3. Defensa: nada sin validar llega al documento

1. **Instrucciones fijas** del producto; el dictado, el perfil, el estado del
   documento y los nombres de las fotos viajan como material delimitado
   (`DATA_RULE`), nunca en las instrucciones.
2. **Esquema estricto** de salida (`EDITOR_COPILOT_SCHEMA`), validado entero en
   el servidor: otra operación, un campo de más o un estado producen
   `invalid_output` y no se aplica nada.
3. **Saneado determinista** en el servidor (`sanitizeOperations`), con el motivo
   de cada descarte en la respuesta:
   - textos que no están en lo dictado (mismas palabras en el mismo orden; se
     perdonan mayúsculas y signos de puntuación, no palabras, tildes ni números);
   - fotos que no se enviaron (y el servidor solo envía a la IA las fotos de la
     marca que el usuario ve, por RLS);
   - logotipos que no son del perfil, capas que no existen o están bloqueadas;
   - colores fuera de la paleta (salvo blanco y negro) y tipografías fuera del
     perfil: se quitan y el editor pone los de la marca.
4. **En el navegador**: la respuesta se valida otra vez con un esquema zod
   estricto, se vuelve a comprobar que los textos están en lo dictado y el
   documento resultante se valida con el esquema del documento. Si algo falla,
   no se aplica nada de esa orden.
5. Ni la tarea ni el editor conocen aprobar, programar ni publicar.

El proveedor simulado de pruebas locales imita a un modelo comprometido: si el
dictado contiene «ignora lo anterior», añade un texto no dictado y una foto no
elegida; las pruebas comprueban que se descartan.

## 4. Cupo, coste y modo agencia

- Una orden = una llamada a `ai-generate` = una generación en `ai_generations`
  con propósito `editor.copilot`, con su reserva de cupo y su coste por
  organización, como las demás tareas. Sin cupo, se explica igual que en el
  resto de la IA y se puede seguir editando a mano.
- **Modo agencia (provisional).** `ai-generate` devuelve 409 `agency_mode` a las
  tareas de texto de las marcas en modo agencia. El copiloto es la única
  excepción (`AGENCY_MODE_ALLOWED_ACTIONS`): no redacta, coloca lo dictado.
  Está en «Decisiones del dueño pendientes» de `docs/ESTADO.md`.

## 5. Configuración

| Variable | Dónde | Para qué |
|---|---|---|
| `VITE_AI_VOICE_COPILOT_ENABLED` | Despliegue de la aplicación | `true` enseña «Dictar». Además hace falta `VITE_AI_TEXT_ENABLED=true`, que el servidor diga que la IA de texto está configurada (`platform-integrations`, como el resto de la IA; regla de honestidad: sin proveedor, no sale) y un navegador con dictado |
| `AI_TEXT_EDITOR_COPILOT_PROVIDER` / `_MODEL` | Plataforma → Integraciones → IA de texto («Copiloto por voz del editor», migración `20261123010000`) o secretos de `ai-generate` | Adaptador y modelo solo para el copiloto (si no, los de `AI_TEXT_PROVIDER` / `AI_TEXT_MODEL`) |

Sin llevar a `.env.example` (pendiente conocido de `docs/ESTADO.md`).

Petición:

```json
{ "action": "editor.copilot", "brandId": "<uuid>",
  "input": { "transcript": "…", "document": { "canvas": {…}, "layers": [{ "id", "type", "text"?, "x", "y", "width", "height", "locked"?, "blur"? }] },
             "assets": [{ "id": "<uuid>", "name": "mesa.jpg" }] } }
```

Respuesta 200: `{ action, generationId, operations, discarded: [{ index, op, reason }], note }`.

## 6. Desenfoque (documento versión 3)

- `blur` (0–100, opcional) en las capas de imagen. Radio = `blur` % del 5 % del
  lado menor de la capa (`blurRadius`): igual en el editor, al exportar a
  cualquier tamaño y en los reels.
- El documento pasa a la **versión 3** con la migración 2 → 3 (no cambia nada:
  las imágenes quedan nítidas). Se sube la versión para que una aplicación
  anterior diga «versión más reciente» en vez de abrir el documento y perder
  el desenfoque al guardar.
- Lienzo y exportación: `filter: blur()` del lienzo 2D (con la escala del
  contexto), la imagen un poco más grande que la caja y recortada para que no
  se oscurezcan los bordes. Sin `filter` (Safari antiguo), se aproxima
  reduciendo y ampliando.
- Panel de propiedades de la imagen: «Desenfoque (%)».
- Reels del trabajador: `blur` en cada pieza de `plan.media` (foto o clip),
  aplicado con `gblur` de FFmpeg después del recorte. La validación del encargo
  en la base de datos lo admite desde la migración
  `20261121010000_reel_media_blur.sql` (vuelta atrás en `supabase/rollbacks/`).
  La pantalla de reels todavía no ofrece desenfocar: el plan lo admite.

## 7. Pendiente

- Probar con un proveedor real (calidad de la interpretación en español, coste
  por orden) y con el dictado real de Chrome, Edge y Safari.
- Registro de tratamientos: el dictado de Chrome envía el audio a Google.
- Corregir una orden mal entendida escribiéndola (hoy solo por voz o a mano en
  el editor).
- Ofrecer el desenfoque en la pantalla de reels.
