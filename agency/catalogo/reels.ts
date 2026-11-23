// Estructuras de reel del catálogo: funciones que, con el tema de una marca y
// las palabras de su sector, devuelven una plantilla de reel (el formato
// compartido de src/features/reels/reelTemplate.ts): planos con su duración,
// movimiento y transición, textos de muestra con su animación, música sugerida
// (solo escrita: nunca una canción) y portada.
//
// Reglas comunes, sacadas del estudio (docs/plantillas-competencia.md):
//   · gancho con texto en el primer plano, que dura 1,5–2,5 s;
//   · el resultado va primero y el proceso después;
//   · planos de 1–3 s salvo cuando alguien habla o el plano es el protagonista;
//   · textos de 2 a 6 palabras, fuera de lo que tapa Instagram (250 px arriba,
//     400 px abajo y 60 px a los lados en 1080 × 1920): «abajo» es aquí un 26 %
//     de margen, y el trabajador no deja pasar nada de esas zonas;
//   · letra que se lee en un móvil: titular ≈ 100 px, rótulo ≈ 70 px en caja,
//     llamada ≈ 84 px en caja del acento de la marca (docs/reels-calidad.md);
//   · ritmo: planos de 0,6 a 1,8 s (el gancho, de los más cortos), corte seco con
//     golpe de zoom y algún barrido; los planos de producto de 1,6 s o más cortan
//     a mitad a un detalle (lo hace el trabajador); movimiento del 10–12 %;
//   · cada plano con su rótulo (el nombre del plato sale del archivo si lo dice);
//   · una sola llamada al final;
//   · la portada sale de un plano que aguanta el recorte de la cuadrícula.
import type { ReelSlot, ReelTemplateInput, ReelTemplateText } from '../../src/features/reels/reelTemplate.ts';
import type { Theme } from './tema.ts';

type SlotInput = Omit<ReelSlot, 'kind'> & { kind?: ReelSlot['kind'] };
type TextInput = Omit<ReelTemplateText, 'role'> & { role: ReelTemplateText['role'] };
type Style = NonNullable<ReelTemplateText['style']>;
type Document = ReelTemplateInput;

export const KIND = 'rrss.reel-template' as const;

/** Música: siempre una descripción, nunca un archivo. */
export const MUSIC = {
  pulso:
    'Instrumental con el pulso muy marcado (100–125 pulsaciones por minuto). De la colección de sonidos de Meta o con licencia propia; mejor que una canción de moda.',
  calma:
    'Instrumental tranquilo (70–95 pulsaciones por minuto), sin voz. De la colección de sonidos de Meta o con licencia propia.',
  energia:
    'Instrumental rápido y con golpe (125–150 pulsaciones por minuto). De la colección de sonidos de Meta o con licencia propia.',
  ambiente: 'Sin música: el sonido real del sitio es el protagonista. Sube el volumen de los clips.',
  voz: 'Sin música o muy baja por debajo de la voz (un 10–15 %): lo que importa es lo que se dice. Activa los subtítulos.',
} as const;

/** Estilos de texto con los colores de la marca por papel. La tipografía la pone la marca al montar. */
export function estilos(theme: Theme) {
  /** Titular grueso, grande, con contorno fino y la sombra que pone el trabajador. */
  const gancho: Style = {
    sizeRatio: 0.095,
    color: theme.onDark,
    marginRatio: 0.2,
    maxWidthRatio: 0.82,
    lineHeight: 1.1,
    box: null,
    outline: { color: theme.dark, widthRatio: 0.04 },
    fadeSeconds: 0.25,
  };
  /** Rótulo en caja oscura de la marca: se lee sobre cualquier foto. */
  const rotulo: Style = {
    sizeRatio: 0.064,
    color: theme.onDark,
    marginRatio: 0.16,
    maxWidthRatio: 0.8,
    lineHeight: 1.45,
    box: { color: theme.dark, opacity: 0.85, paddingRatio: 0.3 },
    outline: null,
    fadeSeconds: 0.25,
  };
  /** Llamada o dato en caja del acento de la marca. */
  const acento: Style = {
    sizeRatio: 0.078,
    color: theme.onAccent,
    marginRatio: 0.26,
    maxWidthRatio: 0.82,
    lineHeight: 1.3,
    box: { color: theme.accent, opacity: 1, paddingRatio: 0.4 },
    outline: null,
    fadeSeconds: 0.25,
  };
  /** Texto de abajo, por encima de lo que tapa Instagram. */
  const pie: Style = { ...rotulo, marginRatio: 0.26 };
  return { gancho, rotulo, acento, pie };
}

