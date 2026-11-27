/// <reference lib="webworker" />
// Worker del guardado con retoques (ver `retouch.ts`): recibe la foto, la máscara base y los
// trazos, y devuelve el resultado a tamaño completo sin tocar el hilo principal.
import { computeRetouch, type RetouchMessage, type RetouchReply } from './retouch';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<RetouchMessage>) => {
  const { id, job } = event.data;
  try {
    const pixels = computeRetouch(job);
    const reply: RetouchReply = { id, ok: true, pixels };
    scope.postMessage(reply, [pixels.data.buffer]);
  } catch (error) {
    const reply: RetouchReply = { id, ok: false, message: (error as Error)?.message ?? 'Error al calcular la foto.' };
    scope.postMessage(reply);
  }
};
