// Aviso «Sin música» del reel (docs/reels-calidad.md, punto 6). Los reels salen
// sin música por decisión del dueño (23/11/2026): la música se pone en la app de
// Instagram antes de publicar. Sin música ni sonido de los clips, el vídeo sale
// sin pista de audio; el trabajo terminado lo confirma en `result.output.audio`.
//
// Dos formas:
//   * `badge`: junto a «Exportar», en la cabecera del editor (sin botón: no
//     cuenta como acción; el texto entero va en el título y para lectores de pantalla);
//   * `line`: una línea con el aviso entero y, si la hoja tiene «Terminar en
//     Instagram» (rama f62), el enlace a ello. Lista para engancharla en la hoja
//     «Exportar» (`ExportSheet.tsx`), junto a los avisos de la vista previa.
import { VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reelAudioNotice } from '../quality';

type AudioPlan = Parameters<typeof reelAudioNotice>[0];

/**
 * El aviso entero, o null si el reel lleva música. Remite a «Terminar en Instagram» si esa
 * salida existe; si no, dice dónde se pone la música.
 */
export function audioNoticeText(plan: AudioPlan, finishInInstagram = false): string | null {
  const { notice } = reelAudioNotice(plan);
  if (!notice) return null;
  return finishInInstagram
    ? `${notice} Pon la música en Instagram con «Terminar en Instagram».`
    : `${notice} La música se pone en la app de Instagram antes de publicar.`;
}

export interface AudioNoticeProps {
  plan: AudioPlan;
  variant?: 'badge' | 'line';
  /** «Terminar en Instagram» (hoja «Exportar», rama f62), si existe: el aviso lleva a ello. */
  onFinishInInstagram?: () => void;
  className?: string;
}

export function AudioNotice({ plan, variant = 'badge', onFinishInInstagram, className }: AudioNoticeProps) {
  const text = audioNoticeText(plan, Boolean(onFinishInInstagram));
  if (!text) return null;
  if (variant === 'badge') {
    return (
      <span
        className={cn('inline-flex shrink-0 items-center gap-1 text-xs text-muted', className)}
        title={text}
        data-testid="reel-audio-notice"
      >
        <VolumeX className="h-3.5 w-3.5" aria-hidden />
        <span className="max-sm:sr-only" aria-hidden>
          Sin música
        </span>
        <span className="sr-only">{text}</span>
      </span>
    );
  }
  return (
    <p
      className={cn('flex flex-wrap items-center gap-x-1.5 text-xs text-muted', className)}
      data-testid="reel-audio-notice"
    >
      <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{reelAudioNotice(plan).notice}</span>
      {onFinishInInstagram ? (
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={onFinishInInstagram}
        >
          Pon la música con «Terminar en Instagram»
        </button>
      ) : (
        <span>La música se pone en la app de Instagram antes de publicar.</span>
      )}
    </p>
  );
}