const cut = { type: 'cut', seconds: 0 } as const;
// Transiciones cortas: corte seco casi siempre; un barrido o un fundido rápido de vez en cuando.
const fade = (seconds = 0.3) => ({ type: 'fade', seconds }) as const;
const slide = (seconds = 0.25) => ({ type: 'slideleft', seconds }) as const;
const up = (seconds = 0.25) => ({ type: 'slideup', seconds }) as const;

const ZOOM = { in: 'zoom', out: 'fade', seconds: 0.4 } as const;
const RISE = { in: 'rise', out: 'fade', seconds: 0.4 } as const;
const SLIDE = { in: 'slide', out: 'slide', seconds: 0.35 } as const;
const TYPE = { in: 'typewriter', out: 'fade' } as const;
const FADE = { in: 'fade', out: 'fade', seconds: 0.4 } as const;

/** «4 a 6 fotos o clips: resultado, paso 1…». */
function material(slots: SlotInput[], note = ''): string {
  const min = slots.filter((slot) => !slot.optional).length;
  const kinds = new Set(slots.map((slot) => slot.kind ?? 'any'));
  const what =
    kinds.size === 1 && kinds.has('photo')
      ? 'fotos'
      : kinds.size === 1 && kinds.has('video')
        ? 'clips de vídeo'
        : 'fotos o clips';
  const count = min === slots.length ? `${min}` : `${min} a ${slots.length}`;
  const labels = slots.map((slot) => slot.label.toLocaleLowerCase('es')).join(', ');
  return `${count} ${what}, en este orden: ${labels}.${note ? ` ${note}` : ''}`.slice(0, 240);
}

interface Base {
  purpose: string;
  whenToUse: string;
  style: 'corte-ritmico' | 'fundido-suave' | 'pase-lateral';
  slots: SlotInput[];
  texts: TextInput[];
  music: { suggestion: string; bpm?: { min: number; max: number }; cutsOnBeat?: boolean };
  cover: { slot: string; offset?: number };
  note?: string;
}

function build(base: Base): Document {
  return {
    kind: KIND,
    schemaVersion: 1,
    purpose: base.purpose,
    whenToUse: base.whenToUse,
    material: material(base.slots, base.note),
    style: { id: base.style },
    slots: base.slots.map((slot) => ({ kind: 'any' as const, ...slot })),
    texts: base.texts,
    music: base.music,
    cover: base.cover,
    origin: { note: 'Catálogo de plantillas (docs/plantillas-competencia.md).' },
  };
}

// ───────────────────────────── Estructuras ─────────────────────────────

/** Resultado primero, luego el proceso en planos cortos y vuelta al resultado. */
export function asiSeHace(
  theme: Theme,
  w: {
    purpose: string;
    when: string;
    hook: string;
    result: string;
    steps: [string, string, string, string];
    end: string;
    cta: string;
  },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      {
        id: 'resultado',
        label: w.result,
        hint: 'El mejor plano que tengas: es el gancho.',
        seconds: 1.2,
        motion: 'zoom-in',
        motionAmount: 0.12,
      },
      { id: 'paso1', label: w.steps[0], seconds: 1.3, transition: cut },
      { id: 'paso2', label: w.steps[1], seconds: 1.7, motion: 'zoom-in', transition: cut },
      { id: 'paso3', label: w.steps[2], seconds: 1.3, transition: slide(), optional: true },
      { id: 'paso4', label: w.steps[3], seconds: 1.7, motion: 'zoom-in', transition: cut, optional: true },
      {
        id: 'final',
        label: w.end,
        hint: 'El plato en la mesa: se corta a un detalle a mitad del plano.',
        seconds: 1.8,
        motion: 'zoom-in',
        motionAmount: 0.1,
        transition: cut,
      },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'resultado',
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      // Cada paso con su rótulo, para que el reel cuente el proceso.
      ...([1, 2, 3, 4] as const).map(
        (n): TextInput => ({
          id: `rotulo${n}`,
          role: 'step',
          text: w.steps[n - 1]!,
          from: `paso${n}`,
          offset: 0.1,
          position: 'bottom',
          style: e.pie,
          animation: RISE,
        }),
      ),
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.4,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.pulso, bpm: { min: 100, max: 125 }, cutsOnBeat: true },
    cover: { slot: 'resultado', offset: 0.9 },
  });
}

