// Diseños de las plantillas de menús: de lo que se escribe (`DatosMenu`) a un documento del editor.
//
// Reglas (las del restaurante, repetidas en las pruebas):
//   · Libre Baskerville, sin cursivas. Los títulos de sección y el precio, en negrita; todo lo demás, normal.
//   · Todas las líneas de un plato, del mismo color y peso (nada de segundas líneas atenuadas).
//   · Nunca texto directo sobre una foto: la foto de fondo lleva siempre un velo detrás del texto, y las
//     fotos de platos van en su marco, con el texto debajo sobre el color liso.
//   · Nombres propios sin partir (`sinPartirNombres`).
//   · Sin solapes: cada plato lleva una caja de la altura que mide su texto y se coloca debajo del anterior.
//     Si el menú no cabe a un cuerpo legible, en publicación se reparte en un carrusel (hasta 10 páginas) y
//     en historia se avisa (`desborda`): una historia es una sola imagen.
//   · La IA solo crea fondos; las fotos de platos son las reales de la biblioteca de la marca.
//
// Las fotos son marcos con la foto elegida (`frame`), así se pueden cambiar o reencuadrar en el editor.
import { contrast, mix, type Theme } from '../../../agency/catalogo/tema.ts';
import {
  DOCUMENT_SCHEMA_VERSION,
  type ContentDocumentInput,
  type DocumentPageInput,
  type LayerInput,
} from '../content/document/schema';
import {
  FUENTE_MENU,
  NBSP,
  alturaDe,
  medidorDeLienzo,
  medidorEstimado,
  partirLineas,
  sinPartirNombres,
  type Medidor,
} from './medir';
import { lineasDe, pieDePublicacion, platosDe, type DatosMenu, type FormatoMenu, type PlatoMenu, type TipoMenu } from './modelos';

export interface ResultadoMenu {
  document: ContentDocumentInput;
  paginas: number;
  /** No cabe a un cuerpo legible: en historia no se puede publicar tal cual (sería más de una imagen). */
  desborda: boolean;
  /** Cuerpo de letra de los platos (o proporción de las fotos, en tapas), para las pruebas. */
  escala: number;
}

interface Paleta {
  fondo: string;
  texto: string;
  acento: string;
  /** Dorado de los filetes y del marco. */
  filete: string;
}

interface Ctx {
  theme: Theme;
  p: Paleta;
  w: number;
  h: number;
  story: boolean;
  medir: Medidor;
  x: number;
  aw: number;
  top: number;
  bottom: number;
  /** Alto de la foto de arriba (0 si no hay foto). */
  fotoH: number;
}

interface Unidad {
  h: number;
  gap: number;
  emit: (y: number, uid: (n: string) => string) => LayerInput[];
}

const LH = 1.3;
const FUENTE = FUENTE_MENU;

function contexto(formato: FormatoMenu, theme: Theme, estilo: 'oscuro' | 'claro', medir: Medidor, conFoto: boolean): Ctx {
  const story = formato === 'story';
  const oscuro = estilo === 'oscuro';
  // El dorado del texto se oscurece sobre fondo claro hasta que se lee (contraste ≥ 4,5).
  let dorado = oscuro ? theme.accentOnDark : theme.accent;
  for (let k = 0; k < 10 && contrast(dorado, oscuro ? theme.dark : theme.light) < 4.5; k++) {
    dorado = mix(dorado, oscuro ? theme.onDark : theme.onLight, 0.15);
  }
  const p: Paleta = {
    fondo: oscuro ? theme.dark : theme.light,
    texto: oscuro ? theme.onDark : theme.onLight,
    acento: dorado,
    filete: oscuro ? theme.accentOnDark : theme.accent,
  };
  // Zona segura de las historias: 250 px arriba y 340 abajo. En la publicación, margen de 100 px.
  // Con foto, la parte de arriba (≈ 36 %) es de la foto, nítida, y el texto empieza debajo, sobre el panel.
  const base = story
    ? { theme, p, w: 1080, h: 1920, story, medir, x: 100, aw: 880, top: 262, bottom: 1580, fotoH: 0 }
    : { theme, p, w: 1080, h: 1350, story, medir, x: 100, aw: 880, top: 100, bottom: 1250, fotoH: 0 };
  if (!conFoto) return base;
  const fotoH = story ? 700 : 480;
  return { ...base, top: fotoH + 50, bottom: story ? 1580 : 1290, fotoH };
}

