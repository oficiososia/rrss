// Doble del proceso hijo de «Quitar el fondo» (src/cutout/child.ts) para probar process-engine.ts
// sin onnxruntime ni el modelo de 219 MB. Habla el mismo protocolo; el «modelo» que se le pide
// abrir decide qué hace: `ok`, `fail-open`, `hang` (no responde nunca al recortar), `crash`
// (muere al recortar) o `env` (devuelve en el error qué variables de entorno ve).
import type { ChildReply, ChildRequest } from '../../src/cutout/process-engine.ts';

const SIDE = 1024;
let mode = 'ok';
const reply = (message: ChildReply) => process.send!(message);

process.on('message', (message: ChildRequest) => {
  if (message.type === 'open') {
    mode = message.modelPath;
    if (mode === 'fail-open') return reply({ type: 'error', message: 'No se puede abrir el modelo' });
    if (mode === 'env') return reply({ type: 'error', message: Object.keys(process.env).sort().join(',') });
    // `modelBytes` lleva el pid del hijo: así la prueba puede comprobar que el proceso ha muerto.
    return reply({ type: 'opened', stats: { modelBytes: process.pid, modelReadMs: 7, sessionMs: 11, cpuMs: 13 } });
  }
  if (mode === 'hang') return undefined;
  if (mode === 'crash') return process.exit(3);
  // Devuelve la entrada resumida: 1 donde el primer canal es positivo.
  const alphas = new Float32Array(SIDE * SIDE);
  for (let i = 0; i < alphas.length; i += 1) alphas[i] = message.input[i]! > 0 ? 1 : 0;
  return reply({ type: 'done', alphas, stats: { cpuMs: 17, peakRssMb: 19 } });
});
process.on('disconnect', () => process.exit(0));