/** Un solo protagonista, muy de cerca y con su sonido: pocos planos y largos. */
export function deCerca(
  theme: Theme,
  w: { purpose: string; when: string; name: string; shots: [string, string, string]; cta: string },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      {
        id: 'plano1',
        label: w.shots[0],
        kind: 'video',
        hint: 'Muy cerca y con el móvil quieto: que se oiga.',
        seconds: 4,
        volume: 1,
      },
      { id: 'plano2', label: w.shots[1], kind: 'video', seconds: 5, volume: 1, transition: cut },
      { id: 'plano3', label: w.shots[2], kind: 'video', seconds: 4, volume: 1, transition: cut, optional: true },
      { id: 'final', label: 'Listo para servir', kind: 'video', seconds: 3.5, volume: 0.8, transition: fade(0.3) },
    ],
    texts: [
      {
        id: 'nombre',
        role: 'title',
        text: w.name,
        from: 'plano1',
        offset: 0.3,
        endOffset: -0.5,
        position: 'top',
        style: e.rotulo,
        animation: FADE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.5,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.ambiente },
    cover: { slot: 'final', offset: 1 },
    note: 'Mejor vídeo con sonido que fotos.',
  });
}

/** Lista corta: gancho con la promesa y un motivo por plano, numerado. */
export function tresMotivos(
  theme: Theme,
  w: {
    purpose: string;
    when: string;
    hook: string;
    opener: string;
    items: [string, string, string];
    labels: [string, string, string];
    cta: string;
  },
): Document {
  const e = estilos(theme);
  const item = (n: 1 | 2 | 3): TextInput => ({
    id: `motivo${n}`,
    role: 'step',
    text: `${n}. ${w.items[n - 1]}`,
    from: `motivo${n}`,
    offset: 0.2,
    position: 'top',
    style: e.rotulo,
    animation: SLIDE,
  });
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'pase-lateral',
    slots: [
      { id: 'gancho', label: w.opener, seconds: 2.2, motion: 'zoom-in', motionAmount: 0.12 },
      { id: 'motivo1', label: w.labels[0], seconds: 3, transition: slide() },
      { id: 'motivo2', label: w.labels[1], seconds: 3, transition: slide() },
      { id: 'motivo3', label: w.labels[2], seconds: 3, transition: slide() },
      {
        id: 'final',
        label: 'Cierre',
        hint: 'La fachada, la sala o el producto estrella.',
        seconds: 3,
        transition: fade(0.4),
      },
    ],
    texts: [
      {
        id: 'titulo',
        role: 'hook',
        text: w.hook,
        from: 'gancho',
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      item(1),
      item(2),
      item(3),
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.4,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.pulso, bpm: { min: 95, max: 120 } },
    cover: { slot: 'gancho', offset: 1 },
  });
}

/** Receta o proceso con los pasos rotulados: resultado, cuatro pasos y remate. */
export function enCuatroPasos(
  theme: Theme,
  w: {
    purpose: string;
    when: string;
    hook: string;
    result: string;
    steps: [string, string, string, string];
    end: string;
    cta: string;
  },
): Document {
  const e = estilos(theme);
  const paso = (n: 1 | 2 | 3 | 4): TextInput => ({
    id: `paso${n}`,
    role: 'step',
    text: `${n} · ${w.steps[n - 1]}`,
    from: `paso${n}`,
    offset: 0.15,
    position: 'top',
    style: e.rotulo,
    animation: RISE,
  });
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      { id: 'resultado', label: w.result, seconds: 1.8, motion: 'zoom-in', motionAmount: 0.12 },
      { id: 'paso1', label: `Paso 1: ${w.steps[0]}`, kind: 'video', seconds: 2.6, volume: 0.7, transition: cut },
      { id: 'paso2', label: `Paso 2: ${w.steps[1]}`, kind: 'video', seconds: 2.6, volume: 0.7, transition: cut },
      { id: 'paso3', label: `Paso 3: ${w.steps[2]}`, kind: 'video', seconds: 2.6, volume: 0.7, transition: cut },
      {
        id: 'paso4',
        label: `Paso 4: ${w.steps[3]}`,
        kind: 'video',
        seconds: 2.6,
        volume: 0.7,
        transition: cut,
        optional: true,
      },
      { id: 'final', label: w.end, seconds: 3, motion: 'zoom-out', motionAmount: 0.08, transition: fade(0.3) },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'resultado',
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      paso(1),
      paso(2),
      paso(3),
      paso(4),
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.4,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.pulso, bpm: { min: 95, max: 120 }, cutsOnBeat: true },
    cover: { slot: 'resultado', offset: 0.9 },
  });
}

