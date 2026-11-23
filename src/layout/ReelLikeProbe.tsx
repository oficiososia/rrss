import { useEffect } from 'react';
import { useReelLikeOptions } from '@/features/reels/like/api';

/**
 * Pregunta si «Hacer un reel como este» está disponible para la marca y lo avisa hacia arriba.
 * Va en un archivo aparte que el menú «Crear» carga bajo demanda: el módulo de reels (con sus
 * plantillas y su validador) pesa y no debe entrar en el primer paquete de JavaScript.
 */
export default function ReelLikeProbe({
  brandId,
  onChange,
}: {
  brandId: string;
  onChange: (brandId: string, available: boolean) => void;
}) {
  const like = useReelLikeOptions(brandId, true);
  const available = like.data?.available === true;
  useEffect(() => {
    onChange(brandId, available);
  }, [brandId, available, onChange]);
  return null;
}
