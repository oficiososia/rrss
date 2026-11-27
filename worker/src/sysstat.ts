// Contadores del sistema para el registro de diagnóstico (solo Linux: /proc). En otro sistema
// devuelven `undefined` y el registro sale sin esos campos.
//
// Para qué: distinguir, con una línea de registro, POR QUÉ una fase tarda más de lo normal.
//   · `stealMs` alto  → el anfitrión no deja correr a la máquina virtual (en Fly, cuota de CPU
//                       de las `shared-cpu-*` agotada: docs/alojamiento.md, §3.1).
//   · `iowaitMs` alto y `swapUsedMb` > 0 → falta memoria y se está usando el intercambio.
//   · `cpuMs` ≈ `ms` × hilos → la fase ha tenido el procesador para ella: es lo que cuesta.
import { readFileSync } from 'node:fs';

/** Un tic de /proc son 10 ms (USER_HZ = 100 en todas las arquitecturas de Linux que usamos). */
const TICK_MS = 10;

export interface SystemCpu {
  /** Tiempo que la máquina virtual quiso correr y el anfitrión no la dejó, sumado entre núcleos. */
  stealMs: number;
  /** Tiempo esperando al disco (también al intercambio), sumado entre núcleos. */
  iowaitMs: number;
}

/** Acumulados desde el arranque de la máquina; se usan restando dos lecturas. */
export function readSystemCpu(file = '/proc/stat'): SystemCpu | undefined {
  try {
    const line = readFileSync(file, 'utf8').split('\n', 1)[0] ?? '';
    // cpu  user nice system idle iowait irq softirq steal guest guest_nice
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== 'cpu' || fields.length < 9) return undefined;
    const iowait = Number(fields[5]);
    const steal = Number(fields[8]);
    if (!Number.isFinite(iowait) || !Number.isFinite(steal)) return undefined;
    return { stealMs: steal * TICK_MS, iowaitMs: iowait * TICK_MS };
  } catch {
    return undefined;
  }
}

/** Megas de intercambio en uso ahora mismo. */
export function readSwapUsedMb(file = '/proc/meminfo'): number | undefined {
  try {
    const text = readFileSync(file, 'utf8');
    const kb = (name: string) => {
      const match = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text);
      return match ? Number(match[1]) : undefined;
    };
    const total = kb('SwapTotal');
    const free = kb('SwapFree');
    if (total === undefined || free === undefined) return undefined;
    return Math.round((total - free) / 1024);
  } catch {
    return undefined;
  }
}

/** CPU (usuario + sistema) que lleva consumida otro proceso, en ms. */
export function readProcessCpuMs(pid: number, file = `/proc/${pid}/stat`): number | undefined {
  try {
    const text = readFileSync(file, 'utf8');
    // El nombre del proceso va entre paréntesis y puede llevar espacios: se cuenta desde el último «)».
    const rest = text
      .slice(text.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/);
    // `rest[0]` es el campo 3 (estado); utime y stime son los campos 14 y 15.
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return undefined;
    return (utime + stime) * TICK_MS;
  } catch {
    return undefined;
  }
}