/** Dos estados: el de antes, el de después (que entra desde abajo) y el cierre. */
export function antesYDespues(
  theme: Theme,
  w: {
    purpose: string;
    when: string;
    hook: string;
    first: string;
    second: string;
    firstLabel: string;
    secondLabel: string;
    cta: string;
    note?: string;
  },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'fundido-suave',
    slots: [
      { id: 'antes', label: w.firstLabel, hint: 'Mismo encuadre que el «después».', seconds: 2.8, motion: 'none' },
      { id: 'despues', label: w.secondLabel, seconds: 3.6, motion: 'zoom-in', motionAmount: 0.08, transition: up(0.4) },
      { id: 'detalle', label: 'Detalle del resultado', seconds: 2.4, transition: fade(0.4), optional: true },
      { id: 'final', label: 'Cierre', seconds: 2.8, transition: fade(0.4), optional: true },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'antes',
        endOffset: -1.4,
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      {
        id: 'antes',
        role: 'detail',
        text: w.first,
        from: 'antes',
        offset: 1.4,
        position: 'top',
        style: e.rotulo,
        animation: FADE,
      },
      {
        id: 'despues',
        role: 'detail',
        text: w.second,
        from: 'despues',
        offset: 0.5,
        position: 'top',
        style: e.acento,
        animation: RISE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'despues',
        offset: 1.8,
        position: 'bottom',
        style: e.pie,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.calma, bpm: { min: 80, max: 100 } },
    cover: { slot: 'despues', offset: 1.5 },
    ...(w.note ? { note: w.note } : {}),
  });
}

/** Oferta o novedad con fecha: qué es, cuánto y hasta cuándo. */
export function ofertaDeLaSemana(
  theme: Theme,
  w: { purpose: string; when: string; hook: string; product: string; price: string; terms: string; cta: string },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      {
        id: 'gancho',
        label: 'Lo que se ofrece',
        hint: 'El plano más apetecible.',
        seconds: 1.2,
        motion: 'zoom-in',
        motionAmount: 0.12,
      },
      { id: 'detalle', label: w.product, seconds: 1.8, motion: 'zoom-in', transition: cut },
      { id: 'detalle2', label: 'Otro ángulo', seconds: 1.3, transition: slide(), optional: true },
      {
        id: 'precio',
        label: 'Plano tranquilo para el precio',
        hint: 'Aquí se lee: movimiento lento.',
        seconds: 3,
        motion: 'zoom-in',
        motionAmount: 0.08,
        transition: cut,
      },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'gancho',
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      {
        id: 'precio',
        role: 'title',
        text: w.price,
        from: 'precio',
        offset: 0.2,
        position: 'center',
        style: { ...e.acento, sizeRatio: 0.09 },
        animation: ZOOM,
      },
      {
        id: 'condiciones',
        role: 'detail',
        text: w.terms,
        from: 'precio',
        offset: 0.6,
        position: 'top',
        style: e.rotulo,
        animation: FADE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'precio',
        offset: 1.1,
        position: 'bottom',
        style: e.pie,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.pulso, bpm: { min: 105, max: 125 }, cutsOnBeat: true },
    cover: { slot: 'gancho', offset: 1 },
    note: 'El precio y las fechas, los de verdad.',
  });
}