// ───────────────────────────── Capas ─────────────────────────────

function rect(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string | null,
  extra: { opacity?: number; radius?: number; stroke?: { color: string; width: number }; rotation?: number; name?: string } = {},
): LayerInput {
  return {
    id,
    name: extra.name ?? '',
    type: 'shape',
    shape: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    fill,
    ...(extra.stroke ? { stroke: extra.stroke } : {}),
    ...(extra.opacity !== undefined ? { opacity: extra.opacity } : {}),
    ...(extra.radius !== undefined ? { cornerRadius: extra.radius } : {}),
    ...(extra.rotation ? { rotation: extra.rotation } : {}),
  };
}

function foto(id: string, x: number, y: number, w: number, h: number, assetId: string, name: string): LayerInput {
  return {
    id,
    name,
    type: 'image',
    source: { kind: 'asset', assetId },
    frame: true,
    fit: 'cover',
    x,
    y,
    width: w,
    height: h,
    anchor: { x: 'stretch', y: 'stretch' },
  };
}

interface OpcionesTexto {
  size: number;
  weight?: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  upper?: boolean;
  name?: string;
}

/** Un texto con su caja a la medida: parte los nombres propios sin romperlos y devuelve su altura. */
function texto(
  ctx: Ctx,
  id: string,
  x: number,
  y: number,
  w: number,
  valor: string,
  o: OpcionesTexto,
): { layer: LayerInput; h: number; lineas: number } {
  const weight = o.weight ?? 400;
  const final = sinPartirNombres(o.upper ? valor.toLocaleUpperCase('es') : valor);
  const lineas = partirLineas(final, w, o.size, weight, ctx.medir).length;
  const h = alturaDe(lineas, o.size, LH) + 2;
  return {
    h,
    lineas,
    layer: {
      id,
      name: o.name ?? '',
      type: 'text',
      x,
      y,
      width: w,
      height: h,
      text: final,
      fontFamily: FUENTE,
      fontSize: o.size,
      fontWeight: weight,
      italic: false,
      color: o.color,
      align: o.align ?? 'center',
      lineHeight: LH,
      anchor: { x: 'left', y: 'top' },
    },
  };
}

/** Altura de un texto sin crear su capa. */
function altoTexto(ctx: Ctx, valor: string, w: number, size: number, weight: number, upper = false): number {
  const final = sinPartirNombres(upper ? valor.toLocaleUpperCase('es') : valor);
  return alturaDe(partirLineas(final, w, size, weight, ctx.medir).length, size, LH) + 2;
}

// ───────────────────────────── Fondo y marco ─────────────────────────────

type ModoFoto = 'ninguna' | 'banda' | 'completa';

/** Alto del degradado entre la foto y el panel de texto. */
const DEGRADADO = 144;

