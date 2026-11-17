// Adaptador del perfil de marca a las reglas del verificador.

import type { BrandRules } from './types';

/**
 * Forma mínima del perfil que se lee (estructural, compatible con `BrandProfileData`
 * de `src/features/brand`, sin importarlo). Hoy el perfil solo aporta palabras
 * vetadas (`voice.forbiddenPhrases`) y colores (`visual.colors`).
 */
export interface ProfileLike {
  voice?: { forbiddenPhrases?: string[] };
  visual?: { colors?: { name?: string; hex: string }[] };
}

/**
 * Reglas que el perfil actual NO tiene y que, cuando existan, se pasan aquí:
 * hashtags obligatorios o recomendados, llamadas a la acción y política de emojis.
 */
export type ExtraBrandRules = Pick<
  BrandRules,
  'requiredHashtags' | 'recommendedHashtags' | 'callsToAction' | 'emojiPolicy'
>;

export function brandRulesFromProfile(
  profile: ProfileLike | null | undefined,
  extra: ExtraBrandRules = {},
): BrandRules {
  return {
    forbiddenPhrases: profile?.voice?.forbiddenPhrases ?? [],
    brandColors: (profile?.visual?.colors ?? []).map((c) => ({ name: c.name, hex: c.hex })),
    ...extra,
  };
}
