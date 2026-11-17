// Comprobaciones frente a los límites de la red: longitud, hashtags, menciones, texto alternativo.

import { pieceHashtagKeys, pieceMentionKeys, publishedText, textLength } from './text';
import type { Finding, NetworkLimits, PieceText } from './types';

function network(limits: NetworkLimits): string {
  return limits.label ? ` en ${limits.label}` : ' en la red de destino';
}

function unknownLimit(check: 'length' | 'hashtags' | 'mentions' | 'alt-text', what: string): Finding {
  return {
    code: 'NETWORK_LIMIT_UNKNOWN',
    check,
    severity: 'info',
    message: `No se conoce el límite de ${what} de esta red; no se puede comprobar.`,
    target: { part: 'piece' },
    omitted: true,
  };
}

/** Longitud del texto publicado (pie más hashtags añadidos aparte) frente al máximo de la red. */
export function checkLength(text: PieceText, limits: NetworkLimits): Finding[] {
  const max = limits.maxCaptionLength;
  if (max === undefined) return [unknownLimit('length', 'longitud del texto')];
  const unit = limits.lengthUnit ?? 'utf16';
  const length = textLength(publishedText(text.caption, text.hashtags), unit);
  if (length <= max) return [];
  return [
    {
      code: 'LENGTH_EXCEEDED',
      check: 'length',
      severity: 'block',
      message: `El texto tiene ${length} caracteres y el máximo${network(limits)} es ${max}. Quita ${length - max}.`,
      measured: length,
      threshold: max,
      target: { part: 'caption' },
    },
  ];
}

export function checkHashtagCount(text: PieceText, limits: NetworkLimits): Finding[] {
  const max = limits.maxHashtags;
  if (max === undefined) return [unknownLimit('hashtags', 'hashtags')];
  const count = pieceHashtagKeys(text.caption, text.hashtags).length;
  if (count <= max) return [];
  return [
    {
      code: 'HASHTAGS_EXCEEDED',
      check: 'hashtags',
      severity: 'block',
      message: `Hay ${count} hashtags y el máximo${network(limits)} es ${max}. Quita ${count - max}.`,
      measured: count,
      threshold: max,
      target: { part: 'hashtags' },
    },
  ];
}

export function checkMentionCount(text: PieceText, limits: NetworkLimits): Finding[] {
  const max = limits.maxMentions;
  if (max === undefined) return [unknownLimit('mentions', 'menciones')];
  const count = pieceMentionKeys(text.caption, text.mentions).length;
  if (count <= max) return [];
  return [
    {
      code: 'MENTIONS_EXCEEDED',
      check: 'mentions',
      severity: 'block',
      message: `Hay ${count} menciones y el máximo${network(limits)} es ${max}. Quita ${count - max}.`,
      measured: count,
      threshold: max,
      target: { part: 'mentions' },
    },
  ];
}

/** Texto alternativo presente cuando hay imagen y, si la red lo limita, dentro del máximo. */
export function checkAltText(text: PieceText, hasImage: boolean | undefined, limits: NetworkLimits): Finding[] {
  if (!hasImage) return [];
  const alt = (text.altText ?? '').trim();
  if (!alt) {
    return [
      {
        code: 'ALT_TEXT_MISSING',
        check: 'alt-text',
        severity: 'warn',
        message: 'La imagen no tiene texto alternativo. Descríbela en una frase para quien no puede verla.',
        measured: 0,
        threshold: 1,
        target: { part: 'altText' },
      },
    ];
  }
  const max = limits.maxAltTextLength;
  const length = textLength(alt, limits.lengthUnit ?? 'utf16');
  if (max !== undefined && length > max) {
    return [
      {
        code: 'ALT_TEXT_TOO_LONG',
        check: 'alt-text',
        severity: 'warn',
        message: `El texto alternativo tiene ${length} caracteres y el máximo${network(limits)} es ${max}.`,
        measured: length,
        threshold: max,
        target: { part: 'altText' },
      },
    ];
  }
  return [];
}
