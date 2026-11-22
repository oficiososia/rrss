# Edición de fotos bajo demanda

Rama `f6/edicion-fotos` (sale de `f5/integracion`). Para cualquier marca, desde
la **ficha de una foto en la biblioteca** («Editar foto») y desde una **capa de
imagen del editor** («Editar foto» en el panel Diseño; el resultado sustituye
la imagen de la capa y se deshace con Ctrl+Z).

**Regla que no se rompe:** la foto original no se toca nunca. Cada resultado
es un recurso **nuevo** de la biblioteca (carpeta «Ediciones»), con su
procedencia en `media_assets.provenance`, igual que «Exportar imagen».

## 1. Qué hace cada acción y con qué

| Acción                                                                                                                                                        | Con IA                                     | Dónde se hace                                         | Procedencia del resultado                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| Mejorar: luz, contraste, color, temperatura, nitidez, sombras, luces, claridad, viveza («Mejorar automáticamente» o a mano)                                   | No                                         | Navegador (`src/features/photo-edit/pixels.ts`)       | `photo_edit`, paso `adjust` con los valores                          |
| Mejorar: encuadre a 1:1, 4:5 o 9:16                                                                                                                           | No                                         | Navegador (`framing.ts`)                              | `photo_edit`, paso `crop` con la caja                                |
| Recortes por red 1:1, 4:5 y 9:16 con encuadre inteligente (uno por formato)                                                                                   | No                                         | Navegador (`framing.ts`)                              | `photo_edit`, paso `crop`                                            |
| Poner fondo liso, de un color de la marca o una imagen de la biblioteca, con sombra suave opcional (a una foto que ya tiene transparencia o recién recortada) | No                                         | Navegador (`cutout/composition.ts`)                   | `photo_edit`, paso `background` (con `shadow: true` si lleva sombra) |
| Quitar el fondo, **en el navegador** (por defecto)                                                                                                            | No (modelo propio en el navegador, gratis) | Navegador (`cutout/`, §7)                             | `photo_edit`, paso `remove_background` (`engine: browser`)           |
| Quitar el fondo, con IA (si el servidor tiene proveedor)                                                                                                      | **Sí**                                     | `ai-media` (`photo.edit`) → adaptador de IA de medios | `ai_edit`, `operation: remove_background`                            |
| Ampliar la resolución ×2 o ×4 (hasta 4096 px por lado)                                                                                                        | **Sí**                                     | `ai-media` (`photo.edit`) → adaptador                 | `ai_edit`, `operation: upscale`, `scale`                             |
| Cambiar el fondo con IA (texto libre; máscara del plato si la hay)                                                                                            | **Sí**                                     | `ai-media` (`photo.edit`) → OpenAI (§7)               | `ai_edit`, `operation: replace_background`, `prompt`                 |
| Mejorar luz y color con IA                                                                                                                                    | **Sí**                                     | `ai-media` (`photo.edit`) → OpenAI (§7)               | `ai_edit`, `operation: enhance`                                      |

«Cambiar el fondo» de una foto normal son dos pasos: quitarlo (en el navegador
o con IA) y poner otro (sin IA). Con el navegador, el recorte se queda en el
diálogo (sin guardar) y se elige el fondo encima, con vista previa; se guarda
UN recurso con los dos pasos en su procedencia (o solo el PNG transparente).
Con IA, al terminar de quitarlo el diálogo pasa a editar la foto sin fondo.
Si el servidor tiene IA además del navegador, salen las dos opciones y está
marcada la del navegador.

Se editan fotos y logotipos JPEG, PNG o WebP. Con IA, además, tienen que estar
en nuestro almacenamiento (Supabase o R2; las de Google Drive no se mandan a
ningún proveedor) y tener medidas. En el navegador se edita hasta 24 MP; lo
mayor se reduce y se avisa.

### Sin IA: cómo funciona y sus límites

- **Mejorar automáticamente** (rehecho el 22/11/2026 para fotos de comida y
  producto; segunda ronda el mismo día, más visible) analiza la foto y rellena
  los deslizadores (Luz, Contraste, Color, Temperatura, Nitidez, Sombras, Luces,
  Claridad y Viveza) para que se puedan retocar. Pasos: 0. _Sujeto, no fondo._ La luz, el balance de blancos y el color se miden sobre
  el plato y la comida: la foto se divide en una cuadrícula de 12×12 y cada
  zona pesa según su detalle (bordes, textura), restando el «ruido de fondo»
  (el grano de un cartón o un mantel) y con algo más de peso al centro. Si la
  foto ya tiene el fondo quitado (transparencia), el sujeto es lo opaco. Lo
  que protege de quemar (negro, blanco, p99) se mide en toda la foto.
  1. _Niveles_ por percentiles con recorte suave; como mucho ×1,45 para que un
     fondo liso no se queme. Sobre la luminancia, no por canal.
  2. _Balance de blancos_ sobre lo casi gris del sujeto (plato, mantel,
     servilleta; si no, lo poco saturado). Se corrige casi todo, menos hacia el
     frío, y va a Temperatura; el tinte verde–magenta es fino y sin deslizador.
     La carne y las salsas, saturadas, no cuentan como referencia.
  3. _Luz_ por la «clave» del sujeto (mediana y, menos, tonos altos), en un
     gamma sobre la luminancia.
  4. _Sombras_ y _Luces_: siempre un poco (relieve y blancos contenidos), más si
     hace falta.
  5. _Contraste_ y _Claridad_ (contraste local de radio proporcional a la foto).
  6. _Viveza_ (satura lo poco saturado, la mitad en rojos y naranjas, y frena el
     color si un canal fuera a quemarse), un toque de _Color_ y _Nitidez_ de
     detalle para costra, carne y salsas.
     **Intensidad:** Suave (×0,6), Normal (×1, ya bien visible) y Fuerte (×1,5)
     escalan todos los valores automáticos; cambiarla con la mejora puesta la
     recalcula. Vista previa, lienzo y archivo guardado usan la misma función
     (`applyAdjustments`); `Luz` es un gamma y `Temperatura` una ganancia
     rojo/azul, lo que también afecta, muy levemente, a las capas de imagen del
     editor. Se quita en un clic. Comparativas con fotos reales:
     `rrss-recursos-comparativa/mejora-automatica.jpg` (ronda 1) y
     `mejora-automatica-2.jpg` (original | ronda 1 | ronda 2 normal | fuerte).
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
  `photo.options`). Sin proveedor, la pestaña «Ampliar» y la opción de quitar el
  fondo con IA no aparecen; quitar el fondo sigue disponible en el navegador (§7).
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
{
  "type": "photo_edit",
  "source_asset_id": "…",
  "width": 1080,
  "height": 1350,
  "edited_at": "2026-11-20T10:00:00.000Z",
  "steps": [
    {
      "kind": "adjust",
      "auto": true,
      "exposure": 12,
      "contrast": 0,
      "saturation": 8,
      "warmth": 0,
      "sharpness": 20,
      "levels": { "black": 14, "white": 231 },
      "balance": [1.04, 1, 0.95]
    },
    { "kind": "crop", "aspect": "4:5", "smart": true, "box": { "x": 310, "y": 0, "width": 2400, "height": 3000 } }
  ]
}
```

Con IA:

```json
{
  "type": "ai_edit",
  "operation": "remove_background",
  "source_asset_id": "…",
  "generation_id": "…",
  "provider": "comfyui",
  "model": "birefnet-general",
  "purpose": "photo.remove_background",
  "data_region": "unknown",
  "trains_on_inputs": "no",
  "untested_adapter": true
}
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

| Opción                                                     | Licencia (a contrastar en la ficha del modelo antes de usar)          | Calidad esperada en fotos de producto o plato                           | CPU (orden de magnitud, sin medir)                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| BiRefNet (general o _lite_) en ONNX con `onnxruntime-node` | MIT (modelo), MIT (onnxruntime)                                       | La mejor de las abiertas, bordes finos                                  | Varios segundos por foto a 1024 px con 2–4 vCPU; 1,5–2 GB de RAM |
| IS-Net (DIS, `isnet-general-use`) en ONNX                  | Apache-2.0                                                            | Buena; algo peor en pelo y bordes finos                                 | 1–3 s por foto; ~1 GB de RAM                                     |
| U²-Net / U²-Netp                                           | Apache-2.0                                                            | Aceptable en objetos con fondo liso; flojo en bordes (máscara a 320 px) | < 1 s; U²-Netp pesa 4,7 MB                                       |
| `@imgly/background-removal-node`                           | **AGPL-3.0**: obligaría a publicar el código del servicio. Descartada | —                                                                       | —                                                                |
| RMBG-1.4 / RMBG-2.0 de BRIA                                | **No comercial** sin contrato. Descartada                             | —                                                                       | —                                                                |

