import { describe, expect, it } from 'vitest';
import { NEUTRAL_THEME, contrast } from '../../../agency/catalogo/tema.ts';
import { validateDocument } from '../content/document';
import { construirMenu, espaciar } from './disenos';
import { NBSP, medidorEstimado, sinPartirNombres } from './medir';
import { datosIniciales, PRESETS_EVENTO, TIPOS, type DatosMenu, type FormatoMenu, type TipoMenu } from './modelos';

const FOTO = '11111111-1111-4111-8111-111111111111';
const LOGO = '22222222-2222-4222-8222-222222222222';
const THEME = { ...NEUTRAL_THEME, logo: LOGO };

function larga(tipo: TipoMenu): DatosMenu {
  const d = datosIniciales(tipo);
  const platos = Array.from({ length: 9 }, (_, i) => `Plato número ${i + 1} con salsa de Santa Pola y guarnición de temporada`).join('\n');
  if (tipo === 'tapas') {
    d.tapas = Array.from({ length: 12 }, (_, i) => ({ nombre: `Tapa ${i + 1} de jamón ibérico 5J`, precio: '3,50 €', foto: FOTO }));
  } else if (tipo === 'tapa-semana') {
    d.descripcion = 'Una descripción muy larga de la tapa. '.repeat(14);
    d.foto = FOTO;
  } else {
    d.secciones = ['Primeros', 'Segundos', 'Postres', 'Bodega'].map((titulo) => ({ titulo, texto: platos }));
  }
  return d;
}

const casos: Array<[TipoMenu, FormatoMenu]> = TIPOS.flatMap((t) => (['story', 'post'] as const).map((f) => [t.id, f] as [TipoMenu, FormatoMenu]));

function textos(r: ReturnType<typeof construirMenu>) {
  return r.document.pages!.map((p) =>
    (p.layers as Array<Record<string, unknown>>).filter((l) => l.type === 'text') as Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      italic: boolean;
      color: string;
      fontWeight: number;
      fontFamily: string;
      name: string;
      text: string;
    }>,
  );
}

