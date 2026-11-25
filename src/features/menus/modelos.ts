// Plantillas de menús del restaurante: qué hay, qué se escribe en cada una y cómo se leen los textos.
//
// Dos grupos, y el segundo no complica el primero:
//   · Diarias y sencillas: menú del día, menú de tapas, tapa de la semana, carta o vinos destacados.
//   · Eventos especiales: Nochevieja, Navidad, San Valentín… con un diseño más elaborado.
// Cada una sale en historia (1080 × 1920) y en publicación (1080 × 1350).

export type TipoMenu = 'menu-dia' | 'tapas' | 'tapa-semana' | 'vinos' | 'evento';
export type FormatoMenu = 'story' | 'post';
export type EstiloMenu = 'oscuro' | 'claro';

export interface PlatoMenu {
  texto: string;
  precio?: string;
}

/** Una sección de un menú: su título y los platos, uno por línea («nombre | precio» si lleva precio). */
export interface SeccionEditable {
  titulo: string;
  texto: string;
}

/** Una tapa con su foto (de la biblioteca de la marca). */
export interface TapaEditable {
  nombre: string;
  precio: string;
  foto: string | null;
}

/** Todo lo que la persona escribe y elige. Una plantilla usa solo parte de esto. */
export interface DatosMenu {
  kicker: string;
  titulo: string;
  secciones: SeccionEditable[];
  tapas: TapaEditable[];
  descripcion: string;
  precio: string;
  /** Líneas de abajo: qué incluye, cuándo, lema, hora… una por línea. */
  pie: string;
  /** Foto de fondo (menú del día, vinos, eventos) o foto principal (tapa de la semana). */
  foto: string | null;
  estilo: EstiloMenu;
}

export interface InfoTipo {
  id: TipoMenu;
  grupo: 'diarias' | 'eventos';
  nombre: string;
  descripcion: string;
  /** Qué foto pide la plantilla. */
  foto: 'ninguna' | 'fondo' | 'principal' | 'por-tapa';
  textoFoto: string;
}

export const TIPOS: InfoTipo[] = [
  {
    id: 'menu-dia',
    grupo: 'diarias',
    nombre: 'Menú del día',
    descripcion: 'Primeros, segundos, postre y precio.',
    foto: 'fondo',
    textoFoto: 'Foto de fondo (opcional): se oscurece detrás del texto.',
  },
  {
    id: 'tapas',
    grupo: 'diarias',
    nombre: 'Menú de tapas',
    descripcion: 'Varias tapas, cada una con su foto y su precio.',
    foto: 'por-tapa',
    textoFoto: 'Una foto por tapa.',
  },
  {
    id: 'tapa-semana',
    grupo: 'diarias',
    nombre: 'Tapa de la semana',
    descripcion: 'Una tapa en grande, con su foto, su precio y unas líneas.',
    foto: 'principal',
    textoFoto: 'La foto de la tapa.',
  },
  {
    id: 'vinos',
    grupo: 'diarias',
    nombre: 'Carta o vinos destacados',
    descripcion: 'Una lista corta de vinos o platos de la carta, con su precio.',
    foto: 'fondo',
    textoFoto: 'Foto de fondo (opcional): se oscurece detrás del texto.',
  },
  {
    id: 'evento',
    grupo: 'eventos',
    nombre: 'Evento especial',
    descripcion: 'Nochevieja, Navidad, San Valentín… con marco dorado y precio destacado.',
    foto: 'fondo',
    textoFoto: 'Fondo del evento (opcional): una foto o una imagen creada con IA, velada detrás del texto.',
  },
];

export interface PresetEvento {
  id: string;
  nombre: string;
  datos: Pick<DatosMenu, 'kicker' | 'titulo' | 'secciones' | 'precio' | 'pie'>;
}

const seccion = (titulo: string, texto: string): SeccionEditable => ({ titulo, texto });

/** Puntos de partida de los eventos: textos de ejemplo para sustituir, no un menú de nadie. */
export const PRESETS_EVENTO: PresetEvento[] = [
  {
    id: 'nochevieja',
    nombre: 'Nochevieja',
    datos: {
      kicker: 'Menú de',
      titulo: 'Nochevieja',
      secciones: [
        seccion('Para compartir', 'Entrante para la mesa\nSegundo entrante para la mesa'),
        seccion('Platos individuales', 'Primer plato individual\nSegundo plato individual'),
        seccion('Plato fuerte', 'Plato principal'),
        seccion('Postre', 'Postre de la casa'),
        seccion('Bodega', 'Vino tinto\nVino blanco\nCava, uvas y cotillón'),
      ],
      precio: '00 €',
      pie: '¡Feliz año nuevo!\nLa cena empieza a las 21:00 h',
    },
  },
  {
    id: 'navidad',
    nombre: 'Navidad',
    datos: {
      kicker: 'Menú de',
      titulo: 'Navidad',
      secciones: [
        seccion('Entrantes', 'Entrante para compartir\nSegundo entrante'),
        seccion('Principal', 'Plato principal a elegir'),
        seccion('Postre', 'Postre navideño'),
        seccion('Bodega', 'Vino de la casa\nCafé y turrones'),
      ],
      precio: '00 €',
      pie: 'Reserva tu mesa\nDel 24 al 26 de diciembre',
    },
  },
  {
    id: 'san-valentin',
    nombre: 'San Valentín',
    datos: {
      kicker: 'Menú de',
      titulo: 'San Valentín',
      secciones: [
        seccion('Para empezar', 'Entrante para dos'),
        seccion('Principal', 'Plato principal a elegir'),
        seccion('Postre', 'Postre para compartir'),
        seccion('Bodega', 'Copa de cava de bienvenida\nVino de la casa'),
      ],
      precio: '00 €',
      pie: 'Menú para dos personas\nReserva con antelación',
    },
  },
  {
    id: 'otro',
    nombre: 'Otro evento',
    datos: {
      kicker: 'Menú especial',
      titulo: 'Nombre del evento',
      secciones: [seccion('Para empezar', 'Entrante'), seccion('Principal', 'Plato principal'), seccion('Postre', 'Postre')],
      precio: '00 €',
      pie: 'Día y hora del evento',
    },
  },
];

