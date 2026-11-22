// El borrador de un reel hecho con «Hacer un reel como este»: junta el resultado
// del análisis con la biblioteca y el aspecto de la marca. Lo usan la pantalla
// de resultado y el editor de reels, que abre con él una pieza todavía sin
// versiones (`?referencia=<id>`).
import { useMemo } from 'react';
import { useActiveProfile } from '@/features/brand/api';
import { useBrandFontFaces, useReelFont } from '@/features/brand/fontsApi';
import { parseProfile } from '@/features/brand/profile';
import { parseReelLikeResult } from '../../../../supabase/functions/_shared/reels/like';
import { REEL_TEMPLATES } from '../templates';
import { useLikeLibrary, useReelReference } from './api';
import { buildDraft, matchShots, type BrandLook, type ReelDraft, type ShotMatch } from './draft';

/** Colores y tipografía de la marca que puede usar el reel. */
export function useBrandLook(brandId: string): BrandLook {
  const profileRow = useActiveProfile(brandId);
  const fontFaces = useBrandFontFaces(brandId);
  const reelFont = useReelFont(brandId);
  return useMemo(() => {
    const profile = profileRow.data ? parseProfile(profileRow.data.data) : null;
    const usable = fontFaces.fonts.filter((f) => f.format === 'ttf' || f.format === 'otf');
    const font = usable.find((f) => reelFont.data && f.family === reelFont.data.family);
    return {
      colors: (profile?.visual.colors ?? []).map((c) => c.hex.toUpperCase()),
      ...(font ? { font: { path: font.storage_path, family: font.family } } : {}),
    };
  }, [profileRow.data, fontFaces.fonts, reelFont.data]);
}

export interface DraftState {
  loading: boolean;
  /** El análisis no existe, no se puede leer o todavía no tiene resultado. */
  missing: boolean;
  draft: (ReelDraft & { matches: ShotMatch[] }) | null;
}

/** Borrador a partir de un análisis listo. `null` = no se pide nada. */
export function useReelLikeDraft(brandId: string, referenceId: string | null): DraftState {
  const wanted = Boolean(referenceId);
  const reference = useReelReference(brandId, referenceId ?? undefined);
  const library = useLikeLibrary(brandId, wanted);
  const look = useBrandLook(brandId);
  const row = reference.data;

  return useMemo((): DraftState => {
    if (!referenceId) return { loading: false, missing: false, draft: null };
    if (reference.isPending || library.isPending) return { loading: true, missing: false, draft: null };
    const result = parseReelLikeResult(row?.status === 'ready' ? row.result : null);
    if (!result) return { loading: false, missing: true, draft: null };
    const matches = matchShots(result, library.data ?? []);
    const draft = buildDraft(result, matches, { referenceId, templates: REEL_TEMPLATES, look });
    return { loading: false, missing: false, draft: { ...draft, matches } };
  }, [referenceId, reference.isPending, row, library.isPending, library.data, look]);
}