/** Las personas de la casa: un plano por persona con su nombre. */
export function presentacionDelEquipo(
  theme: Theme,
  w: { purpose: string; when: string; hook: string; place: string; people: [string, string, string]; cta: string },
): Document {
  const e = estilos(theme);
  const persona = (n: 1 | 2 | 3): TextInput => ({
    id: `nombre${n}`,
    role: 'detail',
    text: w.people[n - 1]!,
    from: `persona${n}`,
    offset: 0.3,
    position: 'bottom',
    style: e.pie,
    animation: RISE,
  });
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'fundido-suave',
    slots: [
      { id: 'sitio', label: w.place, seconds: 2.2, motion: 'zoom-in', motionAmount: 0.08 },
      {
        id: 'persona1',
        label: 'Persona 1, trabajando',
        hint: 'Con su permiso. Mejor haciendo algo que posando.',
        seconds: 3,
        transition: fade(0.4),
      },
      { id: 'persona2', label: 'Persona 2, trabajando', seconds: 3, transition: fade(0.4), optional: true },
      { id: 'persona3', label: 'Persona 3, trabajando', seconds: 3, transition: fade(0.4), optional: true },
      { id: 'juntos', label: 'Todos juntos, o el sitio', seconds: 3, transition: fade(0.4) },
    ],
    texts: [
      { id: 'gancho', role: 'hook', text: w.hook, from: 'sitio', position: 'center', style: e.gancho, animation: ZOOM },
      persona(1),
      persona(2),
      persona(3),
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'juntos',
        offset: 0.4,
        position: 'center',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.calma, bpm: { min: 80, max: 100 } },
    cover: { slot: 'persona1', offset: 1 },
    note: 'Solo personas que han dado su permiso.',
  });
}

/** Muchos planos muy cortos al golpe de la música: el ambiente de un día. */
export function unDiaAqui(
  theme: Theme,
  w: {
    purpose: string;
    when: string;
    hook: string;
    shots: [string, string, string, string, string, string];
    cta: string;
  },
): Document {
  const e = estilos(theme);
  const shot = (n: number, optional = false): SlotInput => ({
    id: `plano${n}`,
    label: w.shots[n - 1]!,
    seconds: n === 1 ? 2 : 1.4,
    ...(n === 1 ? { motion: 'zoom-in' as const, motionAmount: 0.12 } : { transition: cut }),
    ...(optional ? { optional: true as const } : {}),
  });
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      shot(1),
      shot(2),
      shot(3),
      shot(4),
      shot(5, true),
      shot(6, true),
      { id: 'final', label: 'Plano final, más largo', seconds: 2.8, transition: fade(0.3) },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'plano1',
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.3,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.energia, bpm: { min: 120, max: 150 }, cutsOnBeat: true },
    cover: { slot: 'plano1', offset: 1 },
    note: 'Clips de 2–3 s grabados en vertical.',
  });
}

/** Alguien lo cuenta a cámara: una frase de entrada, la persona hablando y planos de apoyo. */
export function enPrimeraPersona(
  theme: Theme,
  w: {
    purpose: string;
    when: string;
    quote: string;
    who: string;
    talk: string;
    support: string;
    cta: string;
    note?: string;
  },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'fundido-suave',
    slots: [
      {
        id: 'entrada',
        label: w.support,
        hint: 'Un plano bonito para la frase de entrada.',
        seconds: 2.5,
        motion: 'zoom-in',
        motionAmount: 0.08,
      },
      {
        id: 'habla1',
        label: `${w.talk}: lo principal`,
        kind: 'video',
        hint: 'En vertical, a la altura de los ojos y con buen sonido.',
        seconds: 14,
        volume: 1,
        transition: fade(0.3),
      },
      { id: 'apoyo', label: 'Lo que cuenta, en imágenes', seconds: 3, transition: fade(0.3), optional: true },
      {
        id: 'habla2',
        label: `${w.talk}: el remate`,
        kind: 'video',
        seconds: 9,
        volume: 1,
        transition: fade(0.3),
        optional: true,
      },
      { id: 'final', label: 'Cierre', seconds: 3, transition: fade(0.4) },
    ],
    texts: [
      {
        id: 'frase',
        role: 'hook',
        text: w.quote,
        from: 'entrada',
        position: 'center',
        style: { ...e.gancho, sizeRatio: 0.07 },
        animation: TYPE,
      },
      {
        id: 'quien',
        role: 'detail',
        text: w.who,
        from: 'habla1',
        offset: 0.5,
        endOffset: -9,
        position: 'top',
        style: e.rotulo,
        animation: SLIDE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.4,
        position: 'center',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.voz },
    cover: { slot: 'habla1', offset: 2 },
    note: w.note ?? 'Con permiso de quien sale. Añade subtítulos.',
  });
}

