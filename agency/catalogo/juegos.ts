// Los cuatro juegos de plantillas del catálogo: tres por sector (restaurante o
// asador, bar de cócteles y gimnasio) y uno genérico que sirve a cualquier
// marca. Cada juego lleva 10 plantillas de reel y 10 de publicación o carrusel.
//
// Aquí no hay nada de ningún cliente: los nombres son neutros, los textos son
// de muestra («Nombre del plato», «00 €») y los colores y tipografías llegan
// por papel desde el tema de la marca (tema.ts). Por qué estas plantillas y no
// otras: docs/plantillas-competencia.md.
import type { DocumentPageInput } from '../../src/features/content/document/schema.ts';
import type { ReelTemplateInput } from '../../src/features/reels/reelTemplate.ts';
import * as P from './publicaciones.ts';
import * as R from './reels.ts';
import type { Theme } from './tema.ts';

export interface ReelDraft {
  key: string;
  name: string;
  document: ReelTemplateInput;
}

export interface PostDraft {
  key: string;
  name: string;
  format: 'post' | 'carousel';
  /** Para qué sirve, en una frase. */
  purpose: string;
  /** Cuándo usarla. */
  whenToUse: string;
  /** Qué material necesita. */
  material: string;
  /** Fondo del lienzo: oscuro, claro o acento del tema. */
  background: 'dark' | 'light' | 'accent';
  pages: DocumentPageInput[];
  /** Guía del pie de la publicación (se sustituye). */
  caption: string;
  /** Qué tipo de foto le va. */
  photo: string;
}

export interface CatalogSet {
  id: 'restaurante' | 'cocteleria' | 'gimnasio' | 'generico';
  name: string;
  /** A qué tipo de negocio va dirigido. */
  forWhom: string;
  /** Prefijo de las claves: así dos juegos cargados en la misma marca no se pisan. */
  prefix: string;
  look: P.Look;
  reels: (theme: Theme) => ReelDraft[];
  posts: (theme: Theme) => PostDraft[];
}

const CAPTION = {
  producto: 'Una frase con gancho que nombra lo que se ve. Otra, corta, con el detalle que lo hace distinto.',
  aviso: 'Lo esencial en la primera frase: qué pasa y cuándo. Después, cómo afecta y a quién preguntar.',
  lista: 'Di qué va a encontrar quien deslice. Cierra con una sola petición: guardar, comentar o venir.',
  persona: 'Quién es, qué hace aquí y un detalle que lo haga cercano. Sin datos personales de más.',
  oferta: 'Qué es, cuánto cuesta y hasta cuándo, con las condiciones de verdad. Una sola llamada al final.',
};

const one = (page: DocumentPageInput): DocumentPageInput[] => [page];

// ───────────────────────────── Restaurante o asador ─────────────────────────────

const RESTAURANTE_LOOK: P.Look = { surface: 'light', align: 'center', upper: false, italic: false, weight: 700 };