Recomendación si el dueño lo quiere: trabajo nuevo `media.image.remove_background`
en el trabajador con `onnxruntime-node` y **BiRefNet lite** (o IS-Net si la
máquina es pequeña), pesos copiados en la imagen Docker del trabajador (no
descargados al vuelo), salida PNG con alfa a la carpeta «Ediciones» con
procedencia `media_job`. Coste por foto: solo CPU del trabajador (sin cupo de
IA, pero sí de almacenamiento). Encaja con el alojamiento propuesto (Fly.io en
Fráncfort, datos en la UE). Pendiente: el «sí» a descargar los pesos, medir
tiempo y calidad con 20–30 fotos reales de la marca, y el tamaño de máquina.

## 7. Quitar el fondo en el navegador (sin IA, sin coste)

Rama `f7/recorte-navegador`. Mismo enfoque que el panel del restaurante
(un modelo en un Web Worker con `onnxruntime-web`), genérico y sin nada de
ningún cliente. Código en `src/features/photo-edit/cutout/`.

### Motores: BEN2 (principal) e IS-Net (respaldo) — rama `f17/recorte-ben2`, 21/11/2026

Decisión del dueño tras comparar 12 fotos reales (botellas, cócteles, platos):
el recorte pasa a **BEN2 base fp16**, con el IS-Net de antes como respaldo.

| | BEN2 (principal) | IS-Net (respaldo) |
| --- | --- | --- |
| Modelo | `onnx-community/BEN2-ONNX`, `onnx/model_fp16.onnx` | IS-Net «general use» cuantizado a uint8 (`public/models/isnet-general-use-u8.onnx`, alojado en este despliegue) |
| Peso | 219 121 675 bytes (**219 MB**) | 46 731 330 bytes (**45 MB**) |
| Licencia | **MIT** (ficha del modelo); `onnxruntime-web` MIT | MIT (ficha) / Apache-2.0 (DIS) |
| Entrada y salida | `pixel_values` 1×3×1024×1024, normalización ImageNet · `alphas` 1×1×1024×1024 ya entre 0 y 1 | `input` 1×3×1024×1024 (÷ máximo − 0,5, promediando el área al encoger) · salida en cualquier rango (se normaliza) |
| Dónde corre | **Solo WebGPU** | WebGPU o, si no, WASM (CPU) |
| Calidad que se dice | Alta | «Calidad básica» |
| Dirección | `VITE_CUTOUT_BEN2_URL` o Hugging Face | `/models/isnet-general-use-u8.onnx` (mismo origen) o `VITE_CUTOUT_MODEL_URL` |

- **Por qué solo WebGPU.** En CPU nativa BEN2 pide ~4,6 GB de memoria; en WASM de
  32 bits (el de los navegadores, máximo 4 GB) no cabe. Con WebGPU los pesos van a
  la tarjeta gráfica. Por eso, sin WebGPU, el motor es IS-Net.
- **Cómo se elige** (`cutout/select.ts`, `engine.ts`): BEN2 si el navegador tiene
  `navigator.gpu` **y** un adaptador que responde (`requestAdapter()`), la memoria
  que declara el navegador (`deviceMemory`) es de 4 GB o más (o no la declara) y
  BEN2 no ha fallado ya en esta sesión. En cualquier otro caso, IS-Net.
- **Caída al respaldo.** Si con BEN2 falla la sesión (operadores sin soporte,
  sin memoria de GPU, máscara vacía o NaN), `engine.ts` repite con IS-Net sin
  romper, termina el worker (suelta la GPU) y **recuerda el fallo hasta recargar
  la página**. Un corte de red al descargar BEN2 usa IS-Net solo esa vez (no dice
  nada de BEN2). Si no hay sujeto (`NoSubjectError`) o se cancela, no hay caída.
- **Descarga.** Misma mecánica que IS-Net (`cutout/download.ts`): CORS comprobado
  el 21/11/2026 contra `huggingface.co/onnx-community/BEN2-ONNX` (redirige a su
  CDN, que responde `access-control-allow-origin: *`), sin clave, con progreso
  («Descargando el modelo de recorte (219 MB, solo la primera vez)…» y MB
  recibidos), guardado en Cache Storage (`rrss-cutout-model-v1`, por dirección) y
  **cancelable** (botón «Cancelar»; también al cerrar el diálogo): cancelar
  termina el worker, que corta la descarga o la inferencia en marcha. Con la
  longitud conocida se escribe en un único buffer (sin duplicar 219 MB). **El
  modelo no está en el repositorio.**
- **Escala.** La foto se encaja (deformándola) a 1024×1024 **promediando el área**
  al encogerla (`resizeAreaChannel`, como `INTER_AREA`; interpola al agrandar), se
  divide entre 255 y se normaliza con la media y desviación de ImageNet. La
  máscara de 1024×1024 se reescala al tamaño de la foto con el mismo
  remuestreo. Con BEN2 el alfa **se usa tal cual** (sin normalizar entre
  mínimo y máximo y sin la curva que endurece la máscara de IS-Net): conserva
  los medios tonos de los bordes. No lleva sombra conservada, matting por trimap
  ni filtro guiado (empeoraban o no aportaban, según la comparativa).
- **Procedencia.** El paso `remove_background` guarda `model`: `ben2-base-fp16` o
  `isnet-general-use` (el resultado sabe con qué motor se hizo).
- **Interfaz.** Si se usó el respaldo, bajo el recorte sale «Calidad básica: este
  navegador no tiene aceleración gráfica (WebGPU) suficiente…». El texto previo a
  descargar dice «de 85 a 220 MB según tu navegador».
- **Medido** (21/11/2026, esta máquina, sin GPU utilizable):
  - BEN2 fp16 en CPU nativa con `onnxruntime-node` 1.22: ≈ 7,0–7,4 s por foto
    de ~1,5 MP (la comparativa en Python midió ≈ 9,7 s de mediana y 4,6 GB de
    memoria máxima). IS-Net: ≈ 1,2 s y 1,9 GB.
  - Preprocesado TS ≈ 50–70 ms y postprocesado ≈ 35–40 ms por foto.
  - **Paridad con la referencia de la comparativa** (preproceso/postproceso en
    TypeScript + `onnxruntime-node` frente a las máscaras de `run_engine.py`,
    4 fotos: botella de cristal, cecina, coulant, pulpo): IoU de la máscara
    (alfa > 127) **0,9998–1,0000**, error medio del alfa 0,007–0,019 sobre 255.
  - Navegador real (Chromium de Playwright, WASM de 1 hilo, sin WebGPU):
    IS-Net ≈ 8–9,4 s por foto de 1479×1183 (carga incluida la primera vez); BEN2
    no se elige, y forzando la elección (adaptador falso) se descarga y cae a
    IS-Net sin romper, sin reintentar BEN2 en la segunda foto.
- **Sin probar:** BEN2 con **WebGPU real** en un navegador (ni esta máquina ni su
  Chromium ofrecen adaptador WebGPU): operadores de BEN2 en el proveedor `webgpu`
  de onnxruntime-web 1.30, uso de memoria de GPU, tiempos con tarjeta gráfica y
  tamaño máximo de buffer en tarjetas integradas. Hasta probarlo en un equipo con
  GPU, la caída a IS-Net es la red de seguridad. Tampoco probada la variante de
  768 px (`square-zero-labs/BEN2-ONNX`, 208 MB), que sería la opción si la memoria
  de GPU se queda corta.
- **Reproducir la paridad:** instalar `onnxruntime-node` fuera del repositorio
  (`npm i onnxruntime-node` en una carpeta aparte), descargar `model_fp16.onnx` y
  ejecutar con `vite-node` un script que llame a `toBen2Input`, `ben2Mask` y
  `applyMask(…, 'none')` de `cutout/mask.ts` y compare con la máscara de
  referencia.

### Por qué salía mal el recorte sin WebGPU, y cómo se arregla — rama `f18/recorte-refinado`, 22/11/2026

