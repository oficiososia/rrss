import { describe, expect, it } from 'vitest';
import { qrPath } from './QrCode';
import {
  canShareVideo,
  captionSimilarity,
  instagramCaption,
  matchReel,
  normalizeInstagramUrl,
  type MatchCandidate,
} from './manualFlow';

// «Terminar en Instagram»: el texto que se pega, cuándo se comparte, el enlace que se pega al volver y
// cómo se reconoce el reel entre las últimas publicaciones de la cuenta.

const HANDOFF = '2026-11-22T10:00:00Z';
const at = (minutes: number) => new Date(Date.parse(HANDOFF) + minutes * 60_000).toISOString();
const media = (id: string, extra: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id,
  external_id: `ext-${id}`,
  caption: null,
  media_type: 'VIDEO',
  media_product_type: 'REELS',
  permalink: `https://www.instagram.com/reel/${id}/`,
  published_at: at(30),
  ...extra,
});

describe('el texto que se pega en Instagram', () => {
  it('es el pie con los hashtags que falten al final, como al publicar', () => {
    expect(instagramCaption({ caption: 'Pan del día #pan', hashtags: ['pan', 'obrador'] })).toBe(
      'Pan del día #pan\n\n#obrador',
    );
    expect(instagramCaption({ caption: '', hashtags: [] })).toBe('');
    expect(instagramCaption(undefined)).toBe('');
  });
});

describe('compartir o descargar', () => {
  const share = async () => undefined;
  it('comparte con el diálogo del sistema solo con archivos y pantalla táctil', () => {
    expect(canShareVideo({ share, canShare: () => true }, true)).toBe(true);
    // Un ordenador también sabe compartir archivos, pero ese diálogo no lleva a Instagram.
    expect(canShareVideo({ share, canShare: () => true }, false)).toBe(false);
    expect(canShareVideo({ share, canShare: () => false }, true)).toBe(false);
    expect(canShareVideo({ share } as unknown as Navigator, true)).toBe(false);
    expect(canShareVideo(undefined, true)).toBe(false);
    expect(
      canShareVideo(
        {
          share,
          canShare: () => {
            throw new Error('no');
          },
        },
        true,
      ),
    ).toBe(false);
  });
});

describe('el enlace del reel', () => {
  it('acepta instagram.com (con o sin https), vacío o nada más', () => {
    expect(normalizeInstagramUrl('  ')).toBeNull();
    expect(normalizeInstagramUrl('instagram.com/reel/AbC_1-x/')).toBe('https://instagram.com/reel/AbC_1-x/');
    expect(normalizeInstagramUrl('http://www.instagram.com/reel/AbC/?igsh=x1')).toBe(
      'https://www.instagram.com/reel/AbC/?igsh=x1',
    );
    expect(normalizeInstagramUrl('https://evil.test/instagram.com/reel/x')).toBe('invalid');
    expect(normalizeInstagramUrl('https://instagram.com.evil.test/reel/x')).toBe('invalid');
    expect(normalizeInstagramUrl('javascript:alert(1)')).toBe('invalid');
  });
});

describe('reconocer el reel entre las publicaciones de la cuenta', () => {
  const handoff = { handed_off_at: HANDOFF, caption: 'Pan recién hecho, ven a por él.\n\n#pan #obrador' };

  it('por el pie, el tipo y la fecha', () => {
    const result = matchReel(handoff, [
      media('foto', { media_type: 'IMAGE', media_product_type: 'FEED', caption: handoff.caption }),
      media('antes', { caption: handoff.caption, published_at: at(-60) }),
      media('otro', { caption: 'Hoy, arroz con costra' }),
      media('este', { caption: 'Pan recién hecho, ven a por él! 🥖 #pan #obrador' }),
    ]);
    expect(result).toEqual({ match: expect.objectContaining({ id: 'este' }), reason: 'found' });
  });

  it('no usa lo que ya es de otra pieza ni lo de más de un mes después', () => {
    const candidates = [
      media('usado', { caption: handoff.caption }),
      media('tarde', { caption: handoff.caption, published_at: at(60 * 24 * 40) }),
    ];
    expect(matchReel(handoff, candidates, new Set(['usado']))).toEqual({ match: null, reason: 'none' });
  });

  it('con dos igual de buenos no elige ninguno', () => {
    const result = matchReel(handoff, [
      media('a', { caption: handoff.caption }),
      media('b', { caption: handoff.caption, published_at: at(90) }),
    ]);
    expect(result).toEqual({ match: null, reason: 'ambiguous' });
  });

  it('sin pie, solo un único vídeo de los dos días siguientes', () => {
    const empty = { handed_off_at: HANDOFF, caption: '' };
    expect(matchReel(empty, [media('uno')]).match?.id).toBe('uno');
    expect(matchReel(empty, [media('uno'), media('dos', { published_at: at(120) })]).reason).toBe('ambiguous');
    expect(matchReel(empty, [media('lejos', { published_at: at(60 * 24 * 5) })]).reason).toBe('none');
  });

  it('el parecido del pie no depende de mayúsculas, tildes ni signos', () => {
    expect(captionSimilarity('Pan RECIÉN hecho!!', 'pan recien hecho')).toBe(1);
    expect(captionSimilarity('', 'algo')).toBe(0);
  });
});

describe('código QR', () => {
  it('dibuja un enlace firmado largo y rechaza lo que no cabe', () => {
    const signed = `https://almacen.test/object/sign/medios/org/marca/reels/reel.mp4?token=${'x'.repeat(600)}`;
    const qr = qrPath(signed);
    expect(qr?.size).toBeGreaterThan(21);
    expect(qr?.d).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(qrPath('x'.repeat(5000))).toBeNull();
  });
});