/** Los datos con que se abre cada plantilla: textos de ejemplo, listos para sustituir. */
export function datosIniciales(tipo: TipoMenu, preset = 'nochevieja'): DatosMenu {
  const base: DatosMenu = {
    kicker: '',
    titulo: '',
    secciones: [],
    tapas: [],
    descripcion: '',
    precio: '',
    pie: '',
    foto: null,
    estilo: 'oscuro',
  };
  switch (tipo) {
    case 'menu-dia':
      return {
        ...base,
        kicker: 'Hoy, a mediodía',
        titulo: 'Menú del día',
        secciones: [
          seccion('Primeros', 'Primer plato a elegir\nOtro primer plato'),
          seccion('Segundos', 'Segundo plato a elegir\nOtro segundo plato'),
          seccion('Postre', 'Postre o café'),
        ],
        precio: '00,00 €',
        pie: 'Bebida y postre incluidos\nDe lunes a viernes',
      };
    case 'tapas':
      return {
        ...base,
        kicker: 'Esta semana, en la barra',
        titulo: 'Menú de tapas',
        tapas: [
          { nombre: 'Primera tapa', precio: '0,00 €', foto: null },
          { nombre: 'Segunda tapa', precio: '0,00 €', foto: null },
        ],
        pie: 'Te esperamos en la barra',
      };
    case 'tapa-semana':
      return {
        ...base,
        kicker: 'Tapa de la semana',
        titulo: 'Nombre de la tapa',
        descripcion: 'Una frase corta que cuente de qué está hecha.',
        precio: '0,00 €',
        pie: 'Te esperamos en la barra',
      };
    case 'vinos':
      return {
        ...base,
        kicker: 'Recomendamos',
        titulo: 'Vinos de la semana',
        secciones: [
          seccion('Tintos', 'Vino tinto, crianza | 3,50 €\nOtro vino tinto | 4,00 €'),
          seccion('Blancos', 'Vino blanco, joven | 3,00 €'),
        ],
        pie: 'Precio por copa',
      };
    case 'evento': {
      const p = PRESETS_EVENTO.find((e) => e.id === preset) ?? PRESETS_EVENTO[0]!;
      // Los eventos salen en claro (marfil y oro), como la minuta; el oscuro se elige a mano.
      return { ...base, ...p.datos, secciones: p.datos.secciones.map((s) => ({ ...s })), estilo: 'claro' };
    }
  }
}

/** Lo que dice una línea con precio: «Nombre | 3,50 €». Sin barra, solo el nombre. */
export function leerPlato(linea: string): PlatoMenu | null {
  const limpia = linea.trim();
  if (!limpia) return null;
  const corte = limpia.lastIndexOf('|');
  if (corte < 0) return { texto: limpia };
  const texto = limpia.slice(0, corte).trim();
  const precio = limpia.slice(corte + 1).trim();
  if (!texto) return precio ? { texto: precio } : null;
  return precio ? { texto, precio } : { texto };
}

/** Los platos de una sección. */
export function platosDe(s: SeccionEditable): PlatoMenu[] {
  return s.texto
    .split('\n')
    .map(leerPlato)
    .filter((p): p is PlatoMenu => p !== null);
}

/** Líneas no vacías de un texto de varias líneas. */
export function lineasDe(texto: string): string[] {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export const MAX_TAPAS = 12;
export const MAX_PLATOS = 40;

/** Cuántos platos y tapas hay en total (para avisar de lo largo que es). */
export function contarPlatos(tipo: TipoMenu, d: DatosMenu): number {
  if (tipo === 'tapas') return d.tapas.filter((t) => t.nombre.trim()).length;
  if (tipo === 'tapa-semana') return d.titulo.trim() ? 1 : 0;
  return d.secciones.reduce((n, s) => n + platosDe(s).length, 0);
}

/**
 * Pie de la publicación escrito a partir de lo que se ha puesto (se puede cambiar en «Compartir»).
 * Sin hashtags ni emojis: eso es de la marca.
 */
export function pieDePublicacion(tipo: TipoMenu, d: DatosMenu): string {
  const partes: string[] = [];
  const cabecera = [d.titulo.trim(), d.kicker.trim() && tipo !== 'evento' ? d.kicker.trim() : ''].filter(Boolean).join(' · ');
  if (cabecera) partes.push(cabecera);
  if (tipo === 'tapas') {
    for (const t of d.tapas) if (t.nombre.trim()) partes.push(`${t.nombre.trim()}${t.precio.trim() ? ` · ${t.precio.trim()}` : ''}`);
  } else if (tipo === 'tapa-semana') {
    if (d.descripcion.trim()) partes.push(d.descripcion.trim());
  } else {
    for (const s of d.secciones) {
      const platos = platosDe(s);
      if (platos.length === 0) continue;
      partes.push(`${s.titulo.trim() ? `${s.titulo.trim()}: ` : ''}${platos.map((p) => p.texto + (p.precio ? ` (${p.precio})` : '')).join(', ')}`);
    }
  }
  if (d.precio.trim()) partes.push(`Precio: ${d.precio.trim()}`);
  partes.push(...lineasDe(d.pie));
  return partes.join('\n').slice(0, 2000);
}