El dueño vio (22/11/2026, Chrome sin WebGPU, así que IS-Net) un chuletón en
bandeja con la bandeja cortada en diagonal por la derecha, bordes sucios a la
izquierda y trozos del plato perdidos, mientras que en el panel del restaurante
el mismo tipo de recorte sale bien, también en el móvil. Se comparó línea a línea
con el panel (`admin-casatomas`, solo lectura).

**Causa.** El modelo es el mismo; lo que cambiaba era lo de alrededor:

| | rrss antes | panel del restaurante |
| --- | --- | --- |
| Entrada del modelo | encoge con interpolación bilinear de 2×2 vecinos (salta la mayoría de los píxeles en una foto de 12 MP: ruido y bordes sucios) | el lienzo del navegador promedia al encoger |
| Máscara → alfa | escala la máscara de 1024² y le pasa una curva | limpia motas, islas y **agujeros** de la máscara; **filtro guiado** con la luminancia de la propia foto a resolución completa (pega el borde al borde real); curva suave |
| Modelo | fp16 de 84 MB desde Hugging Face | uint8 de 45 MB alojado en el propio despliegue (IoU 0,9997–0,9999 con el original) |
| Si el navegador no puede | nada (el botón no sale) | se manda a un servidor (Vercel) que devuelve la máscara |

Medido en esta máquina con las 12 fotos de la comparativa: la diferencia entre
fp16 y uint8 es de IoU 0,999 (no es el modelo) y el navegador real (WASM) da lo
mismo que Node (IoU 0,99999). Con la **misma máscara cruda**, la limpieza y el
guiado rellenan el agujero que se abría dentro del plato del chuletón y
recomponen el borde de la bandeja. Lo que **no** se ha podido reproducir: el
fallo exacto de la captura del dueño, porque no se tiene su foto; en las 12
fotos de prueba (de 1152×1536 a 1479×1183, ya reducidas) el defecto es menor que
en su captura, y el efecto de una foto grande (12 MP del móvil) se probó solo con
una copia sintética con ruido (sin diferencia llamativa). La hoja comparativa
(original | antes | ahora | panel) está en
`rrss-recursos-comparativa/recorte-respaldo.jpg`, fuera del repositorio. Con el
plato blanco del coulant sobre mantel claro, IS-Net pierde el plato en las tres
versiones (también en el panel): es un límite del modelo; BEN2 sí lo recorta.

**Qué se ha portado** (`cutout/refine.ts`, sin DOM y con una sola importación con
extensión `.js`, porque el servidor lo carga en Node):

- `isnetInput`: entrada con promedio de área (antes, bilinear).
- `cleanMask`: motas, islas lejanas y agujeros (áreas relativas; una pata o una
  antena unida al cuerpo se conserva; un hueco grande de verdad se conserva).
- Filtro guiado «rápido»: coeficientes a ≤ 1600 px y alfa a resolución completa.
- IS-Net: limpieza + guiado + curva (`applyMask(…, 'refined')`). **BEN2: solo la
  limpieza** (`'clean'`): su alfa ya es fino y el guiado endurecería los medios
  tonos. En las 12 fotos la limpieza cambia unos pocos píxeles (de 1 a 13 por
  foto; 335 en la copia sintética de 12 MP): es una red de seguridad que no
  empeora nada medible. No se probó el guiado sobre BEN2 con una referencia real,
  solo se descartó por criterio.
- Modelo uint8 alojado en `public/models/` (`/models/isnet-general-use-u8.onnx`,
  46 731 330 bytes; es el fichero del panel, derivado del IS-Net de DIS,
  Apache-2.0). La caché del navegador pasa a `rrss-cutout-model-v2`. El texto
  previo dice «de 45 a 220 MB». El cálculo de BEN2 sigue en el hilo principal
  (35–40 ms); el refinado de IS-Net también (≈ 0,2–0,5 s en una foto de 1,5 MP).

**Cadena de motores** (`cutout/remover.ts`):

1. Navegador con WebGPU y memoria → **BEN2** (calidad alta).
2. Navegador sin WebGPU → **IS-Net** con el refinado nuevo (calidad básica).
3. *(Sustituido en `f21`, ver «Quitar el fondo en el servidor, con el trabajador de medios»: ahora el servidor es el
   trabajo `media.cutout` con BEN2, y esta función queda apagada por defecto.)* **Servidor** (`api/cutout-mask.ts`, el mismo IS-Net y el mismo refinado) si: el
   navegador no puede (sin WebAssembly, menos de 2 GB), o falla (modelo, memoria,
   red del modelo), o el dispositivo declara menos de 4 GB (se prueba primero el
   servidor y, si falla, el navegador). Tras quedarse sin memoria, las fotos
   siguientes van directas al servidor hasta recargar. Hace falta la marca (la
   pasan el diálogo «Editar foto» y las ediciones rápidas).
4. «Nada que recortar» y cancelar cortan la cadena.

El botón «Quitar el fondo» sale si el navegador puede **o** hay servidor
(`VITE_CUTOUT_SERVER_URL`; **desde `f21` sin definir = apagada** y `off` también; antes, por
defecto `/api/cutout-mask` en la compilación de producción).

**Servidor.**

- `POST /api/cutout-mask` (`api/cutout-mask.ts`, `api/_lib/cutout/`): cuerpo =
  foto JPEG/PNG/WebP (el navegador la manda reducida a ≤ 1600 px y ≤ 3,5 MB; la
  función rechaza > 4 MB), `Authorization: Bearer <JWT>` y `X-Brand-Id`. Devuelve
  un PNG gris de 1 canal con la máscara al tamaño de la foto. Errores: 400, 401,
  403, 413, 415, 422, 429, 500 y 503 (ver la cabecera del archivo).
- **Autorización:** el JWT se valida contra Auth y, con ese mismo JWT (nunca la
  clave de servicio), se llama a `cutout_reserve(marca)`: exige poder **editar**
  esa marca (la foto es de una marca suya) y mira los topes. Migración
  `20261213120000_cutout_server_usage.sql` (tabla `cutout_usage` con RLS: la ve
  quien gestiona la marca y no se escribe a mano; vuelta atrás en
  `supabase/rollbacks/`): **60 recortes por persona y día** y **600 por marca y
  mes** (constantes de la función; cambiarlos es otra migración). Al acabar,
  `cutout_finish` anota la duración real. La migración **no está aplicada** en
  ningún Supabase remoto. Limitación: la función comprueba que la persona puede
  editar la marca que declara, no que los bytes de la foto estén en esa marca
  (la foto que se recorta puede ser una versión sin guardar).
- `GET /api/cutout-mask`: diagnóstico sin sesión (¿están el modelo,
  onnxruntime-node y sharp?).
- **Ficheros:** `vercel.json` incluye el modelo y el binario de linux-x64 de
  `onnxruntime-node` y excluye los de Windows, macOS y arm64; la reescritura a
  `index.html` ya no se come `/api/`. Dependencias nuevas: `onnxruntime-node`
  1.30.0 y `sharp` 0.34.5; `.npmrc` con `onnxruntime-node-install=skip` (evita
  bajar los binarios de CUDA).
- **Viabilidad en Vercel (por la documentación y lo medido en local; sin
  desplegar):** paquete de la función ≈ modelo 45 MB + onnxruntime-node linux-x64
  45 MB + sharp con libvips ≈ 25 MB ≈ **115 MB frente al límite de 250 MB**;
  memoria **≈ 290 MB** medidos con una foto de 1152×1536 (el plan Hobby da 2 GB);
  tiempo **≈ 2,1 s por foto** en esta CPU de escritorio con 2 hilos (decodificar
  0,08 s, inferencia 1,9 s, refinado 0,2 s), con `maxDuration` de 60 s; cuerpo
  ≤ 4,5 MB (se limita a 4) y respuesta de ~40 KB. **Sin medir:** el arranque en
  frío y la velocidad de la CPU de Vercel (puede ser 2–3 veces más lenta), y que
  el despliegue incluya los binarios (comprobarlo tras el primer despliegue con el
  GET de diagnóstico). El plan Hobby de Vercel da 4 h de CPU activa al mes **para
  todo el equipo `casa-tomas`** y es solo para uso no comercial: con el tope de
  600 recortes al mes por marca y ~2–6 s cada uno, son hasta 1–1,5 h por marca;
  si el SaaS se vende, hace falta el plan Pro.
- **Mismo resultado que en el navegador (medido):** máscara del servidor frente
  a la del navegador con el mismo código, 2 fotos: IoU 1,000 y error medio del
  alfa < 0,0001 sobre 255.
