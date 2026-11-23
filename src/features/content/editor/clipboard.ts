import type { Canvas, Layer } from '../document';
import { cloneLayers } from './history';

// Portapapeles del editor: copiar, cortar y pegar capas entre páginas (y entre
// piezas de la misma marca, mientras la pestaña siga abierta). Vive en memoria:
// no se escribe en el portapapeles del sistema, así que no pide permisos ni
// pisa lo que la persona tenga copiado; Ctrl+V sigue pegando una imagen del
// sistema si la hay (lo decide quien escucha el evento `paste`).

interface Clip {
  brandId: string;
  layers: Layer[];
  /** Veces que se ha pegado este recorte: cada pegado se desplaza un poco más. */
  pastes: number;
}

let clip: Clip | null = null;

export function copyLayers(brandId: string, layers: readonly Layer[]): number {
  if (layers.length === 0) return 0;
  clip = { brandId, layers: structuredClone([...layers]), pastes: 0 };
  return layers.length;
}

/** ¿Hay algo que pegar en esta marca? (Las fotos de otra marca no son de su biblioteca.) */
export function canPaste(brandId: string): boolean {
  return clip !== null && clip.brandId === brandId;
}

/** Solo para las pruebas. */
export function clearClipboard(): void {
  clip = null;
}

/**
 * Lo copiado, como capas nuevas para la página activa. `samePage` dice si se
 * pega en la página de la que se copió (se desplaza para que se vea la copia);
 * en otra página cae en el mismo sitio, que es lo que se espera en un carrusel.
 */
export function pasteLayers(brandId: string, taken: readonly Layer[], canvas: Canvas, samePage: boolean): Layer[] {
  if (!clip || clip.brandId !== brandId) return [];
  clip.pastes += 1;
  const step = Math.round(Math.min(canvas.width, canvas.height) * 0.03);
  const shift = samePage ? step * clip.pastes : step * (clip.pastes - 1);
  return cloneLayers(clip.layers, taken, canvas, shift);
}

/** Identificadores de lo copiado (para saber si se pega en la misma página). */
export function clipboardIds(): string[] {
  return clip ? clip.layers.map((layer) => layer.id) : [];
}
