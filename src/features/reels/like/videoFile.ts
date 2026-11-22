// Lo que se puede saber de un vídeo antes de subirlo, en el navegador.

/**
 * Duración del vídeo en segundos, o null si el navegador no la sabe leer (en
 * ese caso se sube igual y la comprueba el trabajador).
 */
export function videoSeconds(file: File, timeoutMs = 4000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof URL.createObjectURL !== 'function') {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (value: number | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}