- **Pruebas:** `cutout/refine.test.ts` (limpieza, guiado, entrada),
  `cutout/chain.test.ts` (cadena de caídas, cliente del servidor y la función:
  autorización, límites), `tests/db/recorte-servidor.test.ts` (permisos, topes,
  tabla).

El resto de esta sección describe IS-Net, que sigue siendo el respaldo.

- **Modelo (hasta `f18`; ahora es el uint8 alojado, ver arriba):** IS-Net «general use» (DIS), ONNX con pesos en float16 y entrada y
  salida en float32, de `imgly/isnet-general-onnx` en Hugging Face
  (`onnx/model_fp16.onnx`). **88 152 708 bytes (≈ 84 MiB)**. Licencia: el
  modelo declara **MIT** (ficha de Hugging Face) y la arquitectura y los pesos
  originales de IS-Net/DIS son **Apache-2.0** (permiten uso comercial y
  redistribución). `onnxruntime-web` es MIT. Cautelas: la ficha de ese
  repositorio es de una línea (sin detalle de los datos de entrenamiento, DIS5K)
  y existe otra conversión (`onnx-community/ISNet-ONNX`) etiquetada AGPL-3.0, que
  **no se usa**; antes de un contrato con un cliente grande conviene que lo
  revise quien lleve lo legal. `@imgly/background-removal` (AGPL) y RMBG de BRIA
  (no comercial) siguen descartados (§5).
- **De dónde se descarga:** en tiempo de ejecución, desde el navegador de quien
  edita, a la URL de `VITE_CUTOUT_MODEL_URL` o, si no está definida, a la de
  Hugging Face (CORS abierto, sin clave). **No está en el repositorio** ni lo
  sirve nuestro despliegue. Para alojarlo en el propio despliegue (más fiable y
  sin depender de Hugging Face): copiar el `.onnx` a `public/models/` y poner
  `VITE_CUTOUT_MODEL_URL=/models/<archivo>.onnx` (sirve también la versión
  cuantizada a uint8 de 46,7 MB del panel, mismas entradas y salidas). Con BEN2
  igual: `VITE_CUTOUT_BEN2_URL=/models/<archivo>.onnx` (el servidor debe dar
  `Content-Length` y CORS). Cambiar de modelo = cambiar `CUTOUT_MODEL_CACHE` en
  `cutout/model.ts`.
- **Caché:** la primera vez se baja entero (con progreso) y se guarda en Cache
  Storage (`rrss-cutout-model-v1`); después se lee de ahí sin red. Si el
  navegador no deja guardar, funciona igual y vuelve a descargar. El motor de
  onnxruntime (WASM, ≈ 27 MB) se carga dentro del worker solo al usarlo: no
  entra en el paquete inicial. El worker se termina tras 60 s sin uso.
- **Flujo:** Editar foto → Fondo → «Quitar el fondo» (progreso: descargando el
  modelo con MB, preparando, quitando el fondo) → fondo liso, color de la marca
  o imagen de la biblioteca (mármol, mantel…), sombra suave opcional (la
  silueta desplazada abajo y desenfocada, opacidad máxima 35 %), vista previa →
  guardar. La foto no sale del navegador. Resultado: recurso nuevo con
  `photo_edit` y pasos `remove_background` (`engine`, `model`) y `background`
  (`color` o `asset_id`, `shadow`); el original no se toca. Sin migración ni
  cambios en el servidor.
- **Cuando el navegador no puede:** sin `Worker` o `WebAssembly`, o con menos de
  2 GB de memoria (`navigator.deviceMemory`), el diálogo lo dice y no ofrece el
  botón (si hay IA en el servidor, queda esa). Fallos al recortar (sin red,
  memoria, sin WebGPU ni WASM, nada que recortar) se explican en claro y se puede
  reintentar. WebGPU que falle o dé una máscara vacía se repite en WASM.
- **Calidad de la máscara (IS-Net) — texto anterior a `f18`, ya NO vale: desde `f18` lleva limpieza y filtro guiado (ver arriba).** Antes: el alfa salía de la máscara del modelo escalada y una curva suave; **no** llevaba el filtro guiado del
  panel (que conserva mejor antenas, patas y cristal fino). Para platos y
  productos basta; si hiciera falta más, es el siguiente paso.
- **Rendimiento (medido solo en CPU de Node, no en un navegador):** el modelo
  float16 se carga y ejecuta bien con `onnxruntime-node` (entrada y salida
  float32 de 1×3×1024×1024 y 1×1×1024×1024; ≈ 1,4 s en CPU de escritorio).
  En navegador con WASM de 1 hilo se espera bastante más (el panel midió
  13–19 s con el modelo uint8); con WebGPU, 1–2 s. **Sin medir en navegador.**
- **Cabeceras COOP/COEP: no se activan, a propósito.** Solo darían hilos en
  WASM (`SharedArrayBuffer`). `Cross-Origin-Embedder-Policy: require-corp`
  bloquearía las fotos de Storage, R2, Drive y las miniaturas de redes (no
  mandan `Cross-Origin-Resource-Policy`), el modelo alojado fuera y las ventanas
  de OAuth (COOP). `vercel.json` queda como estaba y el worker usa 1 hilo
  (`numThreads = 1` salvo que la página ya esté aislada).
- **Para las pruebas e2e:** `VITE_CUTOUT_SIMULATED=true` (solo en
  `playwright.config.ts`) cambia únicamente lo que devuelve el worker por una
  máscara elíptica; el resto del camino es real. Sin esa variable no existe esa
  rama en el paquete de producción.

### Quitar el fondo en el servidor, con el trabajador de medios — rama `f21/cutout-fly`, 22/11/2026

Decisión del dueño: probar BEN2 en el servidor con la máquina de Fly que ya existe
(trabajador de medios, Node + FFmpeg), en vez de la función de Vercel de `f18`.

**Qué hay.**

- **Trabajo `media.cutout`** (`worker/src/handlers/cutout.ts`): foto de la biblioteca → PNG con
  alfa en la carpeta «Ediciones» de la marca. Lee la foto con `sharp` (EXIF aplicado, como mucho
  4096 px de lado), prepara la entrada de BEN2 (1×3×1024×1024, ImageNet), ejecuta **BEN2 base
  fp16** con `onnxruntime-node` (CPU, **2 hilos, arena de memoria desactivada**), limpia la
  máscara (motas, islas, agujeros) y escribe el PNG. La **sesión del modelo se abre al empezar
  cada trabajo y se libera al terminar**, también si falla; la máquina se apaga al vaciar la cola.
- **Mismo código que el navegador, sin duplicarlo a mano.** El preprocesado y el postprocesado
  (`toBen2Input`, `ben2Mask`, `applyMask` con `cleanMask`, `resample`) son los de
  `src/features/photo-edit/cutout/`. La imagen Docker solo lleva `worker/` y Node exige `.ts` en
  las importaciones, así que se **copian** a `worker/src/cutout/shared/` con
  `npm run sync:cutout` (en `worker/`), que reescribe las importaciones. Una prueba
  (`worker/tests/cutout.test.ts`) falla si la copia se queda desfasada. Es la única duplicación
  (copia generada, no escrita a mano).
- **Modelo dentro de la imagen Docker**, no en el primer uso: la máquina se apaga al vaciar la
  cola y su disco no persiste, así que «en el primer uso» sería bajar 219 MB en cada arranque
  (más la dependencia de Hugging Face en cada trabajo). El `Dockerfile` lo baja en el *build*
  con `ADD --checksum=sha256:dfdc25f4…cedf1` y la revisión del repositorio fijada
  (`c552aa82…`): si el archivo cambia, el build falla. El sha256 coincide con el `lfs.oid` que
  publica Hugging Face y con la copia de las pruebas (219 121 675 bytes). Coste: imagen ~220 MB
  más grande, que no se paga con la máquina parada más allá del disco (~0,03 $/mes).
- **Imagen de Debian en vez de Alpine.** `onnxruntime-node` solo trae binarios para glibc; en
  musl no carga. La base pasa a `node:22-trixie-slim` (FFmpeg 7.1 de Debian en lugar del de
  Alpine). **No se ha construido ni probado esa imagen** (ver «Sin probar»).
