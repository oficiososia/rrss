import type { ContentDocument } from '../../document';
import type { LayerPatch } from '../history';
import type { ImageLookup } from './nodes';

/**
 * Lo que el editor le pasa al lienzo. El lienzo (Konva) vive detrás de esta
 * interfaz y se carga aparte, solo en la ruta del editor; en las pruebas de
 * componentes se sustituye por un doble sin Konva.
 */
export interface CanvasViewProps {
  document: ContentDocument;
  selectedId: string | null;
  readOnly: boolean;
  /** Direcciones de las imágenes de la biblioteca, por id de recurso. */
  images: ImageLookup;
  onSelect: (id: string | null) => void;
  /** Cambio terminado (al soltar tras arrastrar, girar o redimensionar). */
  onChange: (id: string, patch: LayerPatch) => void;
  /** Doble clic en un texto: el editor lleva el foco a su campo. */
  onEditText: (id: string) => void;
  /** Nombre accesible del lienzo. */
  label: string;
}
