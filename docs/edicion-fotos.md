# Edición de fotos bajo demanda

Rama `f6/edicion-fotos` (sale de `f5/integracion`). Para cualquier marca, desde
la **ficha de una foto en la biblioteca** («Editar foto») y desde una **capa de
imagen del editor** («Editar foto» en el panel Diseño; el resultado sustituye
la imagen de la capa y se deshace con Ctrl+Z).

**Regla que no se rompe:** la foto original no se toca nunca. Cada resultado
es un recurso **nuevo** de la biblioteca (carpeta «Ediciones»), con su
procedencia en `media_assets.provenance`, igual que «Exportar imagen».

## 1. Qué hace cada acción y con qué

| Acción | Con IA | Dónde se hace | Procedencia del resultado |
|---|---|---|---|
| Mejorar: luz, contraste, color, temperatura, nitidez («Mejorar automáticamente» o a mano) | No | Navegador (`src/features/photo-edit/pixels.ts`) | `photo_edit`, paso `adjust` con los valores |
| Mejorar: encuadre a 1:1, 4:5 o 9:16 | No | Navegador (`framing.ts`) | `photo_edit`, paso `crop` con la caja |
| Recortes por red 1:1, 4:5 y 9:16 con encuadre inteligente (uno por formato) | No | Navegador (`framing.ts`) | `photo_edit`, paso `crop` |
| Poner fondo liso, de un color de la marca o una imagen de la biblioteca (a una foto que ya tiene transparencia) | No | Navegador (`compositeOver`) | `photo_edit`, paso `background` |
| Quitar el fondo | **Sí** | `ai-media` (`photo.edit`) → adaptador de IA de medios | `ai_edit`, `operation: remove_background` |
| Ampliar la resolución ×2 o ×4 (hasta 4096 px por lado) | **Sí** | `ai-media` (`photo.edit`) → adaptador | `ai_edit`, `operation: upscale`, `scale` |

«Cambiar el fondo» de una foto normal son dos pasos: quitarlo (IA) y poner
otro (sin IA). Al terminar de quitarlo, el diálogo pasa a editar la foto sin
fondo para elegir el nuevo.

Se editan fotos y logotipos JPEG, PNG o WebP. Con IA, además, tienen que estar
en nuestro almacenamiento (Supabase o R2; las de Google Drive no se mandan a
ningún proveedor) y tener medidas. En el navegador se edita hasta 24 MP; lo
mayor se reduce y se avisa.

### Sin IA: cómo funciona y sus límites

- **Mejorar automáticamente** mira el histograma: estira negros y blancos si
  la foto no llega, corrige la mitad de la dominante de color (mundo gris),
  aclara las oscuras, aviva un poco las apagadas y da algo de nitidez
  (máscara de enfoque sobre la luminancia). Es moderado a propósito y se
  puede retocar con los deslizadores antes de guardar.
- **Encuadre inteligente** no reconoce objetos: busca dónde se concentran los
  bordes, el detalle y el color, con algo de preferencia por el centro, y
  coloca ahí el recorte más grande que cabe en cada formato. Funciona bien con
  un plato o un producto sobre un fondo más liso; con fondos cargados conviene
  mirar la vista previa (y se puede desmarcar para centrar).
- El resultado es PNG si tiene transparencia o el original era PNG; si no,
  JPEG al 92 %. Los ajustes se ven en una vista previa reducida y se guardan a
  tamaño completo.
- Las fotos se leen con `crossOrigin = "anonymous"` (como «Exportar imagen»);
  si el navegador las tiene en caché sin CORS, lo dice.

### Con IA: interruptor, cupo y coste

- Salen solo con **`VITE_AI_PHOTO_EDIT_ENABLED=true`** en el despliegue **y**
  si el servidor tiene un modelo para esa acción (`ai-media`,
  `photo.options`). Sin proveedor, «Quitar el fondo» y la pestaña «Ampliar» no
  aparecen y el diálogo lo dice («no está disponible en este entorno»).
