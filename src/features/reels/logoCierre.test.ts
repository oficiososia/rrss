import { describe, expect, it } from 'vitest';
import { reelLogoPath } from './quality';

// El logotipo del cierre de los reels (F65): el fondo del cierre siempre es oscuro, así que se
// prefiere la variante clara del kit, con la misma regla de contraste que las plantillas.

const path = (name: string) => `org/marca/media/${name}`;
const logo = (id: string, name: string, extra: { file_name?: string; tags?: string[]; mime_type?: string } = {}) => ({
  id,
  kind: 'logo',
  storage_path: path(`${id}-${name}`),
  mime_type: extra.mime_type ?? 'image/png',
  ...extra,
});

describe('logotipo del cierre de los reels', () => {
  it('con la luminancia medida, el claro aunque el primero del perfil sea el oscuro', () => {
    const logos = [logo('a', 'logo.png'), logo('b', 'logo-2.png')];
    const tones = new Map([
      ['a', 0.01],
      ['b', 0.9],
    ]);
    expect(reelLogoPath(['a', 'b'], logos, tones)).toBe(path('b-logo-2.png'));
    // Si el primero ya se ve sobre el fondo oscuro, se queda.
    expect(reelLogoPath(['b', 'a'], logos, tones)).toBe(path('b-logo-2.png'));
    // Sin otra variante que se vea, el primero.
    expect(reelLogoPath(['a'], logos, tones)).toBe(path('a-logo.png'));
  });

  it('sin medir, la variante que su nombre o sus etiquetas dicen clara', () => {
    const logos = [
      logo('a', 'logotipo-oscuro.png', { file_name: 'Logotipo oscuro.png' }),
      logo('b', 'logotipo-blanco.png'),
      logo('c', 'marca.webp', { tags: ['claro'], mime_type: 'image/webp' }),
    ];
    // Por la ruta (la consulta de las campañas no trae el nombre del archivo).
    expect(reelLogoPath(['a', 'b'], logos)).toBe(path('b-logotipo-blanco.png'));
    // Por las etiquetas.
    expect(reelLogoPath(['a', 'c'], logos)).toBe(path('c-marca.webp'));
    // Nada lo indica: el primero, como siempre.
    expect(reelLogoPath(['a'], logos)).toBe(path('a-logotipo-oscuro.png'));
  });

  it('una palabra dentro de otra no cuenta («Clarisa» no es «clara»)', () => {
    const logos = [logo('a', 'logo.png'), logo('b', 'clarisa-bistro.png')];
    expect(reelLogoPath(['a', 'b'], logos)).toBe(path('a-logo.png'));
  });

  it('el SVG sigue sin valer, aunque sea el claro', () => {
    const logos = [logo('a', 'logo.png'), logo('b', 'logo-blanco.svg', { mime_type: 'image/svg+xml' })];
    expect(reelLogoPath(['a', 'b'], logos)).toBe(path('a-logo.png'));
    expect(reelLogoPath(['b'], logos)).toBeUndefined();
  });
});
