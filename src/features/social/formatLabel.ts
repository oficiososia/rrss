import { getFormatSpec } from '@/features/content/networks';

/** «Publicación», «Carrusel», «Reel», «Historia»… */
export function formatLabel(network: string, format: string): string {
  return getFormatSpec(network, format)?.label ?? format;
}