- **Base de datos** (migración `20261214010000_media_cutout.sql`, con vuelta atrás): `request_media_job`
  admite `media.cutout`; el cliente solo manda `{source: {path}}` (la ruta tiene que ser un
  recurso de la marca, JPEG/PNG/WebP) y la base **fija** la salida
  (`<org>/<marca>/ediciones/<uuid>.png`), el modelo (`ben2-base-fp16`) y el motor (`servidor`);
  el disparador de `jobs` da de alta el PNG (`origin generated`, carpeta «Ediciones», etiqueta
  «edición») con procedencia `media_job` `{kind, job_id, source_asset_id, model, engine, sources}`;
  `cancel_media_job` y el tope de trabajos por marca (5) lo incluyen. `is_media_worker_kind`
  y `worker-gateway` ya cubrían `media.%`: no se tocan.
- **Panel** (`cutout/remover.ts`, `cutout/serverJob.ts`). Cadena nueva:
  1. **Navegador con BEN2** si hay WebGPU, adaptador y memoria.
  2. **Servidor** (trabajo `media.cutout`) si `VITE_MEDIA_WORKER_ENABLED=true`, hay marca y la
     foto es de la biblioteca (JPEG, PNG o WebP). Sondea cada 2 s, plazo de 3 min, se cancela
     (`cancel_media_job`). Texto: «Quitando el fondo en el servidor… (suele tardar menos de un
     minuto)». Calidad alta (BEN2).
  3. **Función de Vercel** `api/cutout-mask` (`f18`): **APAGADA por defecto.** Ahora sin
     `VITE_CUTOUT_SERVER_URL` significa apagada (antes, en producción, `/api/cutout-mask`);
     `off` también la apaga. Para volver a encenderla: `VITE_CUTOUT_SERVER_URL=/api/cutout-mask`.
     No se ha borrado.
  4. **IS-Net refinado en el navegador**, último recurso («calidad básica»).

  «Nada que recortar» y cancelar cortan la cadena. El botón sale si el navegador puede **o** hay
  trabajador o función de Vercel.
- **Qué queda en la biblioteca.** El PNG que deja el trabajo es un recurso propio (carpeta
  «Ediciones», listado entre las ediciones de la foto). El panel baja ese PNG, **solo usa su
  alfa** y lo pone sobre los píxeles que ya tiene; si luego se guarda otra edición (fondo
  nuevo…), esa es otra copia. **Desde `f31`** ese PNG intermedio se borra en cuanto se lee su alfa (solo si sigue siendo el
  archivo de ese trabajo: procedencia `media_job` con su `job_id`, carpeta «Ediciones» y nombre «Sin fondo · …»;
  si alguien lo renombró o movió, se queda) y la biblioteca se refresca sola.

**Medido** (22/11/2026, Windows, procesador de escritorio, `onnxruntime-node` 1.30.0, 2 hilos,
arena desactivada, `worker/scripts/bench-cutout.ts`: manejador completo, un proceso por foto):

| Foto | Medidas salida | Total | Modelo (inferencia) | Carga de la sesión | Preparar + postprocesar + PNG | Pico de memoria (RSS) |
| --- | --- | --- | --- | --- | --- | --- |
| `coulant-postre` | 1351×1123 | 18,2 s | 15,8 s | 2,0 s | 0,34 s | 2211 MB |
| `chuleton-cocina` | 1152×1536 | 17,2 s | 15,4 s | 1,4 s | 0,37 s | 2201 MB |
| `botella-gin-cristal` | 1152×1536 | 17,1 s | 15,3 s | 1,4 s | 0,39 s | 2189 MB |
| 12 MP sintética (4032×3024) | 4032×3024 | 18,1 s | 15,4 s | 1,4 s | 1,2 s | 2291 MB |

El modelo manda: ~15,5 s y ~2,2 GB, con casi nada de diferencia entre una foto de 1,5 MP y una
de 12 MP (el modelo siempre trabaja a 1024×1024; la foto grande solo suma ~0,8 s y ~100 MB). El
PNG de 12 MP pesa 21,8 MB (el tope de subida es 50 MB). Con la máquina de Fly esperar unos
**+10 s de arranque** y que `shared-cpu-2x` sea más lenta que un procesador de escritorio
(*estimación*: 20–35 s por foto). **La cifra de Fly no está medida**: hay que medirla tras desplegar.
Con **2 GB la máquina se queda sin memoria** (pico 2,2–2,3 GB + el sistema): por eso
`fly.toml` pasa a **4 GB**. `coulant-postre` conserva el plato blanco (62 % de la foto queda opaco).

**Sin probar:** la imagen Docker (Debian, descarga del modelo con `--checksum`, `sharp` y
`onnxruntime-node` en glibc) no se ha construido en esta sesión; el trabajo completo en Fly
(tiempo real, memoria real, arranque desde parada, `swap`); el panel contra el trabajador real
(las pruebas usan dobles y el cliente de Supabase simulado); la prueba e2e (el recorte en e2e va
simulado en el navegador y no pasa por esta cadena).

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

Quitar el fondo en el navegador (§7):

- Unitarias (`cutout/engine.test.ts`, motores): preprocesado de BEN2 (ImageNet,
  transparencia sobre blanco, promedio de área), postprocesado (alfa tal cual,
  sin sujeto), elección de motor (WebGPU, adaptador, memoria, fallo previo),
  caída a IS-Net con dobles (fallo → respaldo y recuerdo; corte de red → solo
  esa vez; sin sujeto y cancelar no caen) y progreso con el motor. Componentes:
  procedencia con BEN2, aviso de «calidad básica» y cancelar.
- Unitarias (`cutout/cutout.test.ts`): entrada y máscara del modelo, composición
  (color, imagen, tamaño, sombra debajo del sujeto y suave, opacidad), descarga
  con progreso y caché, errores de descarga y procedencia.
- Componentes (`editarFoto.test.tsx`): se ofrece sin IA; navegador sin soporte;
  progreso de descarga; guarda un recurso nuevo con sus dos pasos y el original
  no cambia; guardar solo el PNG transparente; error y reintento; con IA y
  navegador, el del navegador va por defecto. El recorte está simulado.
- e2e `tests/e2e/25-recorte-navegador.spec.ts` (máscara del worker simulada, lo
  demás real; comprueba que el original no cambia). **Escrita y sin ejecutar**
  (el Supabase local de esta máquina lo ocupaba otro proyecto). **Sin probar:**
  el modelo real en un navegador real (descarga, WebGPU, WASM, tiempos, calidad).

## 8. Cambiar el fondo con IA y mejorar con IA (OpenAI)

Dos acciones de `ai-media` (`photo.edit`) que se suman a quitar el fondo y
ampliar: **`replace_background`** («Cambiar el fondo con IA») y **`enhance`**
(«Mejorar luz y color con IA»). Hoy las hace el adaptador de OpenAI
(`docs/ia-medios.md`, §13); otro proveedor las ofrece si su adaptador declara
esas ediciones. Salen en el diálogo solo si el servidor tiene un modelo activo
y permitido para ellas (misma regla que «Ampliar»).

- **Dónde:** pestaña **«Fondo con IA»** de «Editar foto» (el mismo diálogo se
  abre desde la ficha de la biblioteca y desde el editor de piezas).
- **Cómo se usa:** un campo de texto («¿qué fondo quieres?», hasta 500
  caracteres) y sugerencias a un clic: mesa de mármol blanco con luz cálida,
  mantel de lino beige, mesa de madera rústica, pizarra oscura
  (`BACKGROUND_SUGGESTIONS` en `api.ts`). Se ve el coste máximo antes y si se
  procesa fuera de la UE. El botón no se activa sin texto.
