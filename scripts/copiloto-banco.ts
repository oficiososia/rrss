// Banco de pruebas del copiloto del editor (`editor.copilot`): órdenes reales
// en español (sencillas, compuestas, ambiguas, imposibles, con jerga de
// hostelería y de gimnasio, y habla titubeante) contra lo que se espera de cada
// una. Sirve para comparar las dos rutas (herramientas y JSON) y, sobre todo,
// MODELOS: el modelo lo fija el servidor en Plataforma → Integraciones; se
// cambia allí, se relanza el banco con el mismo --salida y la tabla final los
// pone uno al lado del otro.
//
//   npx vite-node scripts/copiloto-banco.ts [opciones]
//
// Por defecto es EN SECO: sin red y sin coste. Cada caso pasa por la tarea real
// del servidor con un proveedor simulado que responde lo esperado, y después
// por lo que hace el editor (validar, quitar lo no dictado, aplicar). Comprueba
// que los casos se pueden ejecutar de principio a fin y enseña cuánto ocupa el
// prompt en cada ruta. Sale con código distinto de 0 si algún caso no cuadra.
//
// Con --apply llama a la función desplegada `ai-generate` (CUESTA DINERO y gasta
// cupo de IA de la organización). Antes dice cuántas llamadas va a hacer y pide
// confirmación (o --si). Variables de entorno, todas obligatorias:
//   COPILOTO_BANCO_URL       URL del proyecto de Supabase (https://…supabase.co)
//   COPILOTO_BANCO_ANON_KEY  clave pública (anon) del proyecto
//   COPILOTO_BANCO_TOKEN     token de sesión de una persona que edita la marca
//                            (se lee solo del entorno; no se imprime ni se guarda)
//   COPILOTO_BANCO_BRAND     identificador (uuid) de la marca
//
// Opciones:
//   --apply               llamar al servicio real (sin esto, en seco)
//   --modos tools,json    rutas que se prueban (por defecto, las dos)
//   --grupo <nombre>      solo un grupo: simple, compuesta, ambigua, imposible,
//                         hosteleria, gimnasio, titubeo, plan
//   --caso <id>           solo un caso
//   --detalle             en seco: una línea por caso y ruta
//   --repeticiones <n>    veces que se envía cada caso (por defecto 1)
//   --pausa <ms>          espera entre llamadas (por defecto 300)
//   --salida <archivo>    JSON donde se ACUMULAN los resultados entre ejecuciones
//   --incluir-locales     enviar también lo que resuelve el intérprete local
//   --audio <carpeta>     grabaciones (.wav, .m4a, .webm) con su casos.json:
//                         ver scripts/copiloto-banco/audio/LEEME.md
//   --precio-entrada <n>  precio por millón de tokens de entrada, para la estimación
//   --precio-salida <n>   precio por millón de tokens de salida
//   --si                  no preguntar antes de empezar
//
// El modelo real, los tokens, el coste y la latencia de cada llamada se leen de
// `ai_generations` con la sesión de la persona; si no se pueden leer, sigue y lo
// dice («desconocido», «—»).
import { createInterface } from 'node:readline/promises';
import {
  BENCH_MODES,
  dryRun,
  formatDryReport,
  runReal,
  selectCases,
  type RealOptions,
} from './copiloto-banco/banco.ts';
import { BENCH_CASES, BENCH_GROUPS, type BenchGroup } from './copiloto-banco/casos.ts';
import type { CopilotMode } from '../supabase/functions/_shared/ai/text/tasks/editor-copilot.ts';

export { BENCH_CASES } from './copiloto-banco/casos.ts';
export * from './copiloto-banco/banco.ts';

export class BenchUsageError extends Error {
  override name = 'BenchUsageError';
}

export interface BenchArgs extends RealOptions {
  apply: boolean;
  detail: boolean;
}