/** Recorrido: de fuera adentro, un plano por parada, con pase lateral. */
export function paseo(
  theme: Theme,
  w: { purpose: string; when: string; hook: string; stops: [string, string, string, string]; cta: string },
): Document {
  const e = estilos(theme);
  const stop = (n: 1 | 2 | 3 | 4): TextInput => ({
    id: `parada${n}`,
    role: 'detail',
    text: w.stops[n - 1]!,
    from: `parada${n}`,
    offset: 0.3,
    position: 'bottom',
    style: e.pie,
    animation: SLIDE,
  });
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'pase-lateral',
    slots: [
      {
        id: 'parada1',
        label: w.stops[0],
        hint: 'Andando despacio, móvil en vertical. Mejor un vídeo que una foto.',
        kind: 'video',
        seconds: 1.8,
        motion: 'pan-right',
        motionAmount: 0.12,
      },
      { id: 'parada2', label: w.stops[1], seconds: 1.5, motion: 'pan-left', motionAmount: 0.12, transition: slide() },
      { id: 'parada3', label: w.stops[2], seconds: 1.8, motion: 'zoom-in', motionAmount: 0.12, transition: cut },
      {
        id: 'parada4',
        label: w.stops[3],
        seconds: 1.5,
        motion: 'pan-right',
        motionAmount: 0.12,
        transition: slide(),
        optional: true,
      },
      { id: 'final', label: 'Lo mejor, para el final', seconds: 1.8, motion: 'zoom-in', transition: cut },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'parada1',
        endOffset: -0.8,
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      { ...stop(1), offset: 1 },
      stop(2),
      stop(3),
      stop(4),
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.4,
        position: 'center',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.calma, bpm: { min: 85, max: 105 } },
    cover: { slot: 'final', offset: 1 },
  });
}

/** Algo con día y hora: qué, cuándo y cómo apuntarse. */
export function conFecha(
  theme: Theme,
  w: {
    purpose: string;
    when: string;
    hook: string;
    date: string;
    detail: string;
    shots: [string, string, string];
    cta: string;
  },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      { id: 'gancho', label: w.shots[0], seconds: 2, motion: 'zoom-in', motionAmount: 0.12 },
      { id: 'ambiente1', label: w.shots[1], seconds: 1.6, transition: cut },
      { id: 'ambiente2', label: w.shots[2], seconds: 1.6, transition: cut, optional: true },
      {
        id: 'fecha',
        label: 'Plano tranquilo para la fecha',
        hint: 'Aquí se lee el día y la hora.',
        seconds: 4,
        motion: 'none',
        transition: fade(0.3),
      },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'gancho',
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      {
        id: 'fecha',
        role: 'title',
        text: w.date,
        from: 'fecha',
        offset: 0.2,
        position: 'center',
        style: { ...e.acento, sizeRatio: 0.08 },
        animation: ZOOM,
      },
      {
        id: 'detalle',
        role: 'detail',
        text: w.detail,
        from: 'fecha',
        offset: 0.7,
        position: 'top',
        style: e.rotulo,
        animation: FADE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'fecha',
        offset: 1.2,
        position: 'bottom',
        style: e.pie,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.energia, bpm: { min: 115, max: 140 }, cutsOnBeat: true },
    cover: { slot: 'gancho', offset: 1 },
    note: 'La fecha y la hora, las de verdad.',
  });
}