- **Proteger el plato (dos capas).**
  1. **Máscara.** Si el navegador puede recortar (`cutoutSupport()`, §7), antes
     de llamar a `ai-media` se recorta el plato con el mismo IS-Net (mismo
     worker, misma caché del modelo y misma barra de progreso) y su alfa se
     convierte en la máscara. **Convenio** (el del adaptador de OpenAI, que
     manda el PNG tal cual como `mask`; OpenAI repinta lo transparente): PNG RGBA
     con las medidas **exactas de la foto original** (`asset.width × height`,
     aunque el recorte se hiciera sobre una versión reducida), **plato opaco
     (alfa 255), fondo transparente (alfa 0)**, sin grises (alfa ≥ 128 → 255).
     Código: `cutout/plate.ts` (`subjectMaskPixels`).
  2. **Garantía.** OpenAI documenta que la máscara es orientativa, así que al
     recibir el resultado el navegador lo descarga, vuelve a pegar el plato
     **original** encima (`restorePlate`: original y alfa escalados al tamaño del
     resultado, borde suavizado con un radio ≈ 0,4 % del lado menor) y guarda
     esa versión. Casilla **«Proteger el plato original»**, marcada por
     defecto; sin marcar, se manda la máscara igualmente pero el resultado de la
     IA se deja como llega.
  - **Qué se guarda.** Con protección, el recurso es **uno solo**: la versión
    con el plato pegado, con procedencia `photo_edit` (no `ai_edit`: la guarda de
    la base de datos solo deja al servidor escribir `ai_edit`) y un paso
    `ai_background` (`prompt`, `model` de la IA, `mask_model` del recorte,
    `plate_protected: true`). La copia sin proteger que ya creó `ai-media` se
    borra de la biblioteca (el coste de IA no se devuelve). Sin protección, el
    recurso es el de `ai-media` con su `ai_edit` y **sin** la marca (esa
    procedencia no se puede tocar desde el navegador).
  - **Si algo falla.** Recorte imposible (sin red para el modelo, memoria,
    nada que recortar): no se llama a la IA y se explica. Si el resultado de la
    IA llega con otra proporción (más del 3 %) o no se puede abrir o guardar, se
    deja el resultado de la IA y se avisa de que hay que revisar el plato.
  - **Sin recorte posible** (navegador sin WebAssembly o con poca memoria): se
    mantiene el aviso «No hay recorte del plato: la IA puede retocar también el
    plato», sin casilla ni máscara.
  - **Límite.** La recomposición se hace sobre la foto cargada (como mucho
    24 MP) y al tamaño del resultado de la IA (~1,5 MP). El plato sale con la
    resolución del resultado, no la de la foto original.
- **Interfaz «máscara del sujeto opcional» (para el integrador).**
  `PhotoEditScreen` sigue aceptando
  `getSubjectMask?: (asset) => Promise<Blob | null>` (mismo convenio: PNG con
  las medidas de la foto, plato opaco). Si se pasa, **sustituye** al recorte del
  navegador y, como no hay recorte propio, **no** se vuelve a pegar el plato ni
  sale la casilla. Sin ella (lo normal) se usa el recorte del navegador. El
  servidor comprueba que sea un PNG con las medidas de la foto (hasta 1 MB).
- **Resultado:** un recurso **nuevo** («Fondo nuevo · <original>.jpg»,
  carpeta «Ediciones», etiqueta «ia»), con procedencia `ai_edit`
  (`operation: replace_background`, `source_asset_id`, el encargo en `prompt`,
  proveedor, modelo, región y `untested_adapter`). El original no se toca.
- **Tamaño del resultado:** ~1,5 MP con la proporción de la foto (p. ej. una
  de 4000×3000 sale a 1456×1088). Para más resolución, «Ampliar» después.
- **Quitar el fondo** con OpenAI (PNG transparente) es la opción de menor
  prioridad: si hay un modelo propio (ComfyUI) activo, gana ese.
- **API:** `photo.estimate`/`photo.edit` con `operation`, `prompt` (obligatorio
  en `replace_background`, prohibido en las demás) y `subjectMask` (base64 de
  un PNG; en `photo.estimate` basta `maskPresent: true`). El cuerpo admite
  hasta 1,5 MB por esa máscara.

**Pruebas:** `tests/db/ia-openai-imagen.test.ts` (adaptador con `fetch`
simulado: multipart con foto y máscara, parseo, errores, coste, tamaños;
catálogo y precios; configuración y residencia; «Probar conexión»),
`tests/db/edicion-fotos.test.ts` (función con la edición simulada, máscara
inválida, procedencia con el encargo), `editarFoto.test.tsx` (flujo del
diálogo, con el recorte y la respuesta de la IA simulados: máscara enviada,
plato vuelto a pegar, casilla desmarcada y fallo de proporción),
`cutout/plate.test.ts` (convenio y medidas de la máscara, recomposición, borde
suave, proporción) y la e2e `tests/e2e/26-cambiar-fondo-ia.spec.ts`
(actualizada para el recorte simulado del worker y la procedencia
`photo_edit`/`ai_background`; **escrita, sin ejecutar**: el Supabase local de esta máquina lo usaba otro proyecto).
**Sin probar:** contra OpenAI real (ver `docs/ia-medios.md`, §13), el recorte real del plato en un navegador y el borde de la recomposición a ojo.

## 10. Ediciones sencillas dentro del editor (rama `f13/edicion-sencilla`, 21/11/2026)

Lo de «Editar foto» (secciones 1 a 9) crea siempre una **foto nueva** en la
biblioteca. Esto es distinto y complementario: ediciones **que se guardan en la
capa del diseño** (documento v5), sin tocar la foto ni crear archivos, que se
deshacen con Ctrl+Z, funcionan por página en los carruseles y salen igual en el
lienzo y al exportar.

### Qué hay y dónde

| Edición                                                                                     | Dónde                                                                         | Se guarda como                                                                                          | Con IA         |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| Brillo, contraste, saturación, temperatura, nitidez                                         | Panel «Diseño» de una capa de imagen → «Luz y color»                          | `adjust` de la capa                                                                                     | No             |
| Filtros rápidos (blanco y negro, sepia, vivo, cálido, frío, desvaído, dramático)            | «Luz y color» → «Filtros rápidos»                                             | `adjust.filter`                                                                                         | No             |
| Girar 90°, voltear ↔ ↕, enderezar (±45°)                                                    | «Girar y recortar»                                                            | `turn`, `flipX`, `flipY`, `straighten`                                                                  | No             |
| Recorte libre o por proporción (como la capa, 1:1, 4:5, 9:16, 16:9, 3:2)                    | «Recortar…» (ventana con marco arrastrable)                                   | `crop` (fracciones de la foto ya girada) y la caja de la capa toma la proporción del recorte sin crecer | No             |
| Fondo detrás de la foto: color, degradado o la misma foto desenfocada                       | «Fondo» → «Poner detrás de la foto»                                           | `backdrop`                                                                                              | No             |
| Sombra bajo la foto o el plato (sigue la silueta si hay transparencia)                      | «Fondo» → «Sombra»                                                            | `shadow`                                                                                                | No             |
| Quitar el fondo                                                                             | «Fondo» → «Quitar el fondo»                                                   | **foto nueva** (carpeta «Ediciones») y la capa pasa a usarla                                            | No (navegador) |
| Modo retrato (desenfocar solo el fondo, con vista previa) y retocar la selección con pincel | «Editar foto» → «Fondo» (acción rápida del panel: «Modo retrato…»; ver §13)    | **foto nueva**; la capa pasa a usarla                                                                   | No (navegador) |
| Cambiar el fondo con IA                                                                     | «Fondo» → «Cambiar el fondo con IA…» (abre «Editar foto» en su pestaña de IA) | foto nueva                                                                                              | **Sí**, OpenAI |
| Contorno, sombra y fondo del texto                                                          | Panel de un texto → «Efectos del texto»                                       | `outline`, `shadow`, `background`                                                                       | No             |
| Sombra de las formas                                                                        | Panel de una forma                                                            | `shadow`                                                                                                | No             |
| Figuras y pegatinas: triángulo, estrella, corazón, flecha, destello, globo de texto y línea | Barra «Añadir» → «Figuras…»                                                   | capa de forma con `shape` nuevo                                                                         | No             |

### Qué usa IA y qué no

- **Todo es del navegador, gratis y sin clave**, salvo un botón: «Cambiar el
  fondo con IA…». Sale **solo** si el despliegue tiene
  `VITE_AI_PHOTO_EDIT_ENABLED=true`, el servidor tiene un modelo para
  `replace_background` (OpenAI, sección 8) y la foto es de nuestro almacenamiento.
  Sin eso el botón no existe; no se simula nada. Reutiliza el diálogo y el cupo
  de la sección 8 tal cual.
- **Quitar el fondo** pasa por una única función, `photo-edit/cutout/remover.ts`
  (`removeBackground`: foto → foto con alfa). Hoy usa IS-Net (sección 7), cuyo
  resultado el dueño considera flojo; cambiar el motor solo exige tocar ese
  archivo y `engine.ts`, no el panel ni el diálogo «Editar foto».
- La carga de imágenes del lienzo usa ahora `src/lib/corsImage.ts` como la
  exportación (`canvas/imageStore.ts`): arregla «Imagen no disponible» al
  insertar desde el selector, causado por la copia en caché sin CORS.

### Cómo está hecho