- Mismo camino que la imagen con IA (`docs/ia-medios.md`): se estima el coste
  máximo **antes** (`photo.estimate`, no reserva nada) y se enseña; al editar,
  `ai_reserve_generation` aparta el cupo de la **organización** (tarea
  `image`, función del plan `ai_image`); sin cupo no se llama al proveedor. Cada
  edición queda en `ai_generations` con `purpose = photo.remove_background` o
  `photo.upscale` y su coste real: sale en el consumo de IA y en el margen por
  cliente como cualquier generación.
- Quien solo ve la marca no puede editar (la base de datos lo impide al
  reservar, 403). La foto se lee con la identidad de quien pide (RLS) y viaja
  al proveedor como URL firmada de 15 minutos.
- Los asíncronos (ComfyUI) los cierra `ai-media-poll`; si se cierra el
  diálogo, el resultado llega igualmente a la biblioteca.

## 2. Servidor

- Contrato (`_shared/ai/media/contract.ts`): petición `ImageEditRequest`
  (`kind: 'image_edit'`, `operation`, `source` con medidas, `scale`). Los
  adaptadores declaran las ediciones que saben hacer (`edits`). Los adaptadores
  que no las saben (Vertex, BFL, Ideogram, vídeo) las rechazan.
- Registro (`ai_media_models.operation`): `generate` (por defecto),
  `remove_background` o `upscale`. **Un modelo de edición nunca se elige para
  generar ni al revés** (`resolveMediaModel` / `resolveEditModel`). Mismo
  criterio de datos: solo se eligen solos los que procesan en la UE; los demás
  hay que fijarlos con `AI_MEDIA_REMOVE_BACKGROUND_MODEL` o
  `AI_MEDIA_UPSCALE_MODEL` (`proveedor:modelo`) o permitirlos con
  `AI_MEDIA_ALLOW_NON_EU`.
- Validación antes de reservar: JPEG, PNG o WebP; como mucho 36 MP de entrada
  (`settings.max_input_pixels`); al ampliar, como mucho 4096 px por lado del
  resultado (`settings.max_output_side`).
- Almacenamiento: `…/ia/<generación>-0.png`, carpeta «Ediciones», etiquetas
  `ia` y `edición`, nombre «Sin fondo · <original>.png» o «Ampliada ×2 ·
  <original>.png».
- `ai-media` (acciones nuevas):
  - `photo.options` → `{ edits: [{ operation, model, delivery, dataRegion, euProcessing, trainsOnInputs, untestedAdapter }] }`
  - `photo.estimate` `{ assetId, operation, scale? }` → `{ costMicros, model, dataHandling }`
  - `photo.edit` `{ assetId, operation, scale? }` → 200 `{ status: "completed", asset }` o 202 `{ status: "pending", generationId }`.

## 3. Base de datos (migración `20261128010000_photo_editing.sql`)

Con su vuelta atrás en `supabase/rollbacks/`. **Sin tablas nuevas**: el
registro de cada edición con IA es su fila de `ai_generations` y la relación
con el original vive en la procedencia del recurso.

1. `ai_media_models.operation` con sus restricciones (las ediciones solo de
   imagen) y privilegio de cambiarla solo para superadministradores (RLS del
   registro).
2. Dos filas de ComfyUI propio **inactivas** y con el precio **sin verificar**:
   `comfyui · birefnet-general` (quitar el fondo) y `comfyui ·
   realesrgan-x4plus` (ampliar).
3. Guarda de la procedencia (`private.media_assets_edit_provenance_guard`):
   - `type: 'ai_edit'` solo lo escribe el servidor (como `ai_generation`);
   - en `ai_edit` y `photo_edit`, `source_asset_id` tiene que ser un recurso de
     **la misma marca** que quien inserta puede ver: no se puede decir que una
     foto sale de la de otra marca u organización. No es clave foránea a
     propósito (si el original se borra, la edición conserva de dónde salió);
   - índice por `source_asset_id` para listar las ediciones de una foto.

Procedencia de una edición del navegador:

