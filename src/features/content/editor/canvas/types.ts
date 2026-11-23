import type { ReactNode } from 'react';
import type { PageView } from '../../document';
import type { Rect } from '../../safeZones';
import type { DraggedAsset } from '../assetDrag';
import type { LayerPatch } from '../history';
import type { ImageLookup } from './nodes';

/** Cómo se ha elegido una capa en el lienzo. */
export interface SelectOptions {
  /** Con Mayúsculas, Ctrl o Cmd: añadirla a la selección o quitarla. */
  toggle?: boolean;
}

/** Superposición de la zona segura: lo que puede tapar la interfaz de la red. */
export interface SafeZoneOverlay {
  unsafe: Rect[];
  safe: Rect;
}

/** Lo que se ha soltado sobre el lienzo: una foto de la biblioteca o archivos del dispositivo. */
export interface CanvasDrop {
  /** Foto de la biblioteca arrastrada desde una lista de fotos (ver `assetDrag.ts`). */
  asset: DraggedAsset | null;
  /** Imágenes del dispositivo (ya filtradas a los formatos admitidos). */
  files: File[];
  /** Archivos soltados que no son una imagen admitida. */
  rejected: number;
  /** Punto del lienzo (en sus unidades) donde se ha soltado; null si fue en el margen. */
  at: { x: number; y: number } | null;
  /** Marco de foto que hay bajo ese punto; null si ninguno. */
  frameId: string | null;
}

/**
 * Lo que el editor le pasa al lienzo. El lienzo (Konva) vive detrás de esta
 * interfaz y se carga aparte, solo en la ruta del editor; en las pruebas de
 * componentes se sustituye por un doble sin Konva.
 */
export interface CanvasViewProps {
  /** La página que se dibuja (con el lienzo del documento). */
  document: PageView;
  /** Capas elegidas (una o varias). */
  selectedIds: string[];
  readOnly: boolean;
  /** Direcciones de las imágenes de la biblioteca, por id de recurso. */
  images: ImageLookup;
  onSelect: (id: string | null, options?: SelectOptions) => void;
  /** Rectángulo de selección: capas que toca. `additive` si se ha empezado con Mayúsculas. */
  onSelectMany: (ids: string[], additive: boolean) => void;
  /** Cambio terminado de una o varias capas (al soltar tras arrastrar, girar o redimensionar). */
  onChange: (changes: { id: string; patch: LayerPatch }[]) => void;
  /** Doble clic en un texto: el editor abre la edición sobre el lienzo. */
  onEditText: (id: string) => void;
  /** Texto que se está editando sobre el lienzo; null si ninguno. */
  editingTextId: string | null;
  /** Terminar la edición sobre el lienzo conservando lo escrito (Intro, Escape o clic fuera). */
  onTextCommit: (id: string, text: string) => void;
  /** Cerrar la edición sin cambiar nada (ya no la usa el teclado: Escape también conserva lo escrito). */
  onTextCancel: () => void;
  /** Zona segura de la red que se dibuja encima; null para no dibujarla. */
  safeZone: SafeZoneOverlay | null;
  /** Nombre accesible del lienzo. */
  label: string;

  // ── Marcos de foto, barra flotante, menú y soltar (opcionales: un doble del lienzo puede ignorarlos) ──

  /** Clic en un marco de foto vacío: el editor abre «Poner foto». */
  onFrameClick?: (id: string) => void;
  /** Doble clic en una foto: el editor entra en «encuadrar» (recolocar y ampliar dentro de su caja). */
  onEditImage?: (id: string) => void;
  /** Foto que se está encuadrando sobre el lienzo; null si ninguna. */
  framingId?: string | null;
  /** Cambio del encuadre mientras se arrastra o se amplía (un solo paso de deshacer por sesión). */
  onFrameChange?: (id: string, patch: LayerPatch) => void;
  /** Termina el encuadre (Intro, Escape, «Listo» o clic fuera). */
  onFramingEnd?: () => void;
  /** Barra de acciones del elemento elegido: el lienzo la coloca encima sin taparlo ni salirse. */
  toolbar?: ReactNode;
  /** Botón derecho sobre una capa (`id`) o sobre el fondo (null), en coordenadas de la ventana. */
  onContextMenu?: (target: { id: string | null; clientX: number; clientY: number }) => void;
  /** Se ha soltado una foto de la biblioteca o archivos sobre el lienzo. */
  onDrop?: (drop: CanvasDrop) => void;
  /** Botones de la fila del zoom: a su izquierda (capas, zonas seguras) y a su derecha (copiloto). */
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
}