- **Documento v5** (`content/document/schema.ts`): campos opcionales por capa.
  Un documento v4 se lee igual (`migrate.ts`, 4 → 5, que además quita lo que
  no debería traer). Una edición que no cambia nada (ajustes a 0, recorte
  entero, enderezado 0) no se guarda (`applyLayerPatch`).
- **Orden de aplicación** de una foto: girar 90° → voltear → enderezar (con la
  ampliación justa para no dejar esquinas) → recortar → luz y color. Todo en una
  sola pasada de lienzo + una de píxeles (`editor/imageEffects/prepare.ts`); la
  luz y el color son el mismo cálculo que «Mejorar» (`photo-edit/pixels.ts`).
  Girar o voltear después de recortar mueve el recorte con la foto
  (`imageEdit.ts`).
- **Mismo resultado en lienzo y exportación:** ambos usan `canvas/draw.ts`
  (dibujo de cada capa), `prepareBitmap` y `stickers.ts` (contornos de las
  figuras). Solo cambia el tamaño de la foto preparada (1280 px en el editor,
  2400 al exportar); con la nitidez, la diferencia es la propia de la
  resolución. Las sombras y desenfoques se escalan con el zoom y con la
  resolución de exportación.
- **Texto:** el contorno es el de Konva (su grosor es lo que se ve por fuera);
  el fondo del texto se dibuja ajustado a las líneas escritas, no a toda la caja.
- **Base de datos:** la tabla de plantillas de marca solo aceptaba documentos
  v3 y v4; la migración `20261211010000_templates_document_v5.sql` (con su
  vuelta atrás) añade la v5. Ningún campo nuevo referencia recursos, así que la
  comprobación de recursos de la marca no cambia. Prueba: `tests/db/edicion-sencilla.test.ts`.

### Límites conocidos

- Luz y color necesitan leer los píxeles: si el almacén no responde a CORS, la
  foto se ve sin esos ajustes y la exportación avisa (como ya hacía).
- El filtro «foto desenfocada» difumina la propia foto; para desenfocar el
  fondo **detrás del plato** hay que usar el «Modo retrato» de «Editar foto»
  (§13), que crea una foto nueva (necesita el recorte del navegador).
- Las figuras no cambian de forma al estirarlas: se deforman con la caja. La
  línea se dibuja horizontal en el centro de su caja; para inclinarla, gírala.
- No probado a mano en un navegador real en esta rama: solo pruebas de unidad,
  de componentes y de base de datos (el dibujo con Konva y el recorte arrastrando
  no se ejercitan en jsdom).

## 11. «Editar foto» a pantalla completa (rama `f15/editar-foto-pantalla`, 21/11/2026)

La ventana emergente (`PhotoEditDialog`) dejó la foto pequeña, con doble barra
de desplazamiento y controles cortados. Ahora «Editar foto» es una **pantalla
propia dentro de la página** (`photo-edit/PhotoEditScreen.tsx`), no un modal.

### Cómo se ve y se usa

- **Foto grande** a la izquierda (arriba en el móvil, a ~38 % del alto, siempre
  visible mientras se mueven los deslizadores) y **una columna de controles** a
  la derecha (debajo en el móvil) con las pestañas fijas. Solo se desplaza esa
  columna.
- **Barra superior:** «Volver» (también la tecla Esc; si hay cambios sin
  guardar pregunta antes de descartarlos), «Cancelar» (descarta lo que llevas
  en la pestaña) y el botón principal: **«Aplicar a la capa»** desde el editor,
  **«Guardar copia»** desde la biblioteca.
- **Ver la original:** mantener pulsado «Ver la original» (puntero o
  Espacio/Intro) enseña la foto de antes.
- Mientras está abierta, lo de debajo no recibe foco (`inert` sobre la raíz de
  la aplicación) y las teclas no llegan al editor (Ctrl+Z no toca el diseño).

### Desde el editor: aplicar, deshacer y volver a la original

1. **Aplicar a la capa** guarda la copia en «Ediciones» (la original no se toca)
   y, en la misma acción, cambia la capa para que use esa copia: el lienzo la
   enseña al momento y la pantalla se cierra. Un aviso ofrece «Deshacer».
2. **Deshacer / Rehacer** del editor (botones y Ctrl+Z / Ctrl+Mayús+Z)
   recorren el cambio como cualquier otro del diseño.
3. **«Volver a la foto original»** (panel de la capa, bajo «Editar foto») aparece
   si la foto de la capa es una edición: sigue la procedencia
   (`provenance.source_asset_id`, hasta 25 saltos, `useOriginalAsset`) hasta la
   primera foto que no sale de otra y que sigue en la biblioteca. Funciona en
   cualquier momento, aunque se hayan hecho otros cambios después, y también
   se deshace. La copia queda en «Ediciones»; la original no se borra nunca.

Desde la biblioteca se mantiene **guardar como copia nueva**, y tras guardar
sale «Guardado en la biblioteca: …» con **Deshacer** (borra esa copia recién
hecha, no la original) y «Abrir».

### Arreglos de paso

- La vista previa de «Fondo» enseña lo **elegido** (color de la marca, color
  liso, imagen de la biblioteca o «Dejarlo sin ssombra/transparente» sobre
  cuadrícula), no un fondo blanco fijo. Elegir ya no guarda: se guarda con el
  botón principal.
- «Mejorar automáticamente» es un interruptor: otro clic lo quita y devuelve lo
  que había. Al tocar un deslizador deja de contar como automático, y tras
  guardar una copia todo vuelve a cero (no se arrastra a la siguiente).
- Los ajustes se ven al momento: vista previa de 1000 px (antes 480) con los
  controles desacoplados de la repintada (`useDeferredValue`).
- «Recortes» elige **un** formato (antes marcaba tres y guardaba tres copias);
  para otro formato se repite. El recorte del fondo ya no se pierde al cambiar
  de pestaña.
- Sin cambios en el motor del recorte (`cutout/remover.ts`, `engine.ts`).

### Pruebas y límites

- `photo-edit/editarFoto.test.tsx`: ciclo editar → aplicar → deshacer →
  rehacer → volver a la original → deshacer; Ctrl+Z y Esc dentro de la pantalla;
  descartar con confirmación; mejora automática reversible y sin arrastre;
  vista previa del fondo con el color elegido; comparar; deshacer una copia de
  la biblioteca. Los E2E de Playwright (22, 25, 26) se ajustaron al botón
  principal pero **no se han ejecutado** en esta rama.
- **Esc** (`f31`): si el botón pulsado desaparece y el foco se pierde, la pantalla lo recupera y Esc cierra igualmente.
- **No probado a mano en un navegador real**: el dibujo del lienzo (tamaño de la
  foto, comparar, diseño en móvil a 375 px) solo está cubierto por pruebas de
  componentes en jsdom; queda por revisar con la aplicación abierta.
- «Según edita» no se ve en el lienzo: la capa solo puede apuntar a una foto
  guardada, así que el cambio llega al pulsar «Aplicar».

## 12. Pantalla del editor, exportación y atajos (rama `f16/editor-tanda2`, 21/11/2026)

- **Sin scroll de página.** El editor usa el «modo de trabajo» del menú (`layout/workspace.tsx`): la página mide justo la ventana, sin pie legal, y solo hacen scroll el panel derecho (o la hoja inferior en móvil). `npm run test:layout` lo vigila en cuatro tamaños (`tests/layout/editor-sin-scroll.spec.ts`).
- **Panel (reordenado en `f24/panel-editor`, 22/11/2026).** Mismas opciones, mejor agrupadas. Arriba, fija al desplazarse, la barra de la capa con iconos con nombre: Duplicar, Borrar, orden (al frente, subir, bajar, al fondo) y alinear con el lienzo. Debajo, lo más usado y abierto: foto = «Editar foto», «Filtros rápidos» (una fila que se desliza) y encaje; texto = contenido, tipografía, tamaño, grosor, alineación y color; forma = relleno y borde. Después, secciones plegadas con el valor de ahora en la cabecera (Luz y color, Girar y recortar, Parte de la foto que se ve, Fondo y sombra, Desenfoque; Interlineado y cursiva, Efectos del texto; Esquinas y sombra), «Transparencia y visibilidad» y, al final, lo técnico: Posición exacta y tamaño, Al cambiar de proporción y Nombre de la capa. Todas empiezan plegadas; el navegador recuerda cuáles abre cada persona (`localStorage`, clave `rrss.editor.secciones.v1`, con `try/catch`: sin almacenamiento todo sigue funcionando). `Section` (`controls.tsx`) lleva `id` y `summary`; los resúmenes están en `panels/panelSummary.ts`. Nueva acción `duplicate` del editor (copia desplazada, fuera del grupo, elegida).
- **Exportación = lienzo.** `tests/layout/exportar-pixeles.spec.ts` dibuja una escena con el lienzo (`Scene.snapshot`) y con `renderDocument` y compara los píxeles; con filtros, luz y color, recorte, giro, volteo, enderezado, fondos, sombras y contorno de texto la diferencia media es 0 en PNG y menor de 0,5 de 255 en JPEG. Una imagen que no carga detiene la exportación con un aviso que la nombra.
- **Atajos** del editor: Ctrl/Cmd+Z deshace, Ctrl+Mayús+Z o Ctrl+Y rehacen, Ctrl+S abre «Guardar versión», Supr borra, flechas mueven 1 px (Mayús, 10 px), Ctrl+G agrupa (con Mayús, desagrupa) y Esc suelta. Funcionan aunque el foco esté en la página (tras cerrar un diálogo); no actúan con un diálogo abierto ni escribiendo en un campo.
- **Banco de maquetación** (`layout.html`, `exportar.html`, `vite.layout.config.ts`, `playwright.layout.config.ts`): la aplicación real con el cliente de Supabase simulado de `src/test`, servida con Vite para pruebas en un navegador real sin Docker ni Supabase. Solo para pruebas, no entra en la compilación.

