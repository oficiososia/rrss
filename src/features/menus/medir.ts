// Medir y partir textos para las plantillas de menús (Libre Baskerville).
//
// Una plantilla de menú no puede dejar que el texto se pise: cada plato lleva su caja con la altura
// justa y se coloca debajo del anterior. Para saber cuántas líneas ocupa un plato hay que medirlo:
// en el navegador, con el propio lienzo y la letra ya cargada (exacto); fuera de él (pruebas), con
// una estimación por clases de carácter, algo pesimista a propósito (mejor un hueco de más que un
// solape).
//
// Los nombres propios no se parten: «Santa Pola», «Granny Smith», «Touza Pub», «Altitud 912
// Crianza» llevan espacios duros (U+00A0), que ni el lienzo ni este medidor tratan como sitio donde
// partir una línea.

export const NBSP = ' ';

/** Letra de las plantillas de menús (incluida en la aplicación, ver `appFont.ts`). */
export const FUENTE_MENU = 'Libre Baskerville';

/** Ancho en píxeles de un texto de una línea con ese cuerpo y peso. */
export type Medidor = (texto: string, size: number, weight: number) => number;

const MAYUS = /[A-ZÁÉÍÓÚÜÑ]/;
const MINUS = /[a-záéíóúüñç]/;
const CIFRA = /[0-9]/;

/** Estimación del ancho de Libre Baskerville por clase de carácter (en «em»), algo por encima de lo real. */
export const medidorEstimado: Medidor = (texto, size, weight) => {
  let em = 0;
  for (const ch of texto) {
    if (ch === ' ' || ch === NBSP) em += 0.27;
    else if (MAYUS.test(ch)) em += 0.74;
    else if (MINUS.test(ch)) em += 0.53;
    else if (CIFRA.test(ch)) em += 0.58;
    else if ('.,;:!¡\'’|'.includes(ch)) em += 0.3;
    else if ('·–—-'.includes(ch)) em += 0.45;
    else em += 0.6;
  }
  return em * size * (weight >= 600 ? 1.08 : 1) * 1.03;
};

let canvasCtx: CanvasRenderingContext2D | null | undefined;

/** Medidor con el lienzo del navegador (exacto si la letra está cargada); `null` si no hay lienzo. */
export function medidorDeLienzo(familia: string): Medidor | null {
  if (canvasCtx === undefined) {
    try {
      canvasCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      canvasCtx = null;
    }
  }
  const ctx = canvasCtx;
  if (!ctx) return null;
  // Una pequeña holgura (2 %): el lienzo de Konva y este pueden diferir en un píxel por línea.
  return (texto, size, weight) => {
    ctx.font = `${weight} ${size}px "${familia}", serif`;
    return ctx.measureText(texto).width * 1.02;
  };
}

// Mayúscula inicial o cifra: parte de un nombre propio, una cantidad o una marca («5J», «912»).
const EMPIEZA_FUERTE = /^[«"(¡¿]*[A-ZÁÉÍÓÚÜÑ0-9]/;
const TERMINA_PAUSA = /[.,;:!?)»"]$/;
const MAX_ENCADENADOS = 3;

/**
 * Pega con espacios duros los nombres propios y las cantidades de una línea de plato: una palabra con
 * mayúscula (o cifra) detrás de otra palabra con mayúscula (o cifra) se queda con ella («Santa Pola», «Granny Smith»); un
 * número con su unidad («120 €», «21:00 h», «75 cl») también. La primera palabra de la línea no se
 * pega a nada por la izquierda, y una cadena no pasa de tres palabras (si alguien escribe todo con
 * mayúsculas no sale una línea que no se pueda partir).
 */
export function sinPartirNombres(texto: string): string {
  const unidades = texto.replace(/(\d)[ \u00A0]+(€|h\b|cl\b|ml\b|g\b|kg\b)/g, `$1${NBSP}$2`);
  const palabras = unidades.split(' ');
  let out = palabras[0] ?? '';
  let cadena = 1;
  for (let i = 1; i < palabras.length; i++) {
    const palabra = palabras[i]!;
    const anterior = palabras[i - 1]!;
    const pega =
      EMPIEZA_FUERTE.test(palabra) &&
      EMPIEZA_FUERTE.test(anterior) &&
      !TERMINA_PAUSA.test(anterior) &&
      cadena < MAX_ENCADENADOS;
    out += (pega ? NBSP : ' ') + palabra;
    cadena = pega ? cadena + 1 : 1;
  }
  return out;
}

/** Quita los espacios duros: para comparar o mostrar un texto como lo escribió la persona. */
export function conEspaciosNormales(texto: string): string {
  return texto.split(NBSP).join(' ');
}

/**
 * Parte un texto en líneas con el ancho dado (voraz, solo por espacios normales y saltos de línea).
 * Una palabra más ancha que la caja se parte por letras, como hace el lienzo.
 */
export function partirLineas(texto: string, ancho: number, size: number, weight: number, medir: Medidor): string[] {
  const lineas: string[] = [];
  for (const parrafo of texto.split('\n')) {
    const palabras = parrafo.split(' ').filter((p) => p !== '');
    if (palabras.length === 0) {
      lineas.push('');
      continue;
    }
    let actual = '';
    for (const palabra of palabras) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (medir(prueba, size, weight) <= ancho || actual === '') {
        actual = prueba;
        if (medir(actual, size, weight) > ancho) {
          // Palabra sola más ancha que la caja: se parte por letras.
          let trozo = '';
          for (const ch of actual) {
            if (trozo && medir(trozo + ch, size, weight) > ancho) {
              lineas.push(trozo);
              trozo = '';
            }
            trozo += ch;
          }
          actual = trozo;
        }
      } else {
        lineas.push(actual);
        actual = palabra;
      }
    }
    lineas.push(actual);
  }
  return lineas;
}

/** Líneas que ocupa un texto con ese ancho y cuerpo. */
export function contarLineas(texto: string, ancho: number, size: number, weight: number, medir: Medidor): number {
  return partirLineas(texto, ancho, size, weight, medir).length;
}

/** Altura de `lineas` líneas (la caja de Konva mide líneas × cuerpo × interlineado). */
export function alturaDe(lineas: number, size: number, interlineado: number): number {
  return Math.ceil(lineas * size * interlineado);
}