function fondoDePagina(ctx: Ctx, pid: string, d: DatosMenu, modo: ModoFoto): LayerInput[] {
  const { p, w, h } = ctx;
  const layers: LayerInput[] = [rect(`${pid}-fondo`, 0, 0, w, h, p.fondo, { name: 'Fondo' })];
  if (modo === 'completa' && d.foto) {
    // Eventos: la foto o el fondo de IA, a sangre y nítido; el texto va en una tarjeta lisa (ver `ensamblar`).
    layers.push(foto(`${pid}-foto-fondo`, 0, 0, w, h, d.foto, 'Fondo'));
    return layers;
  }
  if (modo === 'banda' && d.foto) {
    // La foto, nítida y a sangre; el texto va en un panel liso debajo (ver `panelDeTexto`).
    layers.push(foto(`${pid}-foto-fondo`, 0, 0, w, ctx.fotoH + DEGRADADO, d.foto, 'Foto'));
    return layers;
  }
  // Sin foto: doble filete dorado, dentro de la zona segura de la historia.
  const fy = ctx.story ? 210 : 40;
  const fh = ctx.story ? 1420 : h - 80;
  layers.push(
    rect(`${pid}-marco`, 40, fy, w - 80, fh, null, { stroke: { color: p.filete, width: 3 }, name: 'Marco' }),
    rect(`${pid}-marco-int`, 54, fy + 14, w - 108, fh - 28, null, {
      stroke: { color: p.filete, width: 1.5 },
      opacity: 0.6,
      name: 'Marco interior',
    }),
  );
  return layers;
}

/** Panel liso de marca bajo el texto, con un degradado suave hacia la foto (tiras con opacidad creciente). */
function panelDeTexto(ctx: Ctx, pid: string, top: number): LayerInput[] {
  const strips = 24;
  const step = DEGRADADO / strips;
  const layers: LayerInput[] = [];
  for (let i = 0; i < strips; i++) {
    layers.push(
      rect(`${pid}-degradado-${i + 1}`, 0, top - (strips - i) * step, ctx.w, step, ctx.p.fondo, {
        opacity: (i + 1) / (strips + 1),
        name: 'Degradado',
      }),
    );
  }
  layers.push(rect(`${pid}-panel`, 0, top, ctx.w, ctx.h - top, ctx.p.fondo, { name: 'Panel del texto' }));
  layers.push(rect(`${pid}-panel-filete`, ctx.w / 2 - 60, top + 18, 120, 3, ctx.p.filete, { name: 'Filete' }));
  return layers;
}

// ───────────────────────────── Cabecera y pie ─────────────────────────────

interface Bloque {
  h: number;
  colocar: (y: number, uid: (n: string) => string) => LayerInput[];
}

function cabecera(
  ctx: Ctx,
  d: DatosMenu,
  compacta: { pagina: number; total: number } | null,
  maxTitulo: number,
): Bloque {
  const { p, theme, x, aw } = ctx;
  const logo = !compacta && theme.logo && ctx.fotoH === 0 ? { assetId: theme.logo, h: 80, gap: 14 } : null;
  const kicker = compacta ? `${compacta.pagina} / ${compacta.total}` : d.kicker.trim();
  const kickerSize = ctx.story ? 28 : 26;
  const kickerH = kicker ? altoTexto(ctx, kicker, aw, kickerSize, 700, true) + 8 : 0;
  // El título, lo más grande que quepa en dos líneas.
  let titleSize = compacta ? 44 : maxTitulo;
  const titulo = d.titulo.trim();
  if (titulo) {
    while (titleSize > 36 && partirLineas(sinPartirNombres(titulo), aw, titleSize, 400, ctx.medir).length > 2) titleSize -= 4;
  }
  const titleH = titulo ? altoTexto(ctx, titulo, aw, titleSize, 400) : 0;
  const rombo = compacta || ctx.fotoH > 0 ? 0 : 32;
  const h = (logo ? logo.h + logo.gap : 0) + kickerH + titleH + rombo;
  return {
    h,
    colocar: (y0, uid) => {
      const out: LayerInput[] = [];
      let y = y0;
      if (logo) {
        out.push({
          id: uid('logo'),
          name: 'Logotipo',
          type: 'logo',
          assetId: logo.assetId,
          x: (ctx.w - 240) / 2,
          y,
          width: 240,
          height: logo.h,
          anchor: { x: 'center', y: 'top' },
        });
        y += logo.h + logo.gap;
      }
      if (kicker) {
        const k = texto(ctx, uid('antetitulo'), x, y, aw, kicker, {
          size: kickerSize,
          weight: 700,
          color: p.acento,
          upper: true,
          name: 'Antetítulo',
        });
        out.push(k.layer);
        y += kickerH;
      }
      if (titulo) {
        const t = texto(ctx, uid('titulo'), x, y, aw, titulo, { size: titleSize, color: p.texto, name: 'Título' });
        out.push(t.layer);
        y += titleH;
      }
      if (!compacta && ctx.fotoH === 0) out.push(rect(uid('rombo'), ctx.w / 2 - 7, y + 10, 14, 14, p.acento, { rotation: 45, name: 'Adorno' }));
      return out;
    },
  };
}

