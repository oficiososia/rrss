// Arrastrar una foto de la biblioteca al lienzo. Es el punto de enganche entre
// cualquier lista de fotos y el editor de piezas: quien ofrece la foto deja este
// dato en el arrastre y el lienzo lo lee al soltar. Si cae sobre un marco de
// foto, lo rellena; si no, se añade como capa nueva en ese punto.
//
// El tipo y la forma del dato son los del panel de fotos de la biblioteca
// (`PHOTO_DRAG_TYPE` y `{ assetId, fileName }` en `library/PhotoPanel.tsx`): así
// sus miniaturas se pueden soltar aquí sin que ninguno de los dos sepa del
// otro. Se repite la cadena en vez de importarla para no meter el panel entero
// en el trozo del lienzo; `marcos.test.tsx` comprueba que siguen siendo iguales.
// El ancho y el alto son opcionales: con ellos la foto entra con su proporción.

/** Tipo de dato del arrastre: el mismo que usa el panel de fotos de la biblioteca. */
export const ASSET_DRAG_TYPE = 'application/x-rrss-photo';

/** Lo mínimo de un recurso de la biblioteca para ponerlo en el diseño. */
export interface DraggedAsset {
  id: string;
  name: string;
  width?: number | null;
  height?: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Para `onDragStart` de una miniatura: `writeAssetDrag(event.dataTransfer, { id, name, width, height })`. */
export function writeAssetDrag(transfer: DataTransfer, asset: DraggedAsset): void {
  transfer.setData(
    ASSET_DRAG_TYPE,
    JSON.stringify({
      assetId: asset.id,
      fileName: asset.name,
      width: asset.width ?? null,
      height: asset.height ?? null,
    }),
  );
  transfer.effectAllowed = 'copy';
}

/** ¿Lleva el arrastre una foto de la biblioteca? (Mientras se arrastra solo se pueden mirar los tipos.) */
export function hasAssetDrag(transfer: Pick<DataTransfer, 'types'> | null): boolean {
  return Boolean(transfer && Array.from(transfer.types ?? []).includes(ASSET_DRAG_TYPE));
}

/** ¿Lleva el arrastre archivos del dispositivo? */
export function hasFileDrag(transfer: Pick<DataTransfer, 'types'> | null): boolean {
  return Boolean(transfer && Array.from(transfer.types ?? []).includes('Files'));
}

/** La foto de la biblioteca que se ha soltado, o null si el dato no es nuestro o no es válido. */
export function readAssetDrag(transfer: Pick<DataTransfer, 'getData'> | null): DraggedAsset | null {
  if (!transfer) return null;
  let raw = '';
  try {
    raw = transfer.getData(ASSET_DRAG_TYPE);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as {
      assetId?: unknown;
      fileName?: unknown;
      width?: unknown;
      height?: unknown;
    } | null;
    if (!value || typeof value.assetId !== 'string' || !UUID.test(value.assetId)) return null;
    const size = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);
    return {
      id: value.assetId,
      name: typeof value.fileName === 'string' ? value.fileName.slice(0, 200) : '',
      width: size(value.width),
      height: size(value.height),
    };
  } catch {
    return null;
  }
}

/** Formatos de imagen que admite la biblioteca al soltar o pegar. */
export const DROPPABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Las imágenes de una lista de archivos soltados o pegados (lo demás se ignora). */
export function imageFilesOf(files: ArrayLike<File> | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => (DROPPABLE_IMAGE_TYPES as readonly string[]).includes(file.type));
}
