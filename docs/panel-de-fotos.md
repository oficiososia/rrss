# Panel de fotos (`PhotoPanel`)

Componente suelto para elegir material de la biblioteca sin salir de donde se está (editor de
piezas, editor de reels, marcos de foto…). Código: `src/features/library/PhotoPanel.tsx`.
**Estado:** implementado y probado como componente (`photoPanel.test.tsx`). Conectado al **editor
de piezas** (23/11/2026, pestaña «Fotos»): tocar una foto la pone en el diseño (en el hueco vacío de
la página, si lo hay) y arrastrarla al lienzo la suelta en un marco o como capa nueva
(`src/features/content/editor/assetDrag.ts` lee `PHOTO_DRAG_TYPE`). Al editor de reels, todavía no.

## Qué da

- Carpetas de primer nivel a un toque («Platos», «Local», «Vinos») con su contador.
- Buscador sin distinguir mayúsculas ni tildes («chuleton» encuentra «Chuletón ternera.jpg»), por
  nombre, etiqueta y carpeta.
- «Subir» dentro del propio panel (solo para quien puede editar la marca; va a la carpeta elegida).
- Miniaturas (usa `thumb_path`), cargadas por tandas de 60, que se pueden **elegir** o **arrastrar**.
- Oculta por defecto lo que genera la propia aplicación (exportaciones, «Sin fondo · …», fotos
  editadas, reels, informes) para que salgan primero las fotos buenas.

## API

```tsx
import { PhotoPanel, readPhotoDrag, isPhotoDrag } from '@/features/library/PhotoPanel';

<PhotoPanel
  onPick={(asset) => poner(asset)}               // clic, toque o Intro; recibe el MediaAssetRow entero
  onDragStart={(asset, event) => {}}              // opcional: al empezar a arrastrar
  kinds={['image']}                               // opcional, por defecto solo fotos; p. ej. ['image','logo'] o ['video']
  includeGenerated={false}                        // opcional: enseñar también lo generado por la aplicación
  allowUpload                                     // opcional, por defecto sí (solo se ve si puede editar)
  selectedId={capa.assetId}                       // opcional: marca la elegida
  className="h-full"                              // el panel ocupa el alto de su contenedor y hace scroll por dentro
/>
```

Debe montarse dentro de una marca (usa `useBrand`/`useOrg` y React Query).

### Soltar una foto en otro sitio

Al arrastrar, el panel deja en `dataTransfer` el tipo `PHOTO_DRAG_TYPE`
(`application/x-rrss-photo`) con `{ "assetId": "…", "fileName": "…" }`. Quien recibe el arrastre:

```tsx
<div
  onDragOver={(e) => isPhotoDrag(e) && e.preventDefault()}
  onDrop={(e) => {
    const photo = readPhotoDrag(e);          // null si no es una foto del panel
    if (photo) rellenarMarco(photo.assetId);
  }}
/>
```

`isPhotoDrag` se puede llamar durante el arrastre (solo mira los tipos); `readPhotoDrag`,
al soltar.

## Qué no hace

- No sabe qué hacer con la foto elegida: eso es de quien lo usa.
- No muestra la ficha completa del archivo (nombre, derechos, usos): para eso, la Biblioteca.
- Los vídeos solo salen con `kinds` que incluya `'video'`; el panel los pinta con un icono.