/** Lee los argumentos. Lanza `BenchUsageError` con lo que no entiende. */
export function parseArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = {
    apply: false,
    detail: false,
    modes: [...BENCH_MODES],
    repetitions: 1,
    pauseMs: 300,
    includeLocal: false,
    yes: false,
  };
  const number = (name: string, value: string | undefined, min: number) => {
    const parsed = Number(value);
    if (value === undefined || !Number.isFinite(parsed) || parsed < min) throw new BenchUsageError(`${name} necesita un número (mínimo ${min}).`);
    return parsed;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    const value = () => {
      i += 1;
      const next = argv[i];
      if (next === undefined || next.startsWith('--')) throw new BenchUsageError(`${flag} necesita un valor.`);
      return next;
    };
    if (flag === '--apply') args.apply = true;
    else if (flag === '--detalle') args.detail = true;
    else if (flag === '--si') args.yes = true;
    else if (flag === '--incluir-locales') args.includeLocal = true;
    else if (flag === '--modos') {
      const modes = value()
        .split(',')
        .map((mode) => mode.trim())
        .filter(Boolean);
      if (modes.length === 0 || modes.some((mode) => !(BENCH_MODES as readonly string[]).includes(mode))) {
        throw new BenchUsageError('--modos admite tools, json o los dos separados por coma.');
      }
      args.modes = [...new Set(modes)] as CopilotMode[];
    } else if (flag === '--grupo') {
      const group = value();
      if (!(BENCH_GROUPS as readonly string[]).includes(group)) throw new BenchUsageError(`--grupo admite: ${BENCH_GROUPS.join(', ')}.`);
      args.group = group as BenchGroup;
    } else if (flag === '--caso') args.caseId = value();
    else if (flag === '--repeticiones') args.repetitions = Math.floor(number(flag, value(), 1));
    else if (flag === '--pausa') args.pauseMs = Math.floor(number(flag, value(), 0));
    else if (flag === '--salida') args.output = value();
    else if (flag === '--audio') args.audioDir = value();
    else if (flag === '--precio-entrada') args.priceIn = number(flag, value(), 0);
    else if (flag === '--precio-salida') args.priceOut = number(flag, value(), 0);
    else throw new BenchUsageError(`No conozco la opción ${flag}. Las opciones están al principio de scripts/copiloto-banco.ts.`);
  }
  if (args.caseId && !BENCH_CASES.some((item) => item.id === args.caseId)) throw new BenchUsageError(`No existe el caso «${args.caseId}».`);
  if (args.audioDir && !args.apply) throw new BenchUsageError('--audio solo funciona con --apply (hay que transcribir las grabaciones).');
  return args;
}

/** Ejecuta el banco. Devuelve el código de salida. */
export async function main(argv: string[], log: (line: string) => void = console.log): Promise<number> {
  let args: BenchArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    log(error instanceof BenchUsageError ? error.message : 'No se han podido leer las opciones.');
    return 2;
  }
  if (!args.apply) {
    const cases = selectCases(args);
    if (cases.length === 0) {
      log(args.group === 'plan' ? 'El grupo «plan» todavía no tiene casos (es un punto de extensión).' : 'No hay casos con esos filtros.');
      return 0;
    }
    const report = await dryRun(cases, args.modes);
    log(`Banco del copiloto, EN SECO (sin red ni coste): ${cases.length} casos, rutas ${args.modes.join(' y ')}.`);
    log('');
    log(formatDryReport(report, cases, { detail: args.detail }));
    log('');
    log('Para medir un modelo de verdad: --apply (ver el principio de scripts/copiloto-banco.ts).');
    return report.ok ? 0 : 1;
  }
  const report = await runReal(args, {
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    log,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    confirm: async (question) => {
      if (!process.stdin.isTTY) {
        log('No hay nadie a quien preguntar (la entrada no es un terminal): relanza con --si para continuar.');
        return false;
      }
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^s[ií]?$/i.test((await readline.question(question)).trim());
      } finally {
        readline.close();
      }
    },
  });
  return report.exitCode;
}

// Solo al lanzarlo como script (con vite-node, los argumentos empiezan en el tercero); las
// pruebas (Vitest) importan `main` y lo llaman ellas.
if (process.env.VITEST === undefined) {
  process.exitCode = await main(process.argv.slice(2));
}