function pie(ctx: Ctx, precio: string, lineas: string[]): Bloque {
  const { p, aw, x } = ctx;
  const size = ctx.story ? 30 : 28;
  // El precio, sin pastilla: texto dorado en negrita, algo mayor que los platos.
  const priceSize = ctx.story ? 56 : 52;
  const precioTxt = sinPartirNombres(precio.trim());
  const priceH = precioTxt ? altoTexto(ctx, precioTxt, aw, priceSize, 700) : 0;
  const priceBlock = precioTxt ? priceH + 14 : 0;
  const alturas = lineas.map((l) => altoTexto(ctx, l, aw, size, 400));
  const gap = 8;
  const h = priceBlock + alturas.reduce((s, a) => s + a, 0) + Math.max(0, lineas.length - 1) * gap;
  return {
    h,
    colocar: (y0, uid) => {
      const out: LayerInput[] = [];
      let y = y0;
      if (precioTxt) {
        out.push(texto(ctx, uid('precio'), x, y, aw, precioTxt, { size: priceSize, weight: 700, color: p.acento, name: 'Precio' }).layer);
        y += priceBlock;
      }
      lineas.forEach((l, i) => {
        const t = texto(ctx, uid(`pie-${i + 1}`), x, y, aw, l, { size, color: p.texto, name: 'Pie' });
        out.push(t.layer);
        y += alturas[i]! + gap;
      });
      return out;
    },
  };
}

// ───────────────────────────── Empaquetado en páginas ─────────────────────────────

const sumar = (us: Unidad[]) => us.reduce((s, u, i) => s + u.h + (i > 0 ? u.gap : 0), 0);

/**
 * Reparte las unidades en páginas, de arriba abajo, sin partir una unidad. `capacidad(i)` es la altura
 * que queda en la página `i` (tras su cabecera); la última, además, deja sitio al pie.
 */
function empaquetar(unidades: Unidad[], capacidad: (i: number) => number, alturaPie: number): { paginas: Unidad[][]; desborda: boolean } {
  const paginas: Unidad[][] = [[]];
  let usado = 0;
  let desborda = false;
  for (const u of unidades) {
    const i = paginas.length - 1;
    const hace = (paginas[i]!.length > 0 ? u.gap : 0) + u.h;
    if (paginas[i]!.length > 0 && usado + hace > capacidad(i)) {
      paginas.push([u]);
      usado = u.h;
      if (u.h > capacidad(i + 1)) desborda = true;
    } else {
      paginas[i]!.push(u);
      usado += hace;
      if (u.h > capacidad(i)) desborda = true;
    }
  }
  // La última página ha de dejar sitio al pie: si no, su última unidad pasa a una página nueva.
  for (;;) {
    const i = paginas.length - 1;
    const ultima = paginas[i]!;
    if (sumar(ultima) <= capacidad(i) - alturaPie || ultima.length <= 1) break;
    paginas.push([ultima.pop()!]);
  }
  return { paginas, desborda };
}