```json
{ "type": "photo_edit", "source_asset_id": "…", "width": 1080, "height": 1350,
  "edited_at": "2026-11-20T10:00:00.000Z",
  "steps": [ { "kind": "adjust", "auto": true, "exposure": 12, "contrast": 0, "saturation": 8,
               "warmth": 0, "sharpness": 20, "levels": { "black": 14, "white": 231 }, "balance": [1.04, 1, 0.95] },
             { "kind": "crop", "aspect": "4:5", "smart": true, "box": { "x": 310, "y": 0, "width": 2400, "height": 3000 } } ] }
```

Con IA:

```json
{ "type": "ai_edit", "operation": "remove_background", "source_asset_id": "…", "generation_id": "…",
  "provider": "comfyui", "model": "birefnet-general", "purpose": "photo.remove_background",
  "data_region": "unknown", "trains_on_inputs": "no", "untested_adapter": true }
```

## 4. ComfyUI propio: flujos de trabajo (opción principal)

**SIN CONTRASTAR con un ComfyUI real** (solo con respuestas HTTP simuladas).
Mismo servidor, túnel y riesgos que la imagen con IA (`docs/ia-medios.md` §11).

### Ampliar (`comfyui · realesrgan-x4plus`): solo nodos del núcleo

```
LoadImage(foto) ─► ImageUpscaleWithModel(UpscaleModelLoader("RealESRGAN_x4plus.pth"))
               ─► ImageScale(lanczos, ancho × alto exactos, crop disabled) ─► SaveImage
Si la foto es PNG o WebP (puede tener alfa):
LoadImage.mask ─► MaskToImage ─► ImageScale(mismo tamaño) ─► ImageToMask(red)
               ─► JoinImageWithAlpha(imagen ampliada, alfa) ─► SaveImage
```

Real-ESRGAN amplía ×4 de forma nativa; para ×2 se reduce después al tamaño
exacto. Archivo: `RealESRGAN_x4plus.pth` (Real-ESRGAN, licencia BSD-3-Clause)
en `ComfyUI/models/upscale_models/`. El nombre se cambia en
`settings.upscale_model_name`.

### Quitar el fondo (`comfyui · birefnet-general`): un nodo personalizado

El núcleo de ComfyUI no tiene ningún nodo que quite el fondo. El flujo usa,
por defecto, el nodo `BiRefNetRMBG` del paquete **ComfyUI-RMBG**
(1038lab/ComfyUI-RMBG, licencia GPL-3.0; se ejecuta en el servidor de
ComfyUI, no se distribuye con nuestro código) con el modelo **BiRefNet**
(licencia MIT):

```
LoadImage(foto) ─► <rmbg_class_type>(image = foto, …rmbg_inputs) ─► máscara (salida rmbg_mask_output)
               ─► InvertMask (si rmbg_mask_is_foreground) ─► JoinImageWithAlpha(foto, alfa) ─► SaveImage (PNG con alfa)
```

`JoinImageWithAlpha` (núcleo) invierte la máscara que recibe (en ComfyUI las
máscaras marcan lo transparente); por eso se invierte antes cuando el nodo
devuelve «1 = lo que se queda». Todo es configurable en `settings` sin tocar
código: `rmbg_class_type`, `rmbg_inputs`, `rmbg_image_input`,
`rmbg_mask_output`, `rmbg_mask_is_foreground`.

**Antes de activarlo:**

1. Instalar ComfyUI-RMBG fijado a un commit concreto (como el resto de nodos
   del cuaderno) y comprobar sus nombres con `GET /object_info/BiRefNetRMBG`
   (entradas y en qué salida va la máscara). Si no coinciden, ajustar
   `settings` en la fila.
2. **Ojo: ese paquete descarga los pesos del modelo la primera vez que se usa.**
   Hacerlo a propósito al preparar el servidor (no en la primera petición de un
   cliente) y comprobar la licencia del modelo elegido: **RMBG-2.0 de BRIA es
   CC BY-NC (no comercial): no usarlo**; BiRefNet es MIT.
3. Fijar el precio por imagen según la GPU y activar:
   `update ai_media_models set price_micros = <coste>, price_verified = true, active = true where provider = 'comfyui' and operation <> 'generate';`