## 13. Modo retrato y retoque de la selección (rama `f22/modo-retrato`, 22/11/2026)

Petición del dueño: «que se pueda seleccionar el fondo para hacer modo retrato».
Antes, «Desenfocar el fondo y dejar el plato nítido» (panel de la capa) hacía una
foto nueva **sin vista previa** y con un difuminado plano de toda la foto, que
dejaba un halo del color del plato alrededor; y no había forma de corregir qué
era plato y qué fondo.

### Dónde está

«Editar foto» → pestaña **Fondo**. Tras «Quitar el fondo» (que no guarda nada)
salen, junto a los fondos de color:

- **Modo retrato: desenfocar solo el fondo.** Vista previa al momento con tres
  controles: _Intensidad del desenfoque_ (1–100), _Más borroso cuanto más lejos
  del plato_ (activado) y _Resaltar el plato_ (oscurece el fondo, hasta la mitad).
  La sombra suave no aplica en este modo.
- **Retocar la selección.** Pincel con dedo, lápiz o ratón: _Añadir al plato_ /
  _Quitar del plato_, _Tamaño del pincel_, _Deshacer el último trazo_, _Borrar los
  retoques_ y _Ver la selección como un velo de color_ (rosa sobre el plato; sin
  velo se ve el recorte sobre el ajedrez). Corrige la máscara **antes** de
  aplicar, así que vale igual para el modo retrato, para «Dejarlo sin fondo»
  (PNG transparente) y para los fondos de color o de imagen.
- La acción rápida del panel de la capa pasó a **«Modo retrato: desenfocar el
  fondo…»** y abre esta pantalla con el modo ya elegido (hay que hacer el
  recorte; el resto es igual que desde la biblioteca).

Se aplica como el resto: «Aplicar a la capa» desde el editor (Ctrl+Z, «Volver a
la foto original» siguen funcionando) o «Guardar copia» desde la biblioteca.
Procedencia: `remove_background` → (`retouch_selection`, con el nº de trazos, si
se retocó) → `portrait_blur` con `amount`, `progressive` y `dim`. Nombre del
archivo: «Modo retrato · plato.jpg».

### Cómo está hecho

- **La máscara** es el alfa del recorte (`remover.ts`: BEN2/IS-Net en el
  navegador o el servidor; esta rama no toca ni `remover.ts`, ni `engine.ts`, ni
  el trabajador, solo consume lo que devuelven). Los colores del plato y de lo
  añadido con el pincel son siempre los de la **foto original**, no los del
  recorte (un recorte del servidor puede traer los píxeles transparentes
  borrados). Si el recorte no tiene las medidas de la foto, o la foto ya venía sin
  fondo, no se ofrece retrato ni retoque.
- **El desenfoque** (`photo-edit/portrait/blur.ts`) evita el halo y se parece al
  de una lente:
  1. el alfa se **dilata** unos píxeles (el borde suave del recorte también lleva
     color del plato) y todo lo que toca al plato deja de contar como fondo;
  2. el difuminado es **normalizado** (promedia solo fondo y divide por el peso
     reunido): el hueco que deja el plato se **rellena** con el color del fondo
     de alrededor, y el plato no «sangra» en el fondo;
  3. lo brillante pesa más (apertura de la lente, luces del fondo que se abren);
  4. **progresivo**: cuatro niveles de desenfoque mezclados según la distancia al
     plato (más lejos, más borroso);
  5. «Resaltar el plato» oscurece el fondo;
  6. el plato se pega con su alfa a tamaño completo, con un suavizado de 1–3 px
     en el borde. Donde el alfa es 255 sale la foto sin tocar.
- **Mismo resultado en la vista previa y en el archivo.** El desenfoque (de baja
  frecuencia) se calcula siempre en una versión de 720 px de lado mayor y se
  amplía; el radio es una fracción del lado mayor, así que la foto de 12 MP y
  su vista previa (1000 px) dan lo mismo (prueba: la misma escena a 300 y a 900
  px, diferencia media bajo 4 niveles). El pegado final usa el alfa completo, de
  modo que el borde conserva todo su detalle. Al guardar, desde `f31`, el
  cálculo a tamaño completo (trazos del pincel + modo retrato) corre en un **worker**
  (`portrait/retouch.ts` y `retouch.worker.ts`; sin Workers, en el hilo principal). Medido
  en Node con 12 MP y 40 trazos: 2,4 s los trazos (ahora 1,1 s con el pincel optimizado) y
  1,3 s el retrato, que en el hilo principal dejaban la pantalla sin responder
  (`scripts/medir-guardado-retrato.ts`).
- **El pincel** (`portrait/brush.ts`) guarda los trazos en coordenadas 0–1 y radio
  como fracción del lado menor: se repintan igual en la vista previa y a tamaño
  completo. Añadir (máximo) y quitar (mínimo) son idempotentes, por eso pintar
  tramo a tramo da lo mismo que repetir el trazo. Borde suave (dureza 0,6).
  Los trazos viven con el recorte en la pantalla, así que no se pierden al
  cambiar de pestaña, y «Cancelar» los descarta con el recorte.
- Se retiró la edición rápida `blur_background` (y su deslizador del panel): el
  procedimiento nuevo es este. Las fotos ya guardadas con esa procedencia no
  cambian.
- `composition.ts` importa `resizeChannel` de `resample.ts` en lugar de
  `mask.ts` (mismo código; así el script de la hoja de ejemplo no arrastra el
  modelo).

### Pruebas y comprobación

- Unitarias (`portrait/portrait.test.ts`): el plato no cambia y el fondo sí; las
  entradas no se modifican; **sin halo** (un gaussiano plano deja más de 30
  niveles de rojo junto al plato, aquí ≤ 3); intensidad, progresivo y
  oscurecido; borde sin escalón; vista previa y archivo coinciden; el pincel
  (añadir, quitar, orden, a cualquier resolución, tramo a tramo, velo).
- Componentes (`editarFoto.test.tsx`): flujo de retrato con su procedencia,
  retoque con pincel (puntero), quitar, deshacer y borrar, retoque con fondo de
  color, velo, foto sin fondo sin estas opciones y la acción rápida del panel
  aplicada a la capa y deshecha con Ctrl+Z.
- Hoja de ejemplo: `scripts/hoja-modo-retrato.ts` con máscaras BEN2 →
  `rrss-recursos-comparativa/modo-retrato.jpg` (original | suave | fuerte).

### Límites

- El pincel se maneja con puntero y, desde `f31`, con teclado (Tab para entrar en la foto,
  flechas, Espacio o Intro para bajar y subir el lápiz, `[` `]`, `X`, Ctrl+Z, Esc).
- El suavizado del borde del plato es el del recorte más 1–3 px: un cabello muy
  fino que el recorte no haya sacado no se recupera con el desenfoque.
- No probado a mano en un navegador real con el modelo de recorte (solo jsdom y
  pruebas de unidad); la hoja de ejemplo sí usa el desenfoque real con máscaras
  BEN2 reales. No hay prueba de diseño a 375 px de esta pestaña (necesita el
  modelo).