interface Plan {
  /** De la más grande a la más pequeña: cuerpo de letra (listas) o proporción de las fotos (tapas). */
  escalas: number[];
  /** Escala con la que se reparte en carrusel si no cabe en una página. */
  paginar: number;
  unidades: (escala: number) => Unidad[];
  /** Hay foto de fondo: el texto va en un panel liso en la parte de abajo. */
  modoFoto: ModoFoto;
  maxTitulo: number;
  pie: string[];
  precio: string;
}

const MAX_PAGINAS = 10;
const GAP_CABECERA = 30;
const GAP_PIE = 40;

function ensamblar(ctx: Ctx, d: DatosMenu, plan: Plan): { paginas: DocumentPageInput[]; desborda: boolean; escala: number } {
  const head = cabecera(ctx, d, null, plan.maxTitulo);
  const foot = pie(ctx, plan.precio, plan.pie);
  const rango = ctx.bottom - ctx.top;
  const capUna = rango - head.h - GAP_CABECERA - (foot.h ? foot.h + GAP_PIE : 0);

  let escala = plan.escalas[0]!;
  let paginas: Unidad[][] | null = null;
  let desborda = false;
  for (const e of plan.escalas) {
    const us = plan.unidades(e);
    if (sumar(us) <= capUna) {
      paginas = [us];
      escala = e;
      break;
    }
  }
  if (!paginas) {
    // No cabe en una página a un cuerpo legible.
    const e = ctx.story ? plan.escalas[plan.escalas.length - 1]! : plan.paginar;
    escala = e;
    const us = plan.unidades(e);
    const mini = (n: number) => cabecera(ctx, d, { pagina: n, total: 2 }, plan.maxTitulo).h;
    const cap = (i: number) => rango - (i === 0 ? head.h : mini(i + 1)) - GAP_CABECERA;
    const r = empaquetar(us, cap, foot.h ? foot.h + GAP_PIE : 0);
    paginas = r.paginas;
    desborda = r.desborda || ctx.story || r.paginas.length > MAX_PAGINAS;
  }

  const total = paginas.length;
  const out: DocumentPageInput[] = paginas.map((unidades, i) => {
    const pid = `p${i + 1}`;
    const uid = (n: string) => `${pid}-${n}`;
    const primera = i === 0;
    const ultima = i === total - 1;
    const cab = primera ? head : cabecera(ctx, d, { pagina: i + 1, total }, plan.maxTitulo);
    const cuerpo = sumar(unidades);
    const bloque = cab.h + GAP_CABECERA + cuerpo + (ultima && foot.h ? GAP_PIE + foot.h : 0);
    // Una sola página con poco texto: el bloque se centra en la zona libre (un poco hacia arriba).
    const libre = rango - bloque;
    // Con foto, el texto va abajo y la foto se ve entera arriba.
    const y0 = ctx.top + (total === 1 ? Math.max(0, libre * (plan.modoFoto === 'banda' ? 0.3 : 0.45)) : 0);
    const layers: LayerInput[] = [...fondoDePagina(ctx, pid, d, plan.modoFoto)];
    if (plan.modoFoto === 'banda') layers.push(...panelDeTexto(ctx, pid, ctx.fotoH));
    if (plan.modoFoto === 'completa') {
      layers.push(
        rect(uid('tarjeta'), ctx.x - 50, y0 - 46, ctx.aw + 100, bloque + 92, ctx.p.fondo, {
          opacity: 0.97,
          radius: 36,
          stroke: { color: ctx.p.filete, width: 3 },
          name: 'Tarjeta del texto',
        }),
      );
    }
    layers.push(...cab.colocar(y0, uid));
    let y = y0 + cab.h + GAP_CABECERA;
    unidades.forEach((u, k) => {
      if (k > 0) y += u.gap;
      layers.push(...u.emit(y, (n) => `${pid}-${n}`));
      y += u.h;
    });
    if (ultima && foot.h) layers.push(...foot.colocar(y + GAP_PIE, uid));
    return { id: pid, name: total > 1 ? `Página ${i + 1}` : 'Menú', layers };
  });
  return { paginas: out, desborda, escala };
}

