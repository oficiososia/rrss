// El borrador de un reel hecho con «Hacer un reel como este»: junta el resultado
// del análisis con la biblioteca y el aspecto de la marca. Lo usan la pantalla
// de resultado y el editor de reels, que abre con él una pieza todavía sin
// versiones (`?referencia=<id>`).
import { useMemo } from 'react';
import { useActiveProfile } from '@/features/brand/api';
import { useBrandFontFaces, useReelFont } from '@/features/brand/fontsApi';
import { parseProfile } from '@/features/brand/profile';
import { useAssetsByIds } from '@/features/library/api';
import { parseReelLikeResult } from '../../../../supabase/functions/_shared/reels/like';
import { applySavedFraming } from '../editor/ops';
import { REEL_CAPTION_MAX, REEL_HASHTAGS_MAX, type ReelCopy } from '../editor/project';
import { brandReelKit, reelLogoPath, savedFocalPoints, subjectMasks } from '../quality';
import { REEL_TEMPLATES } from '../templates';
import { useLikeLibrary, useReelReference } from './api';
import { buildDraft, matchShots, type BrandLook, type ReelDraft, type ShotMatch } from './draft';

/**
 * Colores, tipografía y cierre de la marca que puede usar el reel: lo mismo que toman los
 * reels hechos desde una plantilla (ReelEditor → `buildBrandReel`), con el mismo logotipo.
 * `pending`: aún falta el perfil o sus logotipos.
 */
export function useBrandLookState(brandId: string): { look: BrandLook; pending: boolean } {
  const profileRow = useActiveProfile(brandId);
  const fontFaces = useBrandFontFaces(brandId);
  const reelFont = useReelFont(brandId);
  const profile = useMemo(() => (profileRow.data ? parseProfile(profileRow.data.data) : null), [profileRow.data]);
  const logoIds = useMemo(() => profile?.visual.logoAssetIds ?? [], [profile]);
  const logos = useAssetsByIds(brandId, logoIds);
  const look = useMemo((): BrandLook => {
    const usable = fontFaces.fonts.filter((f) => f.format === 'ttf' || f.format === 'otf');
    const font = usable.find((f) => reelFont.data && f.family === reelFont.data.family);
    return {
      colors: (profile?.visual.colors ?? []).map((c) => c.hex.toUpperCase()),
      ...(font ? { font: { path: font.storage_path, family: font.family } } : {}),
      ...(profile ? { kit: brandReelKit(profile, reelLogoPath(logoIds, logos.data ?? [])) } : {}),
    };
  }, [profile, logoIds, logos.data, fontFaces.fonts, reelFont.data]);
  // El borrador espera al perfil y a sus logotipos: si no, saldría sin cierre o con otro logotipo.
  return { look, pending: profileRow.isPending || (logoIds.length > 0 && logos.isPending) };
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
  const { look, pending: lookPending } = useBrandLookState(brandId);
  const row = reference.data;

  return useMemo((): DraftState => {
    if (!referenceId) return { loading: false, missing: false, draft: null };
    if (reference.isPending || library.isPending || lookPending) return { loading: true, missing: false, draft: null };
    const result = parseReelLikeResult(row?.status === 'ready' ? row.result : null);
    if (!result) return { loading: false, missing: true, draft: null };
    const matches = matchShots(result, library.data ?? []);
    const drafted = buildDraft(result, matches, { referenceId, templates: REEL_TEMPLATES, look });
    // El punto de interés y la máscara de «Quitar el fondo» guardados de cada foto, como al añadirla a mano.
    const assets = library.data ?? [];
    const built = {
      ...drafted,
      project: applySavedFraming(drafted.project, savedFocalPoints(assets), subjectMasks(assets)),
    };
    // El pie y los hashtags que propone el análisis van en la pieza (\`copy\`): se publica con ellos y se
    // pueden cambiar en «Exportar». Los escribió la IA: se marca (\`aiGenerated\`).
    const copy = likeCopy(result.texts);
    const draft = copy ? { ...built, project: { ...built.project, copy } } : built;
    return { loading: false, missing: false, draft: { ...draft, matches } };
  }, [referenceId, reference.isPending, row, library.isPending, library.data, look, lookPending]);
}

/**
 * El pie y los hashtags que propone «Hacer un reel como este», como `copy` de
 * la pieza de reel (lo que lee el publicador). `null` si no hay pie ni
 * hashtags. Los hashtags que no cumplen el formato se quitan.
 */
export function likeCopy(texts: { caption: string; hashtags: string[] }): ReelCopy | null {
  const caption = [...texts.caption.trim()].slice(0, REEL_CAPTION_MAX).join('');
  const hashtags = [...new Set(texts.hashtags.map((tag) => tag.replace(/^#+/, '').trim()))]
    .filter((tag) => /^[\p{L}\p{N}_]{1,100}$/u.test(tag))
    .slice(0, REEL_HASHTAGS_MAX);
  if (!caption && hashtags.length === 0) return null;
  return { caption, hashtags, aiGenerated: true };
}
