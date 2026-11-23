// Proceso hijo de «Quitar el fondo»: lo lanza `process-engine.ts` (uno por trabajo) y aquí
// dentro corre onnxruntime, que bloquea el proceso mientras carga el modelo y mientras infiere.
// Habla con el trabajador por el canal IPC; no toca la red, la cola ni el almacenamiento, y no
// tiene ningún secreto en su entorno. El trabajador lo mata al terminar o al cancelar.
import { createOrtEngine, type CutoutSession } from './engine.ts';
import type { ChildReply, ChildRequest } from './process-engine.ts';

if (!process.send) {
  process.stderr.write('Este módulo solo se ejecuta como proceso hijo del trabajador (process-engine.ts).\n');
  process.exit(2);
}

let session: CutoutSession | undefined;

const reply = (message: ChildReply) =>
  new Promise<void>((resolve) => {
    process.send!(message, () => resolve());
  });

async function handle(message: ChildRequest): Promise<void> {
  try {
    if (message.type === 'open') {
      session = await createOrtEngine({ modelPath: message.modelPath, threads: message.threads }).open();
      await reply({ type: 'opened', stats: session.opened! });
    } else {
      if (!session) throw new Error('El modelo no está abierto');
      const alphas = await session.run(message.input);
      await reply({ type: 'done', alphas, stats: session.lastRun! });
    }
  } catch (error) {
    await reply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

process.on('message', (message: ChildRequest) => void handle(message));
// Si el trabajador desaparece, este proceso no se queda vivo.
process.on('disconnect', () => process.exit(0));