// ───────────────────────────── Listas (menú del día, vinos, eventos) ─────────────────────────────

/**
 * Título de sección en versalitas espaciadas (como la minuta): mayúsculas con un espacio fino entre letras y
 * un hueco más ancho entre palabras. El texto del documento ya lleva el espaciado (no hay interletraje en el esquema).
 */
export function espaciar(titulo: string): string {
  return titulo
    .toLocaleUpperCase('es')
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) => [...palabra].join('\u2009'))
    .join(`${NBSP}${NBSP}`);
}

interface SeccionLista {
  titulo: string;
  platos: PlatoMenu[];
}

function unidadesLista(ctx: Ctx, secciones: SeccionLista[], s: number): Unidad[] {
  const { p, aw, x } = ctx;
  const unidades: Unidad[] = [];
  const conPrecio = secciones.some((sec) => sec.platos.some((pl) => pl.precio));
  const labelSize = Math.round(s * 0.66);
  const labelH = Math.ceil(labelSize * LH) + 2;
  const gapLabel = Math.round(s * 0.5);
  const precioSize = Math.round(s * 1.1);
  const priceW = conPrecio
    ? Math.min(
        aw * 0.4,
        Math.max(0, ...secciones.flatMap((sec) => sec.platos.map((pl) => (pl.precio ? ctx.medir(sinPartirNombres(pl.precio), precioSize, 700) : 0)))) + 8,
      )
    : 0;
  const nameW = conPrecio ? aw - priceW - 28 : aw;

  secciones.forEach((sec, si) => {
    sec.platos.forEach((pl, pi) => {
      const nameH = altoTexto(ctx, pl.texto, nameW, s, 400);
      const conEtiqueta = pi === 0 && sec.titulo.trim() !== '';
      const itemEmit = (y: number, uid: (n: string) => string): LayerInput[] => {
        const t = texto(ctx, uid(`plato-${si + 1}-${pi + 1}`), x, y, nameW, pl.texto, {
          size: s,
          color: p.texto,
          align: conPrecio ? 'left' : 'center',
          name: 'Plato',
        });
        const out = [t.layer];
        if (pl.precio) {
          const pr = texto(ctx, uid(`precio-${si + 1}-${pi + 1}`), x + aw - priceW, y, priceW, pl.precio, {
            size: precioSize,
            weight: 700,
            color: p.acento,
            align: 'right',
            name: 'Precio del plato',
          });
          out.push(pr.layer);
        }
        return out;
      };
      if (!conEtiqueta) {
        unidades.push({ h: nameH, gap: Math.round(s * 0.75), emit: itemEmit });
        return;
      }
      unidades.push({
        h: labelH + gapLabel + nameH,
        gap: si === 0 ? 0 : Math.round(s * 1.25),
        emit: (y, uid) => {
          const out: LayerInput[] = [];
          const label = espaciar(sec.titulo.trim());
          const lw = Math.min(aw - 120, ctx.medir(label, labelSize, 700) + 6);
          const lx = ctx.w / 2 - lw / 2;
          const lineY = y + labelH / 2;
          const side = (aw - lw) / 2 - 22;
          if (side > 30) {
            out.push(
              rect(uid(`filete-${si + 1}a`), x, lineY, side, 2, p.filete, { opacity: 0.75, name: 'Filete' }),
              rect(uid(`filete-${si + 1}b`), x + aw - side, lineY, side, 2, p.filete, { opacity: 0.75, name: 'Filete' }),
            );
          }
          out.push(
            texto(ctx, uid(`seccion-${si + 1}`), lx - 10, y, lw + 20, label, {
              size: labelSize,
              weight: 700,
              color: p.acento,
              name: sec.titulo.trim(),
            }).layer,
          );
          out.push(...itemEmit(y + labelH + gapLabel, uid));
          return out;
        },
      });
    });
  });
  return unidades;
}

