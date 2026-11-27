// El modelo de «Quitar el fondo», en un PROCESO HIJO (`child.ts`) en vez de en el del trabajador.
//
// Por qué: onnxruntime-node carga el modelo y hace la inferencia de forma síncrona. Dentro del
// proceso del trabajador eso lo dejaba sordo todo ese rato (23 s en Fly cuando va bien; casi
// 3 minutos el 22/11/2026, con el procesador de la máquina frenado): sin renovar la reserva,
// sin atender SIGTERM, sin escribir una línea de registro y sin poder parar un trabajo que el
// cliente ya había cancelado. Con el hijo:
//   · el trabajador sigue vivo: renueva la reserva, escribe el latido y atiende el apagado;
//   · cancelar (o perder la reserva) MATA el hijo en el acto: no se sigue gastando procesador
//     en un recorte que ya nadie espera;
//   · si el sistema mata el hijo por falta de memoria, el trabajador sobrevive, lo dice en el
//     registro y el trabajo se reintenta (antes moría el trabajador entero, sin registro);
//   · toda la memoria del modelo vuelve al sistema al terminar cada trabajo.
// El hijo no recibe ningún secreto: se le quitan del entorno el token del intermediario y
// cualquier clave. Los tensores (12,6 MB de entrada, 4,2 MB de salida) viajan por el canal IPC.
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readProcessCpuMs } from '../sysstat.ts';
import {
  BEN2_MODEL_NAME,
  DEFAULT_THREADS,
  type CutoutEngine,
  type CutoutOpenStats,
  type CutoutRunStats,
  type CutoutSession,
  type OrtEngineOptions,
} from './engine.ts';

export type ChildRequest =
  | { type: 'open'; modelPath: string; threads: number }
  | { type: 'run'; input: Float32Array };

export type ChildReply =
  | { type: 'opened'; stats: CutoutOpenStats }
  | { type: 'done'; alphas: Float32Array; stats: CutoutRunStats }
  | { type: 'error'; message: string };

export interface ProcessEngineOptions extends OrtEngineOptions {
  /** Módulo que hace de hijo (en las pruebas, un doble sin onnxruntime). */
  childModule?: string;
}

/** Entorno del hijo: el del trabajador sin nada que parezca un secreto ni la configuración de Supabase. */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !/TOKEN|KEY|SECRET|PASSWORD|SUPABASE/i.test(name)),
  );
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal === 'SIGKILL') {
    return 'El proceso del modelo murió (SIGKILL): lo más probable es que la máquina se haya quedado sin memoria';
  }
  return `El proceso del modelo terminó antes de tiempo (${signal ? `señal ${signal}` : `código ${code}`})`;
}

export function createProcessEngine(options: ProcessEngineOptions): CutoutEngine {
  const childModule = options.childModule ?? fileURLToPath(new URL('./child.ts', import.meta.url));
  const threads = options.threads ?? DEFAULT_THREADS;

  return {
    model: BEN2_MODEL_NAME,
    async open(signal) {
      signal?.throwIfAborted();
      const child: ChildProcess = fork(childModule, [], {
        // Sin las opciones de Node de quien nos lanza (en las pruebas, las de vitest).
        execArgv: [],
        env: childEnv(process.env),
        serialization: 'advanced',
        // Lo que onnxruntime escriba por la salida de errores se ve en el registro del alojamiento.
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });

      let exit: string | undefined;
      let killedByUs = false;
      let pending: { resolve(reply: ChildReply): void; reject(error: unknown): void } | undefined;
      const settle = () => {
        const waiting = pending;
        pending = undefined;
        return waiting;
      };
      const kill = () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        killedByUs = true;
        child.kill('SIGKILL');
      };
      // Si el trabajador sale con el hijo en marcha, el hijo no se queda huérfano calculando.
      process.once('exit', kill);
      child.on('message', (reply: ChildReply) => settle()?.resolve(reply));
      child.on('error', (error) => {
        exit ??= `No se pudo lanzar el proceso del modelo: ${error.message}`;
        settle()?.reject(new Error(exit));
      });
      child.on('exit', (code, exitSignal) => {
        process.removeListener('exit', kill);
        exit ??= killedByUs ? 'El proceso del modelo se paró' : describeExit(code, exitSignal);
        settle()?.reject(new Error(exit));
      });

      /** Una petición a la vez. Si se aborta, se mata el hijo: es lo único que corta una inferencia. */
      const request = (message: ChildRequest, requestSignal?: AbortSignal) =>
        new Promise<ChildReply>((resolve, reject) => {
          if (exit) return reject(new Error(exit));
          if (requestSignal?.aborted) {
            kill();
            return reject(requestSignal.reason);
          }
          const onAbort = () => {
            kill();
            settle()?.reject(requestSignal!.reason);
          };
          const done = () => requestSignal?.removeEventListener('abort', onAbort);
          pending = {
            resolve: (reply) => {
              done();
              if (reply.type === 'error') reject(new Error(reply.message));
              else resolve(reply);
            },
            reject: (error) => {
              done();
              reject(error);
            },
          };
          requestSignal?.addEventListener('abort', onAbort, { once: true });
          child.send(message, (error) => {
            if (error) settle()?.reject(error);
          });
        });

      const release = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        kill();
        // Se espera a que muera: así su memoria ya ha vuelto al sistema antes del trabajo siguiente.
        await exited.catch(() => undefined);
      };

      let opened: CutoutOpenStats;
      try {
        const reply = await request({ type: 'open', modelPath: options.modelPath, threads }, signal);
        if (reply.type !== 'opened') throw new Error('El proceso del modelo respondió algo inesperado al abrir');
        opened = reply.stats;
      } catch (error) {
        await release();
        throw error;
      }

      const session: CutoutSession = {
        opened,
        async run(input, runSignal) {
          const reply = await request({ type: 'run', input }, runSignal);
          if (reply.type !== 'done') throw new Error('El proceso del modelo respondió algo inesperado al recortar');
          session.lastRun = reply.stats;
          return reply.alphas;
        },
        release,
        cpuMs: () => (child.pid === undefined ? undefined : readProcessCpuMs(child.pid)),
      };
      return session;
    },
  };
}