const restaurante: CatalogSet = {
  id: 'restaurante',
  name: 'Restaurante o asador',
  forWhom: 'Restaurantes, asadores, marisquerías y casas de comidas.',
  prefix: 'rest',
  look: RESTAURANTE_LOOK,
  reels: (theme) => [
    {
      key: 'rest-asi-se-hace',
      name: 'Así se hace',
      document: R.asiSeHace(theme, {
        purpose: 'Enseñar un plato desde el producto hasta la mesa, con el plato terminado como gancho.',
        when: 'Para el plato estrella o uno de temporada. Es la que mejor funciona para llegar a gente nueva.',
        hook: 'Así se hace',
        result: 'Plato terminado',
        steps: ['Producto en crudo', 'Al fuego', 'El punto y el corte', 'Emplatado'],
        end: 'En la mesa',
        cta: 'Reserva tu mesa',
      }),
    },
    {
      key: 'rest-de-cerca',
      name: 'De cerca, con su sonido',
      document: R.deCerca(theme, {
        purpose: 'Un solo plato muy de cerca, con el sonido real de la cocina y sin música.',
        when: 'Cuando el plato suena: brasa, plancha, corte, crujiente. Evita además la música con derechos.',
        name: 'Nombre del plato',
        shots: ['En el fuego', 'El corte', 'La sal o la salsa por encima'],
        cta: 'Ven a probarlo',
      }),
    },
    {
      key: 'rest-3-motivos',
      name: '3 motivos',
      document: R.tresMotivos(theme, {
        purpose: 'Tres razones para venir, una por plano y numeradas.',
        when: 'Para presentar la casa a quien no la conoce o para destacar tres platos.',
        hook: '3 motivos para venir',
        opener: 'El plato estrella',
        items: ['Producto de temporada', 'Hecho al momento', 'Como en casa'],
        labels: ['Motivo 1: el producto', 'Motivo 2: la cocina', 'Motivo 3: la sala'],
        cta: 'Reserva tu mesa',
      }),
    },
    {
      key: 'rest-lo-nuevo',
      name: 'Lo nuevo',
      document: R.loNuevo(theme, {
        purpose: 'Presentar una novedad de la carta en pocos segundos.',
        when: 'Al estrenar un plato, un vino o un producto de temporada.',
        hook: 'Nuevo en carta',
        name: 'Nombre del plato',
        angles: ['Desde arriba', 'De cerca', 'Al cortarlo o servirlo'],
        cta: 'Pruébalo esta semana',
      }),
    },
    {
      key: 'rest-oferta-semana',
      name: 'Oferta de la semana',
      document: R.ofertaDeLaSemana(theme, {
        purpose: 'Anunciar un menú, una sugerencia o una promoción con su precio y sus fechas.',
        when: 'Menú del día, menú de fin de semana o una sugerencia con fecha. Como mucho, una de cada cuatro publicaciones.',
        hook: 'Esta semana',
        product: 'El plato o el menú, de cerca',
        price: 'Menú · 00 €',
        terms: 'De lunes a viernes, a mediodía',
        cta: 'Reserva tu mesa',
      }),
    },
    {
      key: 'rest-un-dia-aqui',
      name: 'Un día aquí',
      document: R.unDiaAqui(theme, {
        purpose: 'El ambiente de un servicio en planos muy cortos, al golpe de la música.',
        when: 'Para enseñar la casa por dentro: cocina, sala y gente. Buena para fines de semana.',
        hook: 'Un día aquí',
        shots: ['Se abre', 'Llega el género', 'El fuego encendido', 'Primer pase', 'La sala llena', 'El postre'],
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'rest-equipo',
      name: 'Presentación del equipo',
      document: R.presentacionDelEquipo(theme, {
        purpose: 'Poner cara y nombre a quien cocina y a quien atiende.',
        when: 'De vez en cuando, o cuando entra alguien nuevo. Acerca la casa a los vecinos.',
        hook: 'Quién cocina para ti',
        place: 'La cocina o la sala',
        people: ['Nombre · Cocina', 'Nombre · Sala', 'Nombre · Parrilla'],
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'rest-primera-persona',
      name: 'Contado en primera persona',
      document: R.enPrimeraPersona(theme, {
        purpose: 'Alguien de la casa cuenta a cámara un plato o la historia del sitio.',
        when: 'Para platos con historia o para contar de dónde viene el producto. Dura más: mejor para quien ya os sigue.',
        quote: '«Lo hacemos igual desde el primer día»',
        who: 'Nombre · Cocina',
        talk: 'Habla a cámara',
        support: 'El plato del que habla',
        cta: 'Ven a probarlo',
      }),
    },
    {
      key: 'rest-fotos-con-ritmo',
      name: 'Fotos con ritmo',
      document: R.fotosConRitmo(theme, {
        purpose: 'Un reel solo con fotos, con cortes rápidos y zoom.',
        when: 'Cuando no hay vídeo: con las fotos de la carta sale un reel en un minuto.',
        hook: 'Lo que sale de la cocina',
        subject: 'Foto de plato',
        cta: 'Reserva tu mesa',
      }),
    },
    {
      key: 'rest-paseo',
      name: 'Paseo por el local',
      document: R.paseo(theme, {
        purpose: 'Recorrer el local de la puerta a la mesa, como lo ve quien llega.',
        when: 'Para quien todavía no ha venido: grupos, celebraciones, terraza.',
        hook: 'Pasa y mira',
        stops: ['La entrada', 'La barra', 'La sala', 'La terraza'],
        cta: 'Reserva tu mesa',
      }),
    },
  ],
  posts: (theme) => {
    const look = RESTAURANTE_LOOK;
    return [
      {
        key: 'rest-foto-a-sangre',
        name: 'Foto a sangre',
        format: 'post',
        purpose: 'La foto sola, sin texto ni logotipo: manda el producto.',
        whenToUse: 'La base de la cuenta: dos de cada tres publicaciones.',
        material: '1 foto vertical (4:5) con buena luz.',
        background: 'dark',
        pages: one(P.fotoASangre(theme, look)),
        caption: CAPTION.producto,
        photo: 'Plano cerrado o desde arriba, luz cálida, fondo sencillo.',
      },
      {
        key: 'rest-foto-con-nombre',
        name: 'Foto con nombre',
        format: 'post',
        purpose: 'La foto con una franja abajo que dice qué es.',
        whenToUse: 'Para destacados: el plato estrella, una novedad, un vino.',
        material: '1 foto vertical; lo importante, en los dos tercios de arriba.',
        background: 'dark',
        pages: one(P.fotoConFranja(theme, look, { kicker: 'De nuestra carta', title: 'Nombre del plato' })),
        caption: CAPTION.producto,
        photo: 'Plano cerrado; la franja tapa la parte de abajo.',
      },
      {
        key: 'rest-titular-sobre-foto',
        name: 'Titular sobre foto',
        format: 'post',
        purpose: 'Una frase grande sobre la foto oscurecida.',
        whenToUse: 'Temporadas, fechas señaladas y mensajes que no son un plato concreto.',
        material: '1 foto vertical, mejor de ambiente que de detalle.',
        background: 'dark',
        pages: one(
          P.titularSobreFoto(theme, look, {
            kicker: 'Temporada',
            title: 'Titular de pocas palabras',
            sub: 'Una línea que lo explica.',
          }),
        ),
        caption: CAPTION.producto,
        photo: 'Sala, brasa o producto; se oscurece para que se lea el texto.',
      },
      {
        key: 'rest-oferta-semana',
        name: 'Oferta de la semana',
        format: 'post',
        purpose: 'Foto arriba, nombre abajo y el precio en un sello.',
        whenToUse: 'Menú del día, menú de grupo o una sugerencia con precio y fecha reales.',
        material: '1 foto horizontal o cuadrada del plato o del menú.',
        background: 'light',
        pages: one(
          P.oferta(theme, look, {
            kicker: 'Esta semana',
            title: 'Nombre del menú o del plato',
            badge: '00 €',
            terms: 'De lunes a viernes, a mediodía. Bebida y postre incluidos.',
          }),
        ),
        caption: CAPTION.oferta,
        photo: 'El plato o la mesa puesta, sin recortar por arriba.',
      },
      {
        key: 'rest-lista-del-dia',
        name: 'Lista del día',
        format: 'post',
        purpose: 'Una lista de dos columnas: qué hay y cuánto cuesta.',
        whenToUse: 'Menú del día, sugerencias de la semana o carta corta.',
        material: 'Ninguna foto: de 3 a 6 líneas con su precio.',
        background: 'light',
        pages: one(
          P.lista(theme, look, {
            kicker: 'Hoy',
            title: 'Menú del día',
            rows: [
              ['Primer plato', '00 €'],
              ['Segundo plato', '00 €'],
              ['Postre de la casa', '00 €'],
              ['Menú completo', '00 €'],
            ],
            foot: 'A mediodía, de lunes a viernes.',
          }),
        ),
        caption: CAPTION.oferta,
        photo: 'Sin foto.',
      },
      {
        key: 'rest-3-motivos',
        name: '3 motivos',
        format: 'carousel',
        purpose: 'Carrusel de lista: una portada con la promesa y un motivo por página.',
        whenToUse: 'Para que lo guarden y lo envíen: tres platos que pedir, tres razones para venir.',
        material: '3 fotos verticales, una por motivo.',
        background: 'dark',
        pages: P.carruselMotivos(theme, look, {
          cover: { kicker: 'Desliza', title: '3 platos que hay que pedir', body: 'Los que más salen de la cocina.' },
          items: [
            { title: 'Nombre del primero', text: 'Por qué pedirlo, en una línea.' },
            { title: 'Nombre del segundo', text: 'Por qué pedirlo, en una línea.' },
            { title: 'Nombre del tercero', text: 'Por qué pedirlo, en una línea.' },
          ],
          end: { kicker: '¿Y el tuyo?', title: 'Dinos cuál pides tú', foot: 'Reserva tu mesa' },
        }),
        caption: CAPTION.lista,
        photo: 'Un plato por foto; el texto va encima, sobre un velo.',
      },
      {
        key: 'rest-asi-se-hace',
        name: 'Así se hace',
        format: 'carousel',
        purpose: 'Carrusel paso a paso: el plato terminado en portada y un paso por página.',
        whenToUse: 'Para enseñar el oficio: un asado, un arroz, un corte.',
        material: '5 fotos: el resultado y una de cada paso.',
        background: 'light',
        pages: P.carruselPasos(theme, look, {
          cover: { kicker: 'Paso a paso', title: 'Así se hace', sub: 'Del producto a la mesa.' },
          steps: [
            { title: 'El producto', text: 'Qué es y de dónde viene.' },
            { title: 'El fuego', text: 'Cómo se cocina y cuánto tiempo.' },
            { title: 'El punto', text: 'Cómo se sabe que está.' },
            { title: 'A la mesa', text: 'Con qué se sirve.' },
          ],
          end: { kicker: 'Ahora te toca', title: 'Ven a probarlo', foot: 'Reserva tu mesa' },
        }),
        caption: CAPTION.lista,
        photo: 'Misma luz y mismo fondo en todas, para que se lea como una serie.',
      },
      {
        key: 'rest-equipo',
        name: 'Presentación del equipo',
        format: 'post',
        purpose: 'Un retrato con el nombre y el puesto.',
        whenToUse: 'Para presentar a alguien de cocina o de sala. Siempre con su permiso.',
        material: '1 retrato vertical, trabajando o mirando a cámara.',
        background: 'dark',
        pages: one(
          P.persona(theme, look, { name: 'Nombre', role: 'Cocina · Desde 2000', line: '«Su frase, entre comillas.»' }),
        ),
        caption: CAPTION.persona,
        photo: 'Retrato con la cara en la mitad de arriba; las etiquetas van abajo.',
      },
      {
        key: 'rest-opinion',
        name: 'Opinión de un cliente',
        format: 'post',
        purpose: 'Una reseña real, en grande, con quién la firma.',
        whenToUse: 'Con una reseña pública y con permiso de quien la escribió. Sin retocar el texto.',
        material: 'Ninguna foto: la frase y el nombre.',
        background: 'light',
        pages: one(
          P.opinion(theme, look, {
            quote: 'La frase de la reseña, tal cual, en dos o tres líneas.',
            author: 'Nombre',
            detail: 'Reseña en Google',
          }),
        ),
        caption: 'Da las gracias y cuenta en una frase qué pidió. No añadas nada que la reseña no diga.',
        photo: 'Sin foto.',
      },
      {
        key: 'rest-aviso',
        name: 'Aviso',
        format: 'post',
        purpose: 'Un cartel de color con un aviso práctico.',
        whenToUse: 'Vacaciones, cambio de horario, día cerrado o reapertura.',
        material: 'Ninguna foto: las fechas exactas.',
        background: 'accent',
        pages: one(
          P.cartel(
            theme,
            look,
            {
              kicker: 'Aviso',
              title: 'Cerramos por vacaciones',
              body: 'Del 00 al 00. Volvemos el día 00.',
              foot: 'Gracias por esperarnos',
            },
            'accent',
          ),
        ),
        caption: CAPTION.aviso,
        photo: 'Sin foto.',
      },
    ];
  },
};

// ───────────────────────────── Bar de cócteles ─────────────────────────────

const COCTELERIA_LOOK: P.Look = { surface: 'dark', align: 'center', upper: true, italic: false, weight: 600 };
const ALCOHOL = ' Sin menores en imagen y sin animar a beber de más.';

const cocteleria: CatalogSet = {
  id: 'cocteleria',
  name: 'Bar de cócteles',
  forWhom: 'Coctelerías, bares de copas y pubs.',
  prefix: 'coct',
  look: COCTELERIA_LOOK,
  reels: (theme) => [
    {
      key: 'coct-receta-4-pasos',
      name: 'Receta en 4 pasos',
      document: R.enCuatroPasos(theme, {
        purpose: 'La copa terminada como gancho y la preparación en cuatro pasos rotulados.',
        when: `Para un cóctel de la carta que se entienda viéndolo hacer.${ALCOHOL}`,
        hook: 'Así se prepara',
        result: 'Copa terminada',
        steps: ['Hielo', 'Medidas', 'Agitar o remover', 'Decorar'],
        end: 'El primer sorbo o la copa en la barra',
        cta: 'Pídelo en la barra',
      }),
    },
    {
      key: 'coct-plano-lento',
      name: 'Plano lento',
      document: R.planoLento(theme, {
        purpose: 'Un vertido o un efecto a cámara lenta: un solo plano es todo el reel.',
        when: `Cuando hay algo vistoso: humo, cambio de color, espuma, piel de cítrico.${ALCOHOL}`,
        name: 'Nombre del cóctel',
        main: 'El vertido, de cerca',
        second: 'La decoración',
        cta: 'Ven a probarlo',
      }),
    },
    {
      key: 'coct-lo-nuevo',
      name: 'Lo nuevo',
      document: R.loNuevo(theme, {
        purpose: 'Presentar un cóctel nuevo en pocos segundos.',
        when: `Al cambiar la carta o con el cóctel de la semana.${ALCOHOL}`,
        hook: 'Nuevo en la carta',
        name: 'Nombre del cóctel',
        angles: ['La copa entera', 'El detalle', 'Con la luz de la barra'],
        cta: 'Pídelo esta semana',
      }),
    },
    {
      key: 'coct-antes-y-despues',
      name: 'Antes y después',
      document: R.antesYDespues(theme, {
        purpose: 'Del vaso con hielo a la copa terminada, con el mismo encuadre.',
        when: `Para cócteles en los que la decoración lo cambia todo.${ALCOHOL}`,
        hook: 'Lo que cambia el final',
        first: 'Antes',
        second: 'Después',
        firstLabel: 'El vaso sin decorar',
        secondLabel: 'La copa terminada',
        cta: 'Pídelo en la barra',
      }),
    },
    {
      key: 'coct-3-motivos',
      name: '3 motivos',
      document: R.tresMotivos(theme, {
        purpose: 'Tres cócteles o tres razones para venir, numerados.',
        when: `Para orientar a quien no sabe qué pedir.${ALCOHOL}`,
        hook: '3 para probar',
        opener: 'La barra o la copa estrella',
        items: ['Nombre del primero', 'Nombre del segundo', 'Nombre del tercero'],
        labels: ['Cóctel 1', 'Cóctel 2', 'Cóctel 3'],
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'coct-detras-de-la-barra',
      name: 'Un día aquí',
      document: R.unDiaAqui(theme, {
        purpose: 'El ambiente de una noche en planos muy cortos, al golpe de la música.',
        when: `Para enseñar el sitio y su gente antes del fin de semana.${ALCOHOL}`,
        hook: 'Detrás de la barra',
        shots: ['Se monta la barra', 'El hielo', 'La coctelera', 'Se sirve', 'La sala', 'El brindis'],
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'coct-equipo',
      name: 'Presentación del equipo',
      document: R.presentacionDelEquipo(theme, {
        purpose: 'Poner cara y nombre a quien está detrás de la barra.',
        when: 'De vez en cuando, o cuando entra alguien nuevo.',
        hook: 'Quién te lo prepara',
        place: 'La barra',
        people: ['Nombre · Barra', 'Nombre · Sala', 'Nombre · Cocina'],
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'coct-con-fecha',
      name: 'Con fecha',
      document: R.conFecha(theme, {
        purpose: 'Anunciar una noche especial con su día y su hora.',
        when: `Música en directo, cata, aniversario o cambio de carta.${ALCOHOL}`,
        hook: 'Este sábado',
        date: 'Sábado 00 · 23:00',
        detail: 'Qué pasa, en pocas palabras',
        shots: ['El ambiente', 'La barra', 'La sala'],
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'coct-fotos-con-calma',
      name: 'Fotos con calma',
      document: R.fotosConCalma(theme, {
        purpose: 'Un reel solo con fotos, despacio y con fundidos.',
        when: `Cuando no hay vídeo: con las fotos de la carta.${ALCOHOL}`,
        hook: 'La carta, copa a copa',
        subject: 'Foto de copa',
        line: 'Hechos al momento',
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'coct-de-cerca',
      name: 'De cerca, con su sonido',
      document: R.deCerca(theme, {
        purpose: 'El hielo, la coctelera y el vertido, con su sonido y sin música.',
        when: `Cuando la preparación suena bien. Evita además la música con derechos.${ALCOHOL}`,
        name: 'Nombre del cóctel',
        shots: ['El hielo en el vaso', 'La coctelera', 'El vertido'],
        cta: 'Ven a probarlo',
      }),
    },
  ],
  posts: (theme) => {
    const look = COCTELERIA_LOOK;
    return [
      {
        key: 'coct-foto-a-sangre',
        name: 'Foto a sangre',
        format: 'post',
        purpose: 'La copa sola, sin texto ni logotipo.',
        whenToUse: 'La base de la cuenta. Sin menores ni consumo excesivo en imagen.',
        material: '1 foto vertical (4:5) de la copa.',
        background: 'dark',
        pages: one(P.fotoASangre(theme, look)),
        caption: CAPTION.producto,
        photo: 'Fondo oscuro, una luz de lado y la copa entera.',
      },
      {
        key: 'coct-foto-con-nombre',
        name: 'Foto con nombre',
        format: 'post',
        purpose: 'La copa con una franja abajo con su nombre.',
        whenToUse: 'Para los cócteles de la carta que se quieren dar a conocer por su nombre.',
        material: '1 foto vertical; la copa, en los dos tercios de arriba.',
        background: 'dark',
        pages: one(P.fotoConFranja(theme, look, { kicker: 'De la carta', title: 'Nombre del cóctel' })),
        caption: CAPTION.producto,
        photo: 'La copa centrada; la franja tapa la parte de abajo.',
      },
      {
        key: 'coct-receta-4-pasos',
        name: 'Receta en 4 pasos',
        format: 'carousel',
        purpose: 'Carrusel paso a paso: la copa en portada y un paso por página.',
        whenToUse: 'Para que lo guarden. Solo recetas que la casa quiera compartir.',
        material: '5 fotos: la copa terminada y una de cada paso.',
        background: 'dark',
        pages: P.carruselPasos(theme, look, {
          cover: { kicker: 'Receta', title: 'Nombre del cóctel', sub: 'En cuatro pasos.' },
          steps: [
            { title: 'Hielo', text: 'Qué hielo y en qué vaso.' },
            { title: 'Medidas', text: 'Los ingredientes y sus cantidades.' },
            { title: 'Mezcla', text: 'Agitado o removido, y cuánto.' },
            { title: 'Decoración', text: 'El detalle final.' },
          ],
          end: { kicker: 'O mejor', title: 'Ven y te lo hacemos', foot: 'Disfruta con responsabilidad' },
        }),
        caption: CAPTION.lista,
        photo: 'Misma luz y mismo encuadre en todos los pasos.',
      },
      {
        key: 'coct-titular-sobre-foto',
        name: 'Titular sobre foto',
        format: 'post',
        purpose: 'Una palabra o una frase grande sobre la foto oscurecida.',
        whenToUse: 'Novedades, cambio de carta o un mensaje de temporada.',
        material: '1 foto vertical de la barra o de la copa.',
        background: 'dark',
        pages: one(
          P.titularSobreFoto(theme, look, {
            kicker: 'Nuevo',
            title: 'Nombre o frase corta',
            sub: 'Una línea que lo explica.',
          }),
        ),
        caption: CAPTION.producto,
        photo: 'Ambiente de la barra; se oscurece para que se lea el texto.',
      },
      {
        key: 'coct-lista',
        name: 'Lista con precios',
        format: 'post',
        purpose: 'Una lista de dos columnas: nombre y precio.',
        whenToUse: 'La carta corta, los clásicos o lo de la semana, con precios reales.',
        material: 'Ninguna foto: de 3 a 6 líneas con su precio.',
        background: 'dark',
        pages: one(
          P.lista(theme, look, {
            kicker: 'La carta',
            title: 'Los de la casa',
            rows: [
              ['Nombre del cóctel', '00 €'],
              ['Nombre del cóctel', '00 €'],
              ['Nombre del cóctel', '00 €'],
              ['Nombre del cóctel', '00 €'],
              ['Sin alcohol', '00 €'],
            ],
            foot: 'Disfruta con responsabilidad.',
          }),
        ),
        caption: CAPTION.oferta,
        photo: 'Sin foto.',
      },
      {
        key: 'coct-3-motivos',
        name: '3 motivos',
        format: 'carousel',
        purpose: 'Carrusel de lista: una portada con la promesa y un cóctel por página.',
        whenToUse: 'Para orientar a quien no sabe qué pedir y para que lo envíen a sus amigos.',
        material: '3 fotos verticales, una por cóctel.',
        background: 'dark',
        pages: P.carruselMotivos(theme, look, {
          cover: { kicker: 'Desliza', title: '3 para probar', body: 'Si es tu primera vez aquí.' },
          items: [
            { title: 'Nombre del primero', text: 'A qué sabe, en una línea.' },
            { title: 'Nombre del segundo', text: 'A qué sabe, en una línea.' },
            { title: 'Nombre del tercero', text: 'A qué sabe, en una línea.' },
          ],
          end: { kicker: '¿Y el tuyo?', title: 'Dinos cuál pides tú', foot: 'Te esperamos' },
        }),
        caption: CAPTION.lista,
        photo: 'Una copa por foto; el texto va encima, sobre un velo.',
      },
      {
        key: 'coct-equipo',
        name: 'Presentación del equipo',
        format: 'post',
        purpose: 'Un retrato con el nombre y el puesto.',
        whenToUse: 'Para presentar a quien está detrás de la barra. Siempre con su permiso.',
        material: '1 retrato vertical, trabajando o mirando a cámara.',
        background: 'dark',
        pages: one(P.persona(theme, look, { name: 'Nombre', role: 'Barra', line: '«Su cóctel favorito.»' })),
        caption: CAPTION.persona,
        photo: 'Retrato con la cara en la mitad de arriba.',
      },
      {
        key: 'coct-con-fecha',
        name: 'Con fecha',
        format: 'post',
        purpose: 'Foto arriba y, abajo, el día en grande con lo que pasa.',
        whenToUse: 'Música en directo, cata, aniversario: cualquier noche con día y hora.',
        material: '1 foto horizontal o cuadrada del ambiente.',
        background: 'dark',
        pages: one(
          P.fecha(theme, look, {
            day: '00',
            month: 'Mes',
            title: 'Nombre de la noche',
            detail: 'Desde las 23:00. Entrada libre.',
          }),
        ),
        caption: CAPTION.aviso,
        photo: 'Ambiente del local; el texto va en la mitad de abajo.',
      },
      {
        key: 'coct-frase',
        name: 'Frase',
        format: 'post',
        purpose: 'Un cartel oscuro con una frase de la casa.',
        whenToUse: 'Para dar aire a la cuadrícula entre fotos. Una de cada seis, como mucho.',
        material: 'Ninguna foto: una frase corta.',
        background: 'dark',
        pages: one(
          P.cartel(
            theme,
            look,
            { kicker: 'La casa', title: 'Una frase corta de la casa', foot: 'Disfruta con responsabilidad' },
            'dark',
          ),
        ),
        caption: 'Una frase que acompañe sin repetir el cartel.',
        photo: 'Sin foto.',
      },
      {
        key: 'coct-aviso',
        name: 'Aviso',
        format: 'post',
        purpose: 'Un cartel de color con un aviso práctico.',
        whenToUse: 'Horario especial, día cerrado, aforo completo o reapertura.',
        material: 'Ninguna foto: las fechas exactas.',
        background: 'accent',
        pages: one(
          P.cartel(
            theme,
            look,
            {
              kicker: 'Aviso',
              title: 'Hoy abrimos más tarde',
              body: 'Desde las 00:00. Mañana, horario de siempre.',
              foot: 'Gracias',
            },
            'accent',
          ),
        ),
        caption: CAPTION.aviso,
        photo: 'Sin foto.',
      },
    ];
  },
};

// ───────────────────────────── Gimnasio ─────────────────────────────

const GIMNASIO_LOOK: P.Look = { surface: 'dark', align: 'left', upper: true, italic: true, weight: 800 };
const PERMISO = ' Con permiso de quien sale.';
const SIN_PROMESAS =
  'Con permiso por escrito. Di el tiempo real que llevó y cuenta el logro (una marca, una técnica), no el cuerpo. Sin prometer resultados ni plazos.';

const gimnasio: CatalogSet = {
  id: 'gimnasio',
  name: 'Gimnasio',
  forWhom: 'Gimnasios, boxes, clubes de boxeo y centros de entrenamiento.',
  prefix: 'gim',
  look: GIMNASIO_LOOK,
  reels: (theme) => [
    {
      key: 'gim-asi-no-asi-si',
      name: 'Así no, así sí',
      document: R.asiNoAsiSi(theme, {
        purpose: 'Un error frecuente, la forma correcta y la clave, en unos 15 segundos.',
        when: 'Contenido útil que se guarda: uno por semana da para una serie.',
        hook: '¿Lo haces así?',
        wrong: 'Así no',
        right: 'Así sí',
        key: 'La clave, en cinco palabras',
        cta: 'Pregunta a tu entrenador',
      }),
    },
    {
      key: 'gim-rutina-3',
      name: 'Rutina en 3 ejercicios',
      document: R.rutina(theme, {
        purpose: 'Tres ejercicios con su nombre y sus series.',
        when: 'Para que lo guarden y lo prueben. Sin prometer resultados.',
        hook: 'Rutina en 3 ejercicios',
        items: ['Ejercicio · 3 × 12', 'Ejercicio · 3 × 10', 'Ejercicio · 3 × 15'],
        cta: 'Guárdala para tu próximo día',
      }),
    },
    {
      key: 'gim-clase',
      name: 'Un día aquí',
      document: R.unDiaAqui(theme, {
        purpose: 'Una clase en planos muy cortos, al golpe de la música.',
        when: `Para enseñar el ambiente a quien todavía no ha venido.${PERMISO}`,
        hook: 'Así es una clase',
        shots: ['Calentamiento', 'Primer bloque', 'A tope', 'Los compañeros', 'El último esfuerzo', 'Se estira'],
        cta: 'Prueba una clase',
      }),
    },
    {
      key: 'gim-primera-persona',
      name: 'Contado en primera persona',
      document: R.enPrimeraPersona(theme, {
        purpose: 'Un socio o un entrenador cuenta a cámara su historia.',
        when: 'Una al mes. Es lo que más convence a quien duda en apuntarse.',
        quote: '«Vine a probar un mes»',
        who: 'Nombre · Socio desde 2000',
        talk: 'Habla a cámara',
        support: 'Entrenando',
        cta: 'Empieza cuando quieras',
        note: SIN_PROMESAS,
      }),
    },
    {
      key: 'gim-antes-y-despues',
      name: 'Antes y después',
      document: R.antesYDespues(theme, {
        purpose: 'El mismo ejercicio el primer día y hoy, con el tiempo que ha pasado.',
        when: 'Para enseñar constancia con un logro medible: una marca, una técnica, un peso.',
        hook: 'Constancia',
        first: 'Mes 1',
        second: 'Mes 6',
        firstLabel: 'El primer día',
        secondLabel: 'Hoy, el mismo ejercicio',
        cta: 'Empieza cuando quieras',
        note: SIN_PROMESAS,
      }),
    },
    {
      key: 'gim-oferta-semana',
      name: 'Oferta de la semana',
      document: R.ofertaDeLaSemana(theme, {
        purpose: 'Anunciar una promoción con su precio y hasta cuándo dura.',
        when: 'Matrícula, bono o mes de prueba. Como mucho, una de cada cuatro publicaciones.',
        hook: 'Solo este mes',
        product: 'La sala o la clase',
        price: 'Matrícula · 00 €',
        terms: 'Hasta el día 00',
        cta: 'Apúntate en recepción',
      }),
    },
    {
      key: 'gim-equipo',
      name: 'Presentación del equipo',
      document: R.presentacionDelEquipo(theme, {
        purpose: 'Poner cara y nombre a los entrenadores.',
        when: 'De vez en cuando, o cuando empieza una actividad nueva.',
        hook: 'Quién te entrena',
        place: 'La sala',
        people: ['Nombre · Boxeo', 'Nombre · Fuerza', 'Nombre · Recepción'],
        cta: 'Ven a conocernos',
      }),
    },
    {
      key: 'gim-con-fecha',
      name: 'Con fecha',
      document: R.conFecha(theme, {
        purpose: 'Anunciar un reto, una clase abierta o un evento con su fecha.',
        when: 'Reto del mes, puertas abiertas, velada o competición.',
        hook: 'Reto del mes',
        date: 'Empieza el 00',
        detail: '30 días · 3 días por semana',
        shots: ['El ejercicio del reto', 'Gente entrenando', 'La pizarra'],
        cta: 'Apúntate en recepción',
      }),
    },
    {
      key: 'gim-3-motivos',
      name: '3 motivos',
      document: R.tresMotivos(theme, {
        purpose: 'Tres razones para empezar, una por plano y numeradas.',
        when: 'Para quien está pensando en apuntarse: en septiembre, en enero y antes del verano.',
        hook: '3 motivos para empezar',
        opener: 'La sala en marcha',
        items: ['Clases para todos los niveles', 'Entrenadores que te corrigen', 'Horario de mañana y tarde'],
        labels: ['Motivo 1: las clases', 'Motivo 2: los entrenadores', 'Motivo 3: el horario'],
        cta: 'Prueba una clase',
      }),
    },
    {
      key: 'gim-paseo',
      name: 'Paseo por el local',
      document: R.paseo(theme, {
        purpose: 'Recorrer el gimnasio por dentro, como lo ve quien entra por primera vez.',
        when: 'Para quien no lo conoce o cuando hay material o sala nuevos.',
        hook: 'Así es por dentro',
        stops: ['La entrada', 'La sala de fuerza', 'La zona de clases', 'Los vestuarios'],
        cta: 'Ven a verlo',
      }),
    },
  ],
  posts: (theme) => {
    const look = GIMNASIO_LOOK;
    return [
      {
        key: 'gim-titular-sobre-foto',
        name: 'Titular sobre foto',
        format: 'post',
        purpose: 'Una frase grande sobre una foto de la sala.',
        whenToUse: 'La base de la cuenta: motivación, clases nuevas, mensajes de la casa.',
        material: '1 foto vertical de la sala o de una clase, sin caras en primer plano.',
        background: 'dark',
        pages: one(
          P.titularSobreFoto(theme, look, {
            kicker: 'Esta semana',
            title: 'Titular de pocas palabras',
            sub: 'Una línea que lo explica.',
          }),
        ),
        caption: CAPTION.producto,
        photo: 'Plano abierto de la sala, con contraste; personas de espaldas o lejos.',
      },
      {
        key: 'gim-horario',
        name: 'Horario de la semana',
        format: 'post',
        purpose: 'El horario en una lista de dos columnas.',
        whenToUse: 'Cada semana o cuando cambian las clases. Se fija arriba del perfil.',
        material: 'Ninguna foto: los días y sus horas.',
        background: 'dark',
        pages: one(
          P.lista(theme, look, {
            kicker: 'Esta semana',
            title: 'Horario de clases',
            rows: [
              ['Lunes', '07:00 · 19:00'],
              ['Martes', '09:30 · 20:00'],
              ['Miércoles', '07:00 · 19:00'],
              ['Jueves', '09:30 · 20:00'],
              ['Viernes', '07:00 · 18:00'],
              ['Sábado', '10:00'],
            ],
            foot: 'Reserva tu plaza en recepción.',
          }),
        ),
        caption: CAPTION.aviso,
        photo: 'Sin foto.',
      },
      {
        key: 'gim-oferta-semana',
        name: 'Oferta de la semana',
        format: 'post',
        purpose: 'Foto arriba, nombre abajo y el precio en un sello.',
        whenToUse: 'Matrícula, bono o mes de prueba, con precio y fecha reales.',
        material: '1 foto horizontal o cuadrada de la sala.',
        background: 'dark',
        pages: one(
          P.oferta(theme, look, {
            kicker: 'Solo este mes',
            title: 'Nombre de la oferta',
            badge: '00 €',
            terms: 'Hasta el día 00. Condiciones en recepción.',
          }),
        ),
        caption: CAPTION.oferta,
        photo: 'La sala o una clase, sin caras en primer plano.',
      },
      {
        key: 'gim-antes-y-despues',
        name: 'Antes y después',
        format: 'post',
        purpose: 'Dos fotos, una encima de otra, cada una con su fecha.',
        whenToUse: `Para enseñar constancia. ${SIN_PROMESAS}`,
        material: '2 fotos con el mismo encuadre: la del principio y la de hoy.',
        background: 'dark',
        pages: one(
          P.antesYDespues(theme, look, { first: 'Mes 1', second: 'Mes 6', foot: 'Seis meses, tres días por semana.' }),
        ),
        caption: 'Cuenta el logro y el tiempo real que llevó. Nada de prometer el mismo resultado a quien lo lea.',
        photo: 'El mismo ejercicio o la misma marca en las dos fotos.',
      },
      {
        key: 'gim-3-motivos',
        name: '3 motivos',
        format: 'carousel',
        purpose: 'Carrusel de lista: una portada con la promesa y un punto por página.',
        whenToUse: 'Errores frecuentes, consejos o razones para empezar: lo que se guarda.',
        material: '3 fotos verticales, una por punto.',
        background: 'dark',
        pages: P.carruselMotivos(theme, look, {
          cover: { kicker: 'Desliza', title: '3 errores al empezar', body: 'Y cómo evitarlos.' },
          items: [
            { title: 'El primero', text: 'Qué pasa y cómo se corrige.' },
            { title: 'El segundo', text: 'Qué pasa y cómo se corrige.' },
            { title: 'El tercero', text: 'Qué pasa y cómo se corrige.' },
          ],
          end: { kicker: '¿Te suena?', title: 'Guárdalo para tu próximo día', foot: 'Pregunta a tu entrenador' },
        }),
        caption: CAPTION.lista,
        photo: 'Un ejercicio por foto; el texto va encima, sobre un velo.',
      },
      {
        key: 'gim-rutina-4-pasos',
        name: 'Rutina en 4 pasos',
        format: 'carousel',
        purpose: 'Carrusel paso a paso: un ejercicio por página con sus series.',
        whenToUse: 'Para que lo guarden. Sin prometer resultados.',
        material: '5 fotos: una de portada y una por ejercicio.',
        background: 'dark',
        pages: P.carruselPasos(theme, look, {
          cover: { kicker: 'Rutina', title: 'Rutina en 4 pasos', sub: 'Para hacer en la sala.' },
          steps: [
            { title: 'Ejercicio 1', text: '3 series de 12. En qué fijarse.' },
            { title: 'Ejercicio 2', text: '3 series de 10. En qué fijarse.' },
            { title: 'Ejercicio 3', text: '3 series de 15. En qué fijarse.' },
            { title: 'Ejercicio 4', text: '2 minutos. En qué fijarse.' },
          ],
          end: { kicker: 'Hecho', title: 'Guárdala y pruébala', foot: 'Pregunta a tu entrenador' },
        }),
        caption: CAPTION.lista,
        photo: 'El ejercicio en su punto más claro; mismo encuadre en todas.',
      },
      {
        key: 'gim-opinion',
        name: 'Opinión de un socio',
        format: 'post',
        purpose: 'La frase de un socio, en grande, con su nombre.',
        whenToUse:
          'Una al mes, con su permiso. Que hable de cómo se siente o de lo que ha conseguido, no de su cuerpo.',
        material: 'Ninguna foto: la frase y el nombre.',
        background: 'dark',
        pages: one(
          P.opinion(theme, look, {
            quote: 'Su frase, tal cual, en dos o tres líneas.',
            author: 'Nombre',
            detail: 'Socio desde 2000',
          }),
        ),
        caption: 'Preséntalo en una frase y da las gracias. No añadas nada que no haya dicho.',
        photo: 'Sin foto.',
      },
      {
        key: 'gim-equipo',
        name: 'Presentación del equipo',
        format: 'post',
        purpose: 'Un retrato con el nombre y la especialidad.',
        whenToUse: 'Para presentar a un entrenador o una actividad nueva. Con su permiso.',
        material: '1 retrato vertical, entrenando o mirando a cámara.',
        background: 'dark',
        pages: one(
          P.persona(theme, look, { name: 'Nombre', role: 'Entrenador · Boxeo', line: '«Su frase, entre comillas.»' }),
        ),
        caption: CAPTION.persona,
        photo: 'Retrato con la cara en la mitad de arriba.',
      },
      {
        key: 'gim-con-fecha',
        name: 'Con fecha',
        format: 'post',
        purpose: 'Foto arriba y, abajo, el día en grande con lo que pasa.',
        whenToUse: 'Reto del mes, puertas abiertas, velada o competición.',
        material: '1 foto horizontal o cuadrada.',
        background: 'dark',
        pages: one(
          P.fecha(theme, look, {
            day: '00',
            month: 'Mes',
            title: 'Nombre del reto',
            detail: '30 días. Apúntate en recepción.',
          }),
        ),
        caption: CAPTION.aviso,
        photo: 'La sala o el ejercicio del reto.',
      },
      {
        key: 'gim-aviso',
        name: 'Aviso',
        format: 'post',
        purpose: 'Un cartel de color con un aviso práctico.',
        whenToUse: 'Festivos, cambio de horario, sala cerrada o clase cancelada.',
        material: 'Ninguna foto: las fechas exactas.',
        background: 'accent',
        pages: one(
          P.cartel(
            theme,
            look,
            {
              kicker: 'Aviso',
              title: 'Horario de festivo',
              body: 'El día 00 abrimos de 09:00 a 14:00.',
              foot: 'Gracias',
            },
            'accent',
          ),
        ),
        caption: CAPTION.aviso,
        photo: 'Sin foto.',
      },
    ];
  },
};

// ───────────────────────────── Genérico ─────────────────────────────

const GENERICO_LOOK: P.Look = { surface: 'light', align: 'left', upper: false, italic: false, weight: 700 };

const generico: CatalogSet = {
  id: 'generico',
  name: 'Genérico',
  forWhom: 'Cualquier negocio: tiendas, servicios, talleres, clínicas, academias.',
  prefix: 'gen',
  look: GENERICO_LOOK,
  reels: (theme) => [
    {
      key: 'gen-asi-se-hace',
      name: 'Así se hace',
      document: R.asiSeHace(theme, {
        purpose: 'Enseñar cómo se hace un producto o un servicio, con el resultado como gancho.',
        when: 'Para lo que mejor sabéis hacer. Es la que mejor funciona para llegar a gente nueva.',
        hook: 'Así se hace',
        result: 'El resultado',
        steps: ['El material', 'Primer paso', 'Segundo paso', 'El acabado'],
        end: 'Terminado',
        cta: 'Pide el tuyo',
      }),
    },
    {
      key: 'gen-3-motivos',
      name: '3 motivos',
      document: R.tresMotivos(theme, {
        purpose: 'Tres razones para elegiros, una por plano y numeradas.',
        when: 'Para presentar el negocio a quien no lo conoce.',
        hook: '3 motivos para elegirnos',
        opener: 'Lo que mejor os representa',
        items: ['Primer motivo', 'Segundo motivo', 'Tercer motivo'],
        labels: ['Motivo 1', 'Motivo 2', 'Motivo 3'],
        cta: 'Ven a vernos',
      }),
    },
    {
      key: 'gen-antes-y-despues',
      name: 'Antes y después',
      document: R.antesYDespues(theme, {
        purpose: 'El mismo sitio o el mismo objeto antes y después del trabajo.',
        when: 'Reformas, arreglos, limpiezas, peluquería, restauraciones: cuando el cambio se ve.',
        hook: 'Mira el cambio',
        first: 'Antes',
        second: 'Después',
        firstLabel: 'Antes',
        secondLabel: 'Después, mismo encuadre',
        cta: 'Pide presupuesto',
        note: 'Con permiso del cliente si se le reconoce o es su casa.',
      }),
    },
    {
      key: 'gen-oferta-semana',
      name: 'Oferta de la semana',
      document: R.ofertaDeLaSemana(theme, {
        purpose: 'Anunciar una promoción con su precio y hasta cuándo dura.',
        when: 'Con una oferta real y con fecha. Como mucho, una de cada cuatro publicaciones.',
        hook: 'Esta semana',
        product: 'El producto, de cerca',
        price: 'Nombre · 00 €',
        terms: 'Hasta el domingo',
        cta: 'Ven a por él',
      }),
    },
    {
      key: 'gen-lo-nuevo',
      name: 'Lo nuevo',
      document: R.loNuevo(theme, {
        purpose: 'Presentar una novedad en pocos segundos.',
        when: 'Al recibir un producto nuevo o estrenar un servicio.',
        hook: 'Nuevo',
        name: 'Nombre de la novedad',
        angles: ['Entero', 'El detalle', 'En uso'],
        cta: 'Ven a verlo',
      }),
    },
    {
      key: 'gen-equipo',
      name: 'Presentación del equipo',
      document: R.presentacionDelEquipo(theme, {
        purpose: 'Poner cara y nombre a quien atiende.',
        when: 'De vez en cuando, o cuando entra alguien nuevo.',
        hook: 'Quién te atiende',
        place: 'El local',
        people: ['Nombre · Puesto', 'Nombre · Puesto', 'Nombre · Puesto'],
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'gen-un-dia-aqui',
      name: 'Un día aquí',
      document: R.unDiaAqui(theme, {
        purpose: 'Un día de trabajo en planos muy cortos, al golpe de la música.',
        when: 'Para enseñar el negocio por dentro.',
        hook: 'Un día aquí',
        shots: ['Se abre', 'Se prepara', 'Manos a la obra', 'Un cliente', 'El detalle', 'Se cierra'],
        cta: 'Te esperamos',
      }),
    },
    {
      key: 'gen-primera-persona',
      name: 'Contado en primera persona',
      document: R.enPrimeraPersona(theme, {
        purpose: 'Alguien del negocio, o un cliente, lo cuenta a cámara.',
        when: 'Para explicar algo que necesita palabras o para dar confianza.',
        quote: '«Lo que más nos preguntan»',
        who: 'Nombre · Puesto',
        talk: 'Habla a cámara',
        support: 'De lo que habla',
        cta: 'Pregúntanos',
      }),
    },
    {
      key: 'gen-fotos-con-ritmo',
      name: 'Fotos con ritmo',
      document: R.fotosConRitmo(theme, {
        purpose: 'Un reel solo con fotos, con cortes rápidos y zoom.',
        when: 'Cuando no hay vídeo: con las fotos que ya tenéis.',
        hook: 'Lo que hacemos',
        subject: 'Foto',
        cta: 'Ven a vernos',
      }),
    },
    {
      key: 'gen-fotos-con-calma',
      name: 'Fotos con calma',
      document: R.fotosConCalma(theme, {
        purpose: 'Un reel solo con fotos, despacio y con fundidos.',
        when: 'Para enseñar un trabajo o un producto sin prisa.',
        hook: 'Hecho con calma',
        subject: 'Foto',
        line: 'Una línea que lo explica',
        cta: 'Ven a vernos',
      }),
    },
  ],
  posts: (theme) => {
    const look = GENERICO_LOOK;
    return [
      {
        key: 'gen-foto-a-sangre',
        name: 'Foto a sangre',
        format: 'post',
        purpose: 'La foto sola, sin texto ni logotipo.',
        whenToUse: 'La base de la cuenta cuando las fotos son buenas.',
        material: '1 foto vertical (4:5).',
        background: 'dark',
        pages: one(P.fotoASangre(theme, look)),
        caption: CAPTION.producto,
        photo: 'Una sola cosa, bien iluminada, con fondo sencillo.',
      },
      {
        key: 'gen-foto-con-nombre',
        name: 'Foto con nombre',
        format: 'post',
        purpose: 'La foto con una franja abajo que dice qué es.',
        whenToUse: 'Para productos o servicios que se quieren dar a conocer por su nombre.',
        material: '1 foto vertical; lo importante, en los dos tercios de arriba.',
        background: 'dark',
        pages: one(P.fotoConFranja(theme, look, { kicker: 'Categoría', title: 'Nombre del producto' })),
        caption: CAPTION.producto,
        photo: 'La franja tapa la parte de abajo.',
      },
      {
        key: 'gen-titular-sobre-foto',
        name: 'Titular sobre foto',
        format: 'post',
        purpose: 'Una frase grande sobre la foto oscurecida.',
        whenToUse: 'Mensajes, temporadas y fechas señaladas.',
        material: '1 foto vertical de ambiente.',
        background: 'dark',
        pages: one(
          P.titularSobreFoto(theme, look, {
            kicker: 'Antetítulo',
            title: 'Titular de pocas palabras',
            sub: 'Una línea que lo explica.',
          }),
        ),
        caption: CAPTION.producto,
        photo: 'Se oscurece para que se lea el texto.',
      },
      {
        key: 'gen-oferta-semana',
        name: 'Oferta de la semana',
        format: 'post',
        purpose: 'Foto arriba, nombre abajo y el precio en un sello.',
        whenToUse: 'Promociones con precio y fecha reales.',
        material: '1 foto horizontal o cuadrada.',
        background: 'light',
        pages: one(
          P.oferta(theme, look, {
            kicker: 'Esta semana',
            title: 'Nombre de la oferta',
            badge: '00 €',
            terms: 'Hasta el domingo. Condiciones en una línea.',
          }),
        ),
        caption: CAPTION.oferta,
        photo: 'El producto entero, sin recortar por arriba.',
      },
      {
        key: 'gen-3-motivos',
        name: '3 motivos',
        format: 'carousel',
        purpose: 'Carrusel de lista: una portada con la promesa y un motivo por página.',
        whenToUse: 'Consejos, razones o productos: lo que se guarda y se envía.',
        material: '3 fotos verticales, una por motivo.',
        background: 'dark',
        pages: P.carruselMotivos(theme, look, {
          cover: { kicker: 'Desliza', title: '3 motivos para elegirnos', body: 'En menos de un minuto.' },
          items: [
            { title: 'Primer motivo', text: 'Explícalo en una línea.' },
            { title: 'Segundo motivo', text: 'Explícalo en una línea.' },
            { title: 'Tercer motivo', text: 'Explícalo en una línea.' },
          ],
          end: { kicker: '¿Hablamos?', title: 'Escríbenos', foot: 'Te contestamos hoy' },
        }),
        caption: CAPTION.lista,
        photo: 'El texto va encima, sobre un velo.',
      },
      {
        key: 'gen-paso-a-paso',
        name: 'Paso a paso',
        format: 'carousel',
        purpose: 'Carrusel paso a paso: el resultado en portada y un paso por página.',
        whenToUse: 'Para enseñar cómo se hace algo o cómo funciona un servicio.',
        material: '5 fotos: el resultado y una de cada paso.',
        background: 'light',
        pages: P.carruselPasos(theme, look, {
          cover: { kicker: 'Paso a paso', title: 'Así se hace', sub: 'En cuatro pasos.' },
          steps: [
            { title: 'Primer paso', text: 'Qué se hace y por qué.' },
            { title: 'Segundo paso', text: 'Qué se hace y por qué.' },
            { title: 'Tercer paso', text: 'Qué se hace y por qué.' },
            { title: 'Cuarto paso', text: 'Qué se hace y por qué.' },
          ],
          end: { kicker: '¿Te lo hacemos?', title: 'Pide el tuyo', foot: 'Escríbenos' },
        }),
        caption: CAPTION.lista,
        photo: 'Misma luz y mismo fondo en todas.',
      },
      {
        key: 'gen-antes-y-despues',
        name: 'Antes y después',
        format: 'post',
        purpose: 'Dos fotos, una encima de otra, cada una con su etiqueta.',
        whenToUse: 'Cuando el cambio se ve: reformas, arreglos, limpiezas. Con permiso del cliente.',
        material: '2 fotos con el mismo encuadre.',
        background: 'dark',
        pages: one(P.antesYDespues(theme, look, { first: 'Antes', second: 'Después' })),
        caption: 'Qué se hizo y cuánto se tardó. Sin exagerar el resultado.',
        photo: 'Mismo sitio, misma distancia y misma luz en las dos.',
      },
      {
        key: 'gen-opinion',
        name: 'Opinión de un cliente',
        format: 'post',
        purpose: 'Una reseña real, en grande, con quién la firma.',
        whenToUse: 'Con una reseña pública y con permiso. Sin retocar el texto.',
        material: 'Ninguna foto: la frase y el nombre.',
        background: 'light',
        pages: one(
          P.opinion(theme, look, {
            quote: 'La frase de la reseña, tal cual, en dos o tres líneas.',
            author: 'Nombre',
            detail: 'Reseña en Google',
          }),
        ),
        caption: 'Da las gracias. No añadas nada que la reseña no diga.',
        photo: 'Sin foto.',
      },
      {
        key: 'gen-equipo',
        name: 'Presentación del equipo',
        format: 'post',
        purpose: 'Un retrato con el nombre y el puesto.',
        whenToUse: 'Para presentar a alguien del equipo. Siempre con su permiso.',
        material: '1 retrato vertical.',
        background: 'dark',
        pages: one(P.persona(theme, look, { name: 'Nombre', role: 'Puesto', line: '«Su frase, entre comillas.»' })),
        caption: CAPTION.persona,
        photo: 'Retrato con la cara en la mitad de arriba.',
      },
      {
        key: 'gen-aviso',
        name: 'Aviso',
        format: 'post',
        purpose: 'Un cartel de color con un aviso práctico.',
        whenToUse: 'Vacaciones, cambio de horario o día cerrado.',
        material: 'Ninguna foto: las fechas exactas.',
        background: 'accent',
        pages: one(
          P.cartel(
            theme,
            look,
            {
              kicker: 'Aviso',
              title: 'Cambiamos de horario',
              body: 'Desde el día 00, de 00:00 a 00:00.',
              foot: 'Gracias',
            },
            'accent',
          ),
        ),
        caption: CAPTION.aviso,
        photo: 'Sin foto.',
      },
    ];
  },
};

export const CATALOG_SETS: CatalogSet[] = [restaurante, cocteleria, gimnasio, generico];