/** Lo que se hace mal, cómo se hace bien y la clave, en tres planos. */
export function asiNoAsiSi(
  theme: Theme,
  w: { purpose: string; when: string; hook: string; wrong: string; right: string; key: string; cta: string },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      {
        id: 'mal',
        label: 'Hecho mal',
        kind: 'video',
        hint: 'Mismo encuadre en los dos: de lado y de cuerpo entero.',
        seconds: 4,
        volume: 0.5,
      },
      { id: 'bien', label: 'Hecho bien', kind: 'video', seconds: 5, volume: 0.5, transition: cut },
      { id: 'clave', label: 'La clave, de cerca', kind: 'video', seconds: 4, volume: 0.5, transition: cut },
      { id: 'final', label: 'Cierre', seconds: 2.5, transition: fade(0.3) },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'mal',
        endOffset: -2.2,
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      {
        id: 'mal',
        role: 'detail',
        text: w.wrong,
        from: 'mal',
        offset: 1.9,
        position: 'top',
        style: e.rotulo,
        animation: FADE,
      },
      {
        id: 'bien',
        role: 'detail',
        text: w.right,
        from: 'bien',
        offset: 0.2,
        position: 'top',
        style: e.acento,
        animation: RISE,
      },
      {
        id: 'clave',
        role: 'step',
        text: w.key,
        from: 'clave',
        offset: 0.2,
        position: 'bottom',
        style: e.pie,
        animation: TYPE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.3,
        position: 'center',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.pulso, bpm: { min: 100, max: 125 } },
    cover: { slot: 'bien', offset: 2 },
    note: 'Quien sale da su permiso.',
  });
}

/** Tres ejercicios o tres cosas que hacer, cada una con su rótulo. */
export function rutina(
  theme: Theme,
  w: { purpose: string; when: string; hook: string; items: [string, string, string]; cta: string },
): Document {
  const e = estilos(theme);
  const item = (n: 1 | 2 | 3): TextInput => ({
    id: `ejercicio${n}`,
    role: 'step',
    text: `${n} · ${w.items[n - 1]}`,
    from: `ejercicio${n}`,
    offset: 0.2,
    position: 'top',
    style: e.rotulo,
    animation: SLIDE,
  });
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      { id: 'gancho', label: 'El momento más vistoso', seconds: 2, motion: 'zoom-in', motionAmount: 0.12 },
      {
        id: 'ejercicio1',
        label: 'Primero',
        kind: 'video',
        hint: 'Una repetición entera.',
        seconds: 4.5,
        volume: 0.4,
        transition: cut,
      },
      { id: 'ejercicio2', label: 'Segundo', kind: 'video', seconds: 4.5, volume: 0.4, transition: cut },
      { id: 'ejercicio3', label: 'Tercero', kind: 'video', seconds: 4.5, volume: 0.4, transition: cut },
      { id: 'final', label: 'Cierre', seconds: 2.5, transition: fade(0.3) },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'gancho',
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      item(1),
      item(2),
      item(3),
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.3,
        position: 'center',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.energia, bpm: { min: 120, max: 145 } },
    cover: { slot: 'gancho', offset: 1 },
    note: 'Quien sale da su permiso.',
  });
}

/** Una novedad: palabra clave, tres ángulos y el nombre. */
export function loNuevo(
  theme: Theme,
  w: { purpose: string; when: string; hook: string; name: string; angles: [string, string, string]; cta: string },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      { id: 'angulo1', label: w.angles[0], seconds: 1.8, motion: 'zoom-in', motionAmount: 0.12 },
      { id: 'angulo2', label: w.angles[1], seconds: 2, transition: cut },
      { id: 'angulo3', label: w.angles[2], seconds: 2, transition: cut, optional: true },
      {
        id: 'final',
        label: 'Entero y quieto',
        hint: 'Para leer el nombre.',
        seconds: 3.4,
        motion: 'zoom-out',
        motionAmount: 0.08,
        transition: fade(0.3),
      },
    ],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'angulo1',
        position: 'center',
        style: e.gancho,
        animation: ZOOM,
      },
      {
        id: 'nombre',
        role: 'title',
        text: w.name,
        from: 'final',
        offset: 0.2,
        position: 'top',
        style: e.rotulo,
        animation: RISE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.8,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.pulso, bpm: { min: 100, max: 125 }, cutsOnBeat: true },
    cover: { slot: 'final', offset: 1.5 },
  });
}