function planLista(ctx: Ctx, d: DatosMenu, evento: boolean): Plan {
  const secciones: SeccionLista[] = d.secciones
    .map((s) => ({ titulo: s.titulo, platos: platosDe(s) }))
    .filter((s) => s.platos.length > 0);
  const tamanos: number[] = [];
  const max = ctx.story ? 42 : 38;
  const min = evento || ctx.fotoH > 0 ? 26 : 28;
  for (let s = max; s >= min; s -= 2) tamanos.push(s);
  return {
    escalas: tamanos,
    paginar: evento ? 28 : 32,
    unidades: (s) => unidadesLista(ctx, secciones, s),
    modoFoto: ctx.fotoH > 0 ? 'banda' : evento && Boolean(d.foto) ? 'completa' : 'ninguna',
    maxTitulo: ctx.fotoH > 0 ? (ctx.story ? 64 : 56) : ctx.story ? 80 : 68,
    pie: lineasDe(d.pie),
    precio: d.precio,
  };
}

// ───────────────────────────── Tapas (rejilla de fotos) ─────────────────────────────

function planTapas(ctx: Ctx, d: DatosMenu): Plan {
  const tapas = d.tapas.filter((t) => t.nombre.trim());
  const cols = tapas.length === 1 ? 1 : 2;
  const gapX = 30;
  const cw = cols === 1 ? 600 : (ctx.aw - gapX) / 2;
  const s = ctx.story ? 32 : 30;
  const unidades = (aspecto: number): Unidad[] => {
    const filas: (typeof tapas)[] = [];
    for (let i = 0; i < tapas.length; i += cols) filas.push(tapas.slice(i, i + cols));
    return filas.map((fila, fi) => {
      const tarjetas = fila.map((t) => {
        const fotoH = t.foto ? Math.round(cw * aspecto) : 0;
        const linea = t.nombre.trim();
        const precio = t.precio.trim();
        const th = altoTexto(ctx, linea, cw, s, 400);
        const ph = precio ? altoTexto(ctx, precio, cw, s + 4, 700) : 0;
        return { t, fotoH, linea, precio, th, ph, h: fotoH + (fotoH ? 14 : 0) + th + (ph ? 4 + ph : 0) };
      });
      const h = Math.max(...tarjetas.map((c) => c.h));
      return {
        h,
        gap: 34,
        emit: (y, uid) => {
          const out: LayerInput[] = [];
          tarjetas.forEach((c, ci) => {
            const cx = cols === 1 ? ctx.x + (ctx.aw - cw) / 2 : ctx.x + ci * (cw + gapX);
            const n = fi * cols + ci + 1;
            if (c.t.foto) out.push(foto(uid(`foto-${n}`), cx, y, cw, c.fotoH, c.t.foto, `Foto de la tapa ${n}`));
            out.push(
              texto(ctx, uid(`tapa-${n}`), cx, y + c.fotoH + (c.fotoH ? 14 : 0), cw, c.linea, {
                size: s,
                color: ctx.p.texto,
                align: 'center',
                name: `Tapa ${n}`,
              }).layer,
            );
            if (c.precio) {
              out.push(
                texto(ctx, uid(`precio-${n}`), cx, y + c.fotoH + (c.fotoH ? 14 : 0) + c.th + 4, cw, c.precio, {
                  size: s + 4,
                  weight: 700,
                  color: ctx.p.acento,
                  align: 'center',
                  name: `Precio de la tapa ${n}`,
                }).layer,
              );
            }
          });
          return out;
        },
      };
    });
  };
  return {
    escalas: [1.15, 1.05, 0.95, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 0.42],
    paginar: 0.7,
    unidades,
    modoFoto: 'ninguna',
    maxTitulo: ctx.story ? 80 : 68,
    pie: lineasDe(d.pie),
    precio: d.precio,
  };
}

// ───────────────────────────── Tapa de la semana ─────────────────────────────

