// Qué motor quita el fondo: BEN2 (calidad alta) solo si hay WebGPU y memoria; si
// no, o si ya falló en esta sesión, IS-Net (calidad básica). Sin DOM ni
// onnxruntime: las comprobaciones se pasan, para probarlas con dobles.
import { BEN2_MIN_MEMORY_GB, type CutoutEngineId } from './model';

export interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

export interface EngineProbe {
  /** `navigator.gpu`, si el navegador lo tiene. */
  gpu?: GpuLike | null;
  /** `navigator.deviceMemory` (GB), si el navegador lo dice. */
  deviceMemory?: number;
  /** BEN2 ya falló en esta sesión (operadores, memoria…): no se vuelve a intentar. */
  ben2Failed?: boolean;
}

export interface EngineChoice {
  engine: CutoutEngineId;
  /** Por qué no BEN2 (solo con `isnet`), para el registro y las pruebas. */
  reason?: 'no-webgpu' | 'no-adapter' | 'low-memory' | 'failed-before';
}

/** ¿Hay WebGPU de verdad (API y un adaptador que responda)? */
export async function hasWebgpu(gpu: GpuLike | null | undefined): Promise<boolean> {
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export async function chooseEngine(probe: EngineProbe): Promise<EngineChoice> {
  if (probe.ben2Failed) return { engine: 'isnet', reason: 'failed-before' };
  if (!probe.gpu) return { engine: 'isnet', reason: 'no-webgpu' };
  if (typeof probe.deviceMemory === 'number' && probe.deviceMemory < BEN2_MIN_MEMORY_GB) {
    return { engine: 'isnet', reason: 'low-memory' };
  }
  if (!(await hasWebgpu(probe.gpu))) return { engine: 'isnet', reason: 'no-adapter' };
  return { engine: 'ben2' };
}

/** Lo que mira `chooseEngine` en este navegador. */
export function probeNavigator(
  nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
  ben2Failed = false,
): EngineProbe {
  const n = nav as (Navigator & { gpu?: GpuLike; deviceMemory?: number }) | undefined;
  return { gpu: n?.gpu ?? null, deviceMemory: n?.deviceMemory, ben2Failed };
}