/** Solo fotos, con cortes secos y zoom: para quien no tiene vídeo. */
export function fotosConRitmo(
  theme: Theme,
  w: { purpose: string; when: string; hook: string; subject: string; cta: string },
): Document {
  const e = estilos(theme);
  const photo = (n: number, optional = false): SlotInput => ({
    id: `foto${n}`,
    label: `${w.subject} ${n}`,
    kind: 'photo',
    seconds: n === 1 ? 1 : n % 3 === 0 ? 1.7 : 1.2,
    motion: n % 2 === 1 ? 'zoom-in' : 'zoom-out',
    motionAmount: 0.12,
    ...(n === 1 ? {} : { transition: cut }),
    ...(optional ? { optional: true as const } : {}),
  });
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'corte-ritmico',
    slots: [
      photo(1),
      photo(2),
      photo(3),
      photo(4),
      photo(5, true),
      photo(6, true),
      photo(7, true),
      {
        id: 'final',
        label: 'La mejor foto, para el final',
        kind: 'photo',
        seconds: 1.8,
        motion: 'zoom-in',
        motionAmount: 0.1,
        transition: cut,
      },
    ],
    texts: [
      { id: 'gancho', role: 'hook', text: w.hook, from: 'foto1', position: 'center', style: e.gancho, animation: ZOOM },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.3,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.energia, bpm: { min: 115, max: 140 }, cutsOnBeat: true },
    cover: { slot: 'final', offset: 1 },
    note: 'Fotos verticales o que aguanten el recorte.',
  });
}

/** Solo fotos, despacio y con fundidos: para enseñar con calma. */
export function fotosConCalma(
  theme: Theme,
  w: { purpose: string; when: string; hook: string; subject: string; line: string; cta: string },
): Document {
  const e = estilos(theme);
  const motions = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left', 'pan-up'] as const;
  const photo = (n: number, optional = false): SlotInput => ({
    id: `foto${n}`,
    label: `${w.subject} ${n}`,
    kind: 'photo',
    seconds: 3,
    motion: motions[(n - 1) % motions.length]!,
    motionAmount: 0.08,
    ...(n === 1 ? {} : { transition: fade(0.6) }),
    ...(optional ? { optional: true as const } : {}),
  });
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'fundido-suave',
    slots: [photo(1), photo(2), photo(3), photo(4, true), photo(5, true)],
    texts: [
      {
        id: 'gancho',
        role: 'hook',
        text: w.hook,
        from: 'foto1',
        position: 'center',
        style: { ...e.gancho, sizeRatio: 0.075 },
        animation: FADE,
      },
      {
        id: 'frase',
        role: 'detail',
        text: w.line,
        from: 'foto2',
        offset: 0.5,
        position: 'bottom',
        style: e.pie,
        animation: RISE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'foto3',
        offset: 0.6,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.calma, bpm: { min: 70, max: 95 } },
    cover: { slot: 'foto1', offset: 1.5 },
    note: 'Fotos verticales o que aguanten el recorte.',
  });
}

/** Un plano largo y lento es todo el reel: el nombre y poco más. */
export function planoLento(
  theme: Theme,
  w: { purpose: string; when: string; name: string; main: string; second: string; cta: string },
): Document {
  const e = estilos(theme);
  return build({
    purpose: w.purpose,
    whenToUse: w.when,
    style: 'fundido-suave',
    slots: [
      {
        id: 'principal',
        label: w.main,
        kind: 'video',
        hint: 'A cámara lenta si el móvil lo permite. Fondo oscuro y una luz de lado.',
        seconds: 5,
        volume: 0.6,
      },
      {
        id: 'segundo',
        label: w.second,
        kind: 'video',
        seconds: 3.5,
        volume: 0.6,
        transition: fade(0.4),
        optional: true,
      },
      {
        id: 'final',
        label: 'Terminado, quieto',
        seconds: 3,
        motion: 'zoom-in',
        motionAmount: 0.04,
        transition: fade(0.5),
      },
    ],
    texts: [
      {
        id: 'nombre',
        role: 'title',
        text: w.name,
        from: 'principal',
        offset: 0.8,
        endOffset: -0.6,
        position: 'top',
        style: e.rotulo,
        animation: FADE,
      },
      {
        id: 'cierre',
        role: 'cta',
        text: w.cta,
        from: 'final',
        offset: 0.5,
        position: 'bottom',
        style: e.acento,
        animation: RISE,
      },
    ],
    music: { suggestion: MUSIC.calma, bpm: { min: 70, max: 95 } },
    cover: { slot: 'final', offset: 1 },
    note: 'Mejor vídeo que fotos.',
  });
}
