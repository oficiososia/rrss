// Qué sabe la IA de la marca cuando el perfil está incompleto o no existe.
//
// Antes, sin perfil activo, `ai-generate` respondía 409 «Esta marca todavía no
// tiene perfil» a todo (prueba de calidad del 23/11/2026, fallo 1). Ahora la IA
// trabaja con lo que haya: el perfil guardado si existe y, siempre, el nombre,
// el sector y la web de la marca (`brands`). Solo si no hay perfil NI sector se
// pide el sector antes de gastar (409 `brand_basics_missing`), porque sin saber
// a qué se dedica la marca la IA tendría que inventárselo.
//
// Puro: sin red. Lo usan `ai-generate` y `ai-reel-like`.
import type { Json } from '../../contract.ts';

/** Datos básicos de la marca (tabla `brands`), leídos con la identidad del usuario. */
export interface BrandBasics {
  name: string;
  sector: string;
  website: string;
}

export const MAX_SECTOR_CHARS = 120;

/** Nota que acompaña a un perfil inexistente: es dato para el modelo, no una orden del cliente. */
export const MISSING_PROFILE_NOTE =
  'La marca todavía no ha completado su perfil. Usa solo su nombre, su sector y su web; no inventes datos (precios, direcciones, promociones, horarios).';

const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** El sector que manda el navegador cuando la marca no lo tiene (lo pide el diálogo antes de gastar). */
export function sectorFromInput(value: unknown): string {
  return clip(value, MAX_SECTOR_CHARS);
}

/** Basta con el perfil o, sin él, con el sector: sin ninguno de los dos, se pide antes de gastar. */
export function needsBrandBasics(profile: Json | null, basics: BrandBasics | null, sector = ''): boolean {
  return profile === null && !(basics?.sector.trim() || sector.trim());
}

/**
 * El perfil que se le da a la IA. Con perfil guardado, ese perfil y los datos
 * básicos de la marca (`brand`: el perfil no guarda el nombre, y sin él los pies
 * escribían el lugar de dos formas). Sin perfil, solo los datos básicos y una nota.
 */
export function effectiveBrandProfile(
  profile: Json | null,
  basics: BrandBasics | null,
  sector = '',
): { profile: Json; missing: boolean } {
  const brand = basics
    ? {
        name: clip(basics.name, 200),
        sector: clip(basics.sector, MAX_SECTOR_CHARS) || clip(sector, MAX_SECTOR_CHARS),
        website: clip(basics.website, 300),
      }
    : null;
  if (profile !== null && typeof profile === 'object' && !Array.isArray(profile)) {
    return { profile: brand ? { ...profile, brand } : profile, missing: false };
  }
  return {
    profile: {
      brand: brand ?? { name: '', sector: clip(sector, MAX_SECTOR_CHARS), website: '' },
      note: MISSING_PROFILE_NOTE,
    },
    missing: true,
  };
}
