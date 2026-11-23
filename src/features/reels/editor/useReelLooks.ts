// La luz y el fondo de las fotos de la biblioteca (`photoLook`, quality.ts), para ordenar
// los selectores de material: se mira la MINIATURA de cada foto (unos 400 px, la que la
// cuadrícula ya enseña) en un lienzo pequeño. Lo medido se recuerda mientras dure la
// sesión (por ruta), así que el editor puede usarlo después al montar desde una plantilla.
//
// Si una miniatura no se puede leer (sin CORS, sin lienzo), esa foto se ordena solo por
// sus datos (resolución, proporción, nombre): nada se inventa.
import { useEffect, useMemo, useState } from 'react';
import { previewPath, useSignedUrls } from '@/features/library/api';
import { loadCorsImage } from '@/lib/corsImage';
import { photoLook, type PhotoLook, type PhotoLooks } from '../quality';

/** Lado de la copia que se mide (proporción 3:4, la de la mayoría de fotos de móvil). */
const SAMPLE_W = 96;
const SAMPLE_H = 128;
/** Cuántas fotos se miran como mucho de una vez (las primeras de la lista). */
export const MAX_LOOKS = 160;
/** Lo que se espera como mucho antes de ordenar con lo que haya. */
const SETTLE_MS = 2500;

const cache = new Map<string, PhotoLook | null>();

interface LookAsset {
  id: string;
  kind: string;
  storage_path: string;
  thumb_path?: string | null;
}

/** Lo ya medido de estas fotos (id → aspecto), sin esperar a nada. */
export function cachedLooks(assets: readonly LookAsset[]): PhotoLooks {
  const out = new Map<string, PhotoLook | null>();
  for (const asset of assets) {
    if (cache.has(asset.storage_path)) out.set(asset.id, cache.get(asset.storage_path)!);
  }
  return out;
}

/** Mide una imagen ya cargada: una copia de 96 × 128 recortada al centro. Null si el navegador no deja leerla. */
export function measureImage(image: CanvasImageSource & { width: number; height: number }): PhotoLook | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !image.width || !image.height) return null;
  try {
    const scale = Math.max(SAMPLE_W / image.width, SAMPLE_H / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    context.drawImage(image, (SAMPLE_W - w) / 2, (SAMPLE_H - h) / 2, w, h);
    return photoLook(context.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data, SAMPLE_W, SAMPLE_H);
  } catch {
    return null;
  }
}

/**
 * Aspecto de las fotos de la lista (las primeras `MAX_LOOKS`). `settled` se pone a `true`
 * cuando están todas medidas (o no se han podido medir) o pasados 2,5 s: quien ordena
 * puede esperar a ese momento para no reordenar la lista mientras se mira.
 */
export function useReelLooks(
  assets: readonly LookAsset[],
  enabled = true,
  measure: (url: string) => Promise<PhotoLook | null> = async (url) => measureImage(await loadCorsImage(url)),
): { looks: PhotoLooks; settled: boolean } {
  const photos = useMemo(
    () => (enabled ? assets.filter((a) => a.kind === 'image').slice(0, MAX_LOOKS) : []),
    [assets, enabled],
  );
  const missing = useMemo(() => photos.filter((a) => !cache.has(a.storage_path)), [photos]);
  const paths = useMemo(() => missing.map(previewPath).sort(), [missing]);
  const signed = useSignedUrls(paths);
  const [version, setVersion] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setTimedOut(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled]);

  useEffect(() => {
    if (!signed.data && !signed.isError) return;
    let alive = true;
    for (const asset of missing) {
      const url = signed.data?.get(previewPath(asset));
      if (!url) {
        cache.set(asset.storage_path, null);
        continue;
      }
      if (cache.has(asset.storage_path)) continue;
      measure(url)
        .catch(() => null)
        .then((look) => {
          cache.set(asset.storage_path, look);
          if (alive) setVersion((v) => v + 1);
        });
    }
    // Lo que no tiene dirección ya está decidido: se avisa fuera del efecto.
    void Promise.resolve().then(() => alive && setVersion((v) => v + 1));
    return () => {
      alive = false;
    };
    // `measure` es estable en la práctica (la de por defecto o la de una prueba).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, signed.data, signed.isError]);

  return useMemo(() => {
    void version;
    const looks = cachedLooks(photos);
    const done = photos.every((a) => cache.has(a.storage_path));
    return { looks, settled: !enabled || done || timedOut || (paths.length > 0 && signed.isError) };
  }, [photos, version, enabled, timedOut, paths.length, signed.isError]);
}