describe('plantillas de menús: reglas de diseño', () => {
  it.each(casos)('%s en %s con textos de ejemplo: documento válido, sin cursivas y en Libre Baskerville', (tipo, formato) => {
    const d = datosIniciales(tipo);
    if (tipo === 'tapas') d.tapas.forEach((t) => (t.foto = FOTO));
    if (tipo === 'tapa-semana' || tipo === 'menu-dia') d.foto = FOTO;
    const r = construirMenu(tipo, d, formato, THEME, medidorEstimado);
    expect(validateDocument(r.document).ok).toBe(true);
    expect(r.desborda).toBe(false);
    for (const page of textos(r)) {
      for (const t of page) {
        expect(t.italic).toBe(false);
        expect(t.fontFamily).toBe('Libre Baskerville');
      }
    }
  });

  it.each(casos)('%s en %s con un menú largo: sin solapes y dentro de la zona segura', (tipo, formato) => {
    const r = construirMenu(tipo, larga(tipo), formato, THEME, medidorEstimado);
    expect(validateDocument(r.document).ok).toBe(true);
    const alto = formato === 'story' ? 1920 : 1350;
    textos(r).forEach((page) => {
      const cajas = [...page].sort((a, b) => a.y - b.y);
      for (const t of cajas) {
        expect(t.x).toBeGreaterThanOrEqual(65);
        expect(t.x + t.width).toBeLessThanOrEqual(1080 - 65 + 1);
        if (formato === 'story' && !r.desborda) {
          expect(t.y).toBeGreaterThanOrEqual(250);
          expect(t.y + t.height).toBeLessThanOrEqual(alto - 340 + 1);
        }
      }
      // Dos textos que comparten franja horizontal no se pisan en vertical.
      for (let i = 0; i < cajas.length; i++) {
        for (let j = i + 1; j < cajas.length; j++) {
          const a = cajas[i]!;
          const b = cajas[j]!;
          const comparten = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1;
          if (comparten && !r.desborda) expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
        }
      }
    });
    if (tipo === 'tapa-semana') return;
    if (formato === 'post') {
      // Un menú largo en publicación se reparte en un carrusel.
      expect(r.paginas).toBeGreaterThan(1);
      expect(r.paginas).toBeLessThanOrEqual(10);
    } else {
      // En historia no cabe: se avisa.
      expect(r.desborda).toBe(true);
    }
  });

  it('un menú corto cabe en una página tanto en historia como en publicación', () => {
    for (const f of ['story', 'post'] as const) {
      const r = construirMenu('menu-dia', datosIniciales('menu-dia'), f, THEME, medidorEstimado);
      expect(r.paginas).toBe(1);
    }
  });

  it('todas las líneas de un plato llevan el mismo color y peso', () => {
    const r = construirMenu('evento', datosIniciales('evento'), 'post', THEME, medidorEstimado);
    const platos = textos(r).flat().filter((t) => t.name === 'Plato');
    expect(platos.length).toBeGreaterThan(5);
    expect(new Set(platos.map((t) => `${t.color}/${t.fontWeight}`)).size).toBe(1);
  });

  it('con foto, la foto va nítida y el texto sobre un panel liso (sin velo gris sobre ella)', () => {
    const d = { ...datosIniciales('menu-dia'), foto: FOTO };
    const r = construirMenu('menu-dia', d, 'story', THEME, medidorEstimado);
    const capas = r.document.pages![0]!.layers as Array<{ id: string; type: string; opacity?: number; y: number; height: number }>;
    const foto = capas.find((c) => c.type === 'image')!;
    expect(foto.opacity ?? 1).toBe(1);
    // Ninguna capa cubre la foto entera.
    expect(capas.filter((c) => c.type === 'shape' && c.id !== 'p1-fondo' && c.height >= 1900)).toHaveLength(0);
    const panel = capas.find((c) => c.id.endsWith('-panel'))!;
    const iFoto = capas.indexOf(foto);
    const iPanel = capas.indexOf(panel);
    const primerTexto = capas.findIndex((c) => c.type === 'text');
    expect(iPanel).toBeGreaterThan(iFoto);
    expect(primerTexto).toBeGreaterThan(iPanel);
    // La foto se ve por encima del panel (al menos un tercio de la historia).
    expect(panel.y).toBeGreaterThanOrEqual(640);
    expect(r.paginas).toBe(1);
    expect(r.desborda).toBe(false);
    // Todos los textos están dentro del panel.
    for (const t of capas.filter((c) => c.type === 'text')) expect(t.y).toBeGreaterThanOrEqual(panel.y);
  });

  it('el precio es texto dorado en negrita y mayor que los platos, sin pastilla', () => {
    for (const tipo of ['menu-dia', 'evento', 'tapa-semana'] as const) {
      const d = datosIniciales(tipo);
      d.precio = '14,50 €';
      const r = construirMenu(tipo, d, 'post', THEME, medidorEstimado);
      const capas = r.document.pages!.flatMap((p) => p.layers as Array<{ id: string; type: string; fontWeight?: number; fontSize?: number; color?: string; cornerRadius?: number }>);
      const precio = capas.find((c) => c.id.endsWith('-precio'))!;
      const plato = capas.find((c) => c.type === 'text' && c.id.includes('-plato-'))
        ?? capas.find((c) => c.id.endsWith('-descripcion'))!;
      expect(precio.fontWeight).toBe(700);
      expect(precio.fontSize!).toBeGreaterThan(plato.fontSize!);
      expect(capas.some((c) => c.id.includes('pastilla') || c.id.includes('anillo'))).toBe(false);
      expect(capas.every((c) => !(c.type === 'shape' && (c.cornerRadius ?? 0) >= 40))).toBe(true);
    }
  });

  it('el tema claro usa el fondo claro de la marca y un dorado legible; los eventos salen en claro', () => {
    expect(datosIniciales('evento').estilo).toBe('claro');
    const d = { ...datosIniciales('menu-dia'), estilo: 'claro' as const };
    const r = construirMenu('menu-dia', d, 'post', THEME, medidorEstimado);
    expect(r.document.canvas!.backgroundColor).toBe(THEME.light);
    const kicker = (r.document.pages![0]!.layers as Array<{ id: string; color?: string }>).find((c) => c.id.endsWith('-antetitulo'))!;
    expect(contrast(kicker.color!, THEME.light)).toBeGreaterThanOrEqual(4.5);
  });

  it('las etiquetas de sección van en versalitas espaciadas', () => {
    const fino = '\u2009';
    expect(espaciar('Platos fuertes')).toBe(`${[...'PLATOS'].join(fino)}${NBSP}${NBSP}${[...'FUERTES'].join(fino)}`);
  });

  it('sin logotipo en la marca, no hay capa de logotipo; con él, sí', () => {
    const sin = construirMenu('menu-dia', datosIniciales('menu-dia'), 'story', NEUTRAL_THEME, medidorEstimado);
    const con = construirMenu('menu-dia', datosIniciales('menu-dia'), 'story', THEME, medidorEstimado);
    expect((sin.document.pages![0]!.layers as Array<{ type: string }>).some((l) => l.type === 'logo')).toBe(false);
    expect((con.document.pages![0]!.layers as Array<{ type: string }>).some((l) => l.type === 'logo')).toBe(true);
  });

  it('los eventos tienen un punto de partida cada uno', () => {
    for (const p of PRESETS_EVENTO) {
      const r = construirMenu('evento', datosIniciales('evento', p.id), 'story', THEME, medidorEstimado);
      expect(r.paginas).toBe(1);
      expect(r.desborda).toBe(false);
    }
  });
});

describe('nombres propios sin partir', () => {
  it('pega con espacios duros los nombres propios y las cantidades', () => {
    expect(sinPartirNombres('Gamba blanca de Santa Pola hervida')).toBe(`Gamba blanca de Santa${NBSP}Pola hervida`);
    expect(sinPartirNombres('Salmón con manzana Granny Smith')).toBe(`Salmón con manzana Granny${NBSP}Smith`);
    expect(sinPartirNombres('Tinto Altitud 912 Crianza')).toBe(`Tinto${NBSP}Altitud${NBSP}912 Crianza`);
    expect(sinPartirNombres('1 copa en Touza Pub')).toBe(`1 copa en Touza${NBSP}Pub`);
    expect(sinPartirNombres('Cena a las 21:00 h')).toBe(`Cena a las 21:00${NBSP}h`);
    expect(sinPartirNombres('Precio 120 €')).toBe(`Precio${NBSP}120${NBSP}€`);
  });

  it('una cadena de mayúsculas no pasa de tres palabras', () => {
    const out = sinPartirNombres('Uno Dos Tres Cuatro Cinco');
    expect(out.split(' ').length).toBeGreaterThan(1);
  });
});