4. Si el servidor no está en la UE (Colab: región desconocida):
   `AI_MEDIA_REMOVE_BACKGROUND_MODEL=comfyui:birefnet-general` y
   `AI_MEDIA_UPSCALE_MODEL=comfyui:realesrgan-x4plus` en las funciones.
5. `VITE_AI_PHOTO_EDIT_ENABLED=true` en el despliegue.

## 5. Alternativa sin GPU en el trabajador (valoración, sin descargar nada)

Pregunta: ¿se puede quitar el fondo en el trabajador de medios (Node + FFmpeg,
sin GPU) con calidad aceptable? **Sí, con condiciones**, pero no se ha hecho:
habría que descargar pesos (100–200 MB) y eso queda a la espera del «sí».

| Opción | Licencia (a contrastar en la ficha del modelo antes de usar) | Calidad esperada en fotos de producto o plato | CPU (orden de magnitud, sin medir) |
|---|---|---|---|
| BiRefNet (general o *lite*) en ONNX con `onnxruntime-node` | MIT (modelo), MIT (onnxruntime) | La mejor de las abiertas, bordes finos | Varios segundos por foto a 1024 px con 2–4 vCPU; 1,5–2 GB de RAM |
| IS-Net (DIS, `isnet-general-use`) en ONNX | Apache-2.0 | Buena; algo peor en pelo y bordes finos | 1–3 s por foto; ~1 GB de RAM |
| U²-Net / U²-Netp | Apache-2.0 | Aceptable en objetos con fondo liso; flojo en bordes (máscara a 320 px) | < 1 s; U²-Netp pesa 4,7 MB |
| `@imgly/background-removal-node` | **AGPL-3.0**: obligaría a publicar el código del servicio. Descartada | — | — |
| RMBG-1.4 / RMBG-2.0 de BRIA | **No comercial** sin contrato. Descartada | — | — |

Recomendación si el dueño lo quiere: trabajo nuevo `media.image.remove_background`
en el trabajador con `onnxruntime-node` y **BiRefNet lite** (o IS-Net si la
máquina es pequeña), pesos copiados en la imagen Docker del trabajador (no
descargados al vuelo), salida PNG con alfa a la carpeta «Ediciones» con
procedencia `media_job`. Coste por foto: solo CPU del trabajador (sin cupo de
IA, pero sí de almacenamiento). Encaja con el alojamiento propuesto (Fly.io en
Fráncfort, datos en la UE). Pendiente: el «sí» a descargar los pesos, medir
tiempo y calidad con 20–30 fotos reales de la marca, y el tamaño de máquina.

## 6. Pruebas

- Unitarias (`src/features/photo-edit/edicion.test.ts`): ajustes (sin cambio
  con ajustes neutros, la entrada no cambia, nitidez, automático), fondo y
  transparencia, encuadre inteligente (se va donde está el detalle, centrado si
  no hay nada), procedencia y nombres, qué se puede editar y factores de
  ampliación.
- Componentes (`editarFoto.test.tsx`): biblioteca (lectora no edita; mejorar y
  recortes guardan recursos nuevos con procedencia y el original no cambia;
  sin IA no se ofrece quitar el fondo; fondo de color sobre una foto sin fondo;
  con IA, coste antes y resultado nuevo; interruptor encendido sin modelo) y
  editor (la capa pasa a usar la foto editada). El lienzo del navegador se
  sustituye por dobles (jsdom no dibuja).
- Base de datos (`tests/db/edicion-fotos.test.ts`): migración, guarda de la
  procedencia y aislamiento entre marcas y organizaciones, elección de modelo,
  `ai-media` con la edición simulada (recurso nuevo, original intacto, cupo,
  permisos, límites) y ComfyUI con HTTP simulado (flujos y camino asíncrono
  hasta la biblioteca).
- Extremo a extremo: `tests/e2e/22-edicion-fotos.spec.ts` (quitar el fondo con
  la edición simulada y comprobar que la fila y el archivo originales no
  cambian). **Escrita y sin ejecutar.**

**Sin probar:** contra un ComfyUI real (los dos flujos), el dibujo real en un
navegador (lectura de píxeles, codificación PNG/JPEG, CORS de R2 y de Drive) y
la prueba e2e.
