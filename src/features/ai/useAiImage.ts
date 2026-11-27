// ¿Puede quien mira generar una imagen con IA en esta marca? Lo mismo que decide el
// editor de piezas para su botón «Con IA»: el interruptor de la plataforma y, en una
// marca en modo agencia, que el servidor no se la cierre (solo el personal de la agencia).
import { useBrand } from '@/features/orgs/context';
import { useFeature } from '@/features/platform/integrations/useFeature';
import { useImageAgencyBlock, type ImageAspectRatio } from './imageApi';

export function useAiImageAvailable(): boolean {
  const { brand } = useBrand();
  const on = useFeature('aiImage');
  const blocked = useImageAgencyBlock(brand.id, on && brand.ai_mode === 'agency');
  return on && !blocked;
}

const RATIOS: Array<{ value: ImageAspectRatio; ratio: number }> = [
  { value: '1:1', ratio: 1 },
  { value: '4:5', ratio: 4 / 5 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '16:9', ratio: 16 / 9 },
];

/** La proporción de imagen con IA más parecida a una caja (un hueco de foto, un plano). */
export function nearestImageRatio(width: number, height: number): ImageAspectRatio {
  if (!(width > 0) || !(height > 0)) return '1:1';
  const target = Math.log(width / height);
  return RATIOS.reduce((best, r) =>
    Math.abs(Math.log(r.ratio) - target) < Math.abs(Math.log(best.ratio) - target) ? r : best,
  ).value;
}
