// Verificador de marca sin IA. Punto de entrada: `verifyPiece(input, options?)`.

export { verifyPiece, CHECK_ORDER } from './verify';
export { brandRulesFromProfile } from './profile';
export type { ProfileLike, ExtraBrandRules } from './profile';
export { checkAltText, checkHashtagCount, checkLength, checkMentionCount } from './limits';
export { checkBrandHashtags, checkCallToAction, checkForbiddenPhrases } from './vocabulary';
export { checkContrast, checkPalette } from './visual';
export { checkEmojis, checkReadability, countSyllables, fernandezHuerta, readabilityBand } from './style';
export { contrastRatio, deltaE2000, deltaEHex, parseHex, relativeLuminance, rgbToLab } from './color';
export { extractHashtags, extractMentions, findEmojis, findPhrase } from './text';
export * from './thresholds';
export type * from './types';
