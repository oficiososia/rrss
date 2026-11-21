// Modelo de «Quitar el fondo» en el navegador (docs/edicion-fotos.md, §7).
// Dónde está, cómo se llama su caché y qué hay que contarle a quien lo usa.
// No lleva nada de un cliente: el modelo es el mismo para todas las marcas.

/**
 * Modelo por defecto: IS-Net «general use» (DIS) en ONNX, con los pesos en
 * float16 y entrada y salida en float32 (≈ 84 MB), de `imgly/isnet-general-onnx`
 * en Hugging Face (CORS abierto, sin clave). Se descarga EN EL NAVEGADOR la
 * primera vez y se guarda en Cache Storage; el repositorio no lleva el modelo.
 *
 * Se puede servir desde el propio despliegue (o cualquier sitio con CORS) con
 * `VITE_CUTOUT_MODEL_URL`; por ejemplo, la versión cuantizada a uint8 de 46,7 MB
 * que ya usa el panel del restaurante, copiada a `public/models/`.
 */
export const DEFAULT_CUTOUT_MODEL_URL =
  'https://huggingface.co/imgly/isnet-general-onnx/resolve/main/onnx/model_fp16.onnx';

/** Tamaño aproximado (bytes), solo para el progreso si el servidor no dice la longitud. */
export const DEFAULT_CUTOUT_MODEL_BYTES = 88_152_708;

/** Caché del navegador donde se guarda el modelo. Cambiarla obliga a descargarlo otra vez. */
export const CUTOUT_MODEL_CACHE = 'rrss-cutout-model-v1';

/** Lado fijo de la entrada del modelo (IS-Net: 1×3×1024×1024). */
export const MODEL_SIDE = 1024;

/** Ficha que se enseña y se guarda en la procedencia (motor de respaldo). */
export const CUTOUT_MODEL_NAME = 'isnet-general-use';

/** Dirección del modelo de respaldo (IS-Net) en este despliegue. */
export function cutoutModelUrl(): string {
  const configured = String(import.meta.env.VITE_CUTOUT_MODEL_URL ?? '').trim();
  return configured || DEFAULT_CUTOUT_MODEL_URL;
}

// ── Motor principal: BEN2 base (fp16), solo con WebGPU ─────────────────────

/** Motores de recorte: `ben2` (calidad alta, WebGPU) e `isnet` (respaldo, calidad básica). */
export type CutoutEngineId = 'ben2' | 'isnet';

/**
 * BEN2 base en ONNX con pesos float16 (entrada y salida float32), de
 * `onnx-community/BEN2-ONNX` (licencia MIT; Hugging Face con CORS abierto, sin
 * clave). 219 121 675 bytes. Se descarga EN EL NAVEGADOR la primera vez y queda
 * en Cache Storage; el repositorio no lleva el modelo. Con otra dirección (por
 * ejemplo alojado en el propio despliegue): `VITE_CUTOUT_BEN2_URL`.
 */
export const DEFAULT_BEN2_MODEL_URL =
  'https://huggingface.co/onnx-community/BEN2-ONNX/resolve/main/onnx/model_fp16.onnx';
export const DEFAULT_BEN2_MODEL_BYTES = 219_121_675;
export const BEN2_MODEL_NAME = 'ben2-base-fp16';

/** Memoria (GB, `navigator.deviceMemory`) por debajo de la cual no se intenta BEN2 (pide ~4,6 GB en CPU; en GPU, menos). */
export const BEN2_MIN_MEMORY_GB = 4;

export function ben2ModelUrl(): string {
  const configured = String(import.meta.env.VITE_CUTOUT_BEN2_URL ?? '').trim();
  return configured || DEFAULT_BEN2_MODEL_URL;
}

export interface CutoutEngineSpec {
  id: CutoutEngineId;
  /** Nombre que se guarda en la procedencia. */
  name: string;
  url: string;
  bytes: number;
  /** Lado de la entrada del modelo (1×3×lado×lado). */
  side: number;
  /** `high` = calidad alta (BEN2); `basic` = respaldo. */
  quality: 'high' | 'basic';
}

export function engineSpec(id: CutoutEngineId): CutoutEngineSpec {
  return id === 'ben2'
    ? {
        id,
        name: BEN2_MODEL_NAME,
        url: ben2ModelUrl(),
        bytes: DEFAULT_BEN2_MODEL_BYTES,
        side: MODEL_SIDE,
        quality: 'high',
      }
    : {
        id,
        name: CUTOUT_MODEL_NAME,
        url: cutoutModelUrl(),
        bytes: DEFAULT_CUTOUT_MODEL_BYTES,
        side: MODEL_SIDE,
        quality: 'basic',
      };
}

/** Solo en las pruebas de punta a punta: sin modelo real, una máscara simulada (ver engine.ts). */
export function cutoutSimulated(): boolean {
  return import.meta.env.VITE_CUTOUT_SIMULATED === 'true';
}