function paginaTapaSemana(ctx: Ctx, d: DatosMenu): { paginas: DocumentPageInput[]; desborda: boolean; escala: number } {
  const pid = 'p1';
  const uid = (n: string) => `${pid}-${n}`;
  const head = cabecera(ctx, d, null, ctx.story ? 76 : 64);
  const foot = pie(ctx, d.precio, lineasDe(d.pie));
  const rango = ctx.bottom - ctx.top;
  const desc = d.descripcion.trim();
  let size = ctx.story ? 36 : 32;
  while (size > 26 && desc && altoTexto(ctx, desc, ctx.aw - 40, size, 400) > (ctx.story ? 260 : 190)) size -= 2;
  const descH = desc ? altoTexto(ctx, desc, ctx.aw - 40, size, 400) : 0;
  const fijo = head.h + GAP_CABECERA + (descH ? descH + 30 : 0) + (foot.h ? GAP_PIE + foot.h : 0);
  const fotoH = d.foto ? Math.max(240, Math.min(780, rango - fijo - 24)) : 0;
  const desborda = Boolean(d.foto) && rango - fijo - 24 < 240;
  const bloque = fijo + (fotoH ? fotoH + 24 : 0);
  const y0 = ctx.top + Math.max(0, (rango - bloque) * 0.4);
  const layers: LayerInput[] = [...fondoDePagina(ctx, pid, d, 'ninguna'), ...head.colocar(y0, uid)];
  let y = y0 + head.h + GAP_CABECERA;
  if (d.foto) {
    layers.push(foto(uid('foto'), ctx.x, y, ctx.aw, fotoH, d.foto, 'Foto de la tapa'));
    y += fotoH + 24;
  }
  if (desc) {
    layers.push(texto(ctx, uid('descripcion'), ctx.x + 20, y, ctx.aw - 40, desc, { size, color: ctx.p.texto, name: 'Descripción' }).layer);
    y += descH + 30;
  }
  if (foot.h) layers.push(...foot.colocar(y + (desc ? 0 : 10), uid));
  return { paginas: [{ id: pid, name: 'Tapa de la semana', layers }], desborda, escala: size };
}

// ───────────────────────────── Entrada ─────────────────────────────

/** Medidor del navegador con la letra de los menús, o la estimación si no hay lienzo (pruebas). */
export function medidorDeMenus(): Medidor {
  return medidorDeLienzo(FUENTE) ?? medidorEstimado;
}

/**
 * El documento de un menú: una página (historia o publicación) o un carrusel si el menú es largo y es
 * una publicación. Los textos se escriben a partir de `datos`; las fotos, las que se hayan elegido.
 */
export function construirMenu(
  tipo: TipoMenu,
  datos: DatosMenu,
  formato: FormatoMenu,
  theme: Theme,
  medir: Medidor = medidorDeMenus(),
): ResultadoMenu {
  const conFoto = Boolean(datos.foto) && (tipo === 'menu-dia' || tipo === 'vinos');
  const ctx = contexto(formato, theme, datos.estilo, medir, conFoto);
  const r =
    tipo === 'tapa-semana'
      ? paginaTapaSemana(ctx, datos)
      : ensamblar(ctx, datos, tipo === 'tapas' ? planTapas(ctx, datos) : planLista(ctx, datos, tipo === 'evento'));
  const alt = pieDePublicacion(tipo, datos);
  const document: ContentDocumentInput = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    canvas: {
      aspectRatio: ctx.story ? '9:16' : '4:5',
      width: ctx.w,
      height: ctx.h,
      backgroundColor: ctx.p.fondo,
    },
    pages: r.paginas,
    copy: {
      caption: alt,
      hashtags: [],
      mentions: [],
      altText: alt.replace(/\n/g, '. ').slice(0, 1000),
      callToAction: { label: '', url: '' },
    },
  };
  return { document, paginas: r.paginas.length, desborda: r.desborda, escala: r.escala };
}
