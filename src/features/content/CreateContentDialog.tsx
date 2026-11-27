import { ChevronLeft, Images, Loader2, Plus, Sparkles, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, Skeleton } from '@/components/ui';
import { reelLikeEnabled } from '@/config/app';
import { costSentence } from '@/features/ai/cupo';
import { useAiQuota } from '@/features/ai/api';
import { useOrg } from '@/features/orgs/context';
import { useWorkMode } from '@/features/orgs/workMode';
import { TemplateSample } from '@/features/reels/editor/TemplateCards';
import { useBrandReelTemplates } from '@/features/reels/editor/api';
import { reelLikePaths, useReelLikeOptions } from '@/features/reels/like/api';
import { REEL_TEMPLATES } from '@/features/reels/templates';
import { cn } from '@/lib/utils';
import { FORMAT_CARDS, type FormatCard } from './lista/formats';
import { useBrandTemplates } from './templates/api';
import { TemplateThumb } from './templates/TemplateThumb';
import { useTemplatePreviews } from './templates/useTemplatePreviews';
import { useStartPiece } from './useStartPiece';

// «¿Qué quieres crear?» (simplificación aceptada, apartado 6, N1): un solo paso. Se toca el formato y
// sale su galería con «En blanco» la primera; al tocar una tarjeta se crea la pieza y se abre su
// editor. Sin nombre (se pone solo, el formato y el día, y se cambia en el editor) ni botones
// «Cancelar» / «Crear».

/** Orden de los formatos al crear: lo que más importa (el reel) primero. */
const ORDER = ['reel', 'post', 'carousel', 'story'];
const CARDS: FormatCard[] = ORDER.map((format) => FORMAT_CARDS.find((card) => card.format === format)!).filter(Boolean);

interface CreateContentDialogProps {
  organizationId: string;
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Formato ya elegido (los accesos de «＋ Crear»): se abre directamente su galería. */
  initialFormat?: string;
}

export function CreateContentDialog({ organizationId, brandId, open, onOpenChange, initialFormat }: CreateContentDialogProps) {
  const valid = CARDS.some((card) => card.format === initialFormat) ? initialFormat! : null;
  const [format, setFormat] = useState<string | null>(valid);
  const card = CARDS.find((c) => c.format === format) ?? null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setFormat(valid);
      }}
      size="lg"
      title={card ? card.label : '¿Qué quieres crear?'}
    >
      {card ? (
        <Gallery
          organizationId={organizationId}
          brandId={brandId}
          card={card}
          onBack={() => setFormat(null)}
          onClose={() => onOpenChange(false)}
        />
      ) : (
        <Formats organizationId={organizationId} brandId={brandId} onPick={setFormat} onClose={() => onOpenChange(false)} />
      )}
    </Dialog>
  );
}

/** Marco con la proporción del formato y su icono. */
function RatioFrame({ ratio, icon: Icon, active }: { ratio: number; icon: LucideIcon; active?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-12 shrink-0 items-center justify-center rounded-md border-2 border-dashed',
        active ? 'border-primary text-primary' : 'border-border text-muted',
      )}
      style={{ aspectRatio: String(ratio) }}
      aria-hidden
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

const TILE =
  'flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-border p-3 text-left transition-colors hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:min-h-[8.5rem] sm:flex-col sm:justify-center sm:text-center';

/** Paso único: los formatos, «Hacer un reel como este» si el servidor puede y, en el móvil, «Subir fotos». */
function Formats({
  organizationId,
  brandId,
  onPick,
  onClose,
}: {
  organizationId: string;
  brandId: string;
  onPick: (format: string) => void;
  onClose: () => void;
}) {
  const { isAdmin } = useOrg();
  const { selfManaged } = useWorkMode();
  const like = useReelLikeOptions(brandId, reelLikeEnabled());
  // En autogestión el cupo no se enseña: ni se pregunta.
  const quota = useAiQuota(organizationId, !selfManaged && isAdmin && Boolean(like.data?.available));
  const likeCost = like.data?.estimate
    ? costSentence(like.data.estimate.maxMicros, { selfManaged, limitMicros: quota.data?.limit_value })
    : null;
  const base = `/o/${organizationId}/m/${brandId}`;

  const formatTile = (card: FormatCard) => (
    <li key={card.format}>
      <button type="button" className={TILE} onClick={() => onPick(card.format)} data-testid={`create-content-format-${card.format}`}>
        <RatioFrame ratio={card.ratio} icon={card.icon} active={card.format === 'reel'} />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{card.label}</span>
          <span className="block text-xs text-muted">{card.hint}</span>
        </span>
      </button>
    </li>
  );

  return (
    <ul className="grid gap-2 sm:grid-cols-3" aria-label="Qué crear" data-testid="create-content-format">
      {formatTile(CARDS[0]!)}
      {like.data?.available && (
        <li>
          <Link to={reelLikePaths(organizationId, brandId).start} onClick={onClose} className={TILE} data-testid="create-content-reel-like">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary" aria-hidden>
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">Reel como este</span>
              <span className="block text-xs text-muted">
                Copia el ritmo de un reel que te guste.
                {likeCost && <span data-testid="create-content-reel-like-cost"> {likeCost}</span>}
              </span>
            </span>
          </Link>
        </li>
      )}
      {CARDS.slice(1).map(formatTile)}
      <li className="sm:hidden">
        <Link to={`${base}/biblioteca`} onClick={onClose} className={TILE} data-testid="create-content-upload">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-subtle text-muted" aria-hidden>
            <Images className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Subir fotos</span>
            <span className="block text-xs text-muted">A la biblioteca</span>
          </span>
        </Link>
      </li>
    </ul>
  );
}

/** Galería del formato: «En blanco» la primera y, detrás, las plantillas de la marca de ese formato. */
function Gallery({
  organizationId,
  brandId,
  card,
  onBack,
  onClose,
}: {
  organizationId: string;
  brandId: string;
  card: FormatCard;
  onBack: () => void;
  onClose: () => void;
}) {
  const isReel = card.format === 'reel';
  const { start, busy, error } = useStartPiece(organizationId, brandId, onClose);
  const pieceTemplates = useBrandTemplates(brandId);
  const reelTemplates = useBrandReelTemplates(brandId);
  const templates = useMemo(
    () => (isReel ? [] : (pieceTemplates.data ?? []).filter((t) => t.document && t.format === card.format)),
    [isReel, pieceTemplates.data, card.format],
  );
  const { previewOf, fallbackOf } = useTemplatePreviews(brandId, templates);
  const loading = isReel ? reelTemplates.isPending : pieceTemplates.isPending;

  const spinner = (key: string) =>
    busy === key ? <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-primary" aria-hidden /> : null;
  const tile = 'relative flex h-full w-full flex-col gap-2 rounded-xl border-2 border-border p-2 text-left transition-colors hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60';

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-sm text-muted hover:text-fg"
        data-testid="create-content-back"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Otro formato
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger" data-testid="create-content-error">
          {error}
        </p>
      )}
      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label={`Empezar ${card.label.toLowerCase()}`}
        aria-busy={Boolean(busy)}
        data-testid={isReel ? 'create-content-reel-templates' : 'create-content-templates'}
      >
        <li>
          <button
            type="button"
            className={tile}
            disabled={Boolean(busy)}
            onClick={() => void start({ kind: 'blank', format: card.format }, 'blank')}
            data-testid="create-content-blank"
          >
            {spinner('blank')}
            <span
              className="flex w-full items-center justify-center rounded-md border-2 border-dashed border-border text-muted"
              style={{ aspectRatio: String(card.ratio) }}
              aria-hidden
            >
              <Plus className="h-6 w-6" />
            </span>
            <span className="block text-sm font-medium">En blanco</span>
          </button>
        </li>
        {loading &&
          Array.from({ length: 3 }, (_, i) => (
            <li key={`s${i}`} aria-hidden>
              <Skeleton className={cn('w-full', card.ratio < 0.7 ? 'aspect-[9/16]' : 'aspect-[4/5]')} />
            </li>
          ))}
        {isReel
          ? (reelTemplates.data ?? []).map((entry) => {
              const style = REEL_TEMPLATES.find((t) => t.id === entry.template.style.id);
              return (
                <li key={entry.id} className="min-w-0">
                  <button
                    type="button"
                    className={tile}
                    disabled={Boolean(busy)}
                    onClick={() => void start({ kind: 'reel-template', template: entry }, entry.id)}
                    data-testid="create-content-reel-template"
                    data-template={entry.key}
                  >
                    {spinner(entry.id)}
                    {style && <TemplateSample template={style} className="w-full" />}
                    <span className="block truncate text-sm font-medium">{entry.name}</span>
                  </button>
                </li>
              );
            })
          : templates.map((template) => (
              <li key={template.id} className="min-w-0">
                <button
                  type="button"
                  className={tile}
                  disabled={Boolean(busy)}
                  onClick={() => void start({ kind: 'template', template }, template.id)}
                  data-testid="create-content-template"
                  data-template-key={template.key}
                >
                  {spinner(template.id)}
                  <TemplateThumb canvas={template.document!.canvas} preview={previewOf(template)} fallback={fallbackOf(template)} />
                  <span className="block truncate text-sm font-medium">{template.name}</span>
                </button>
              </li>
            ))}
      </ul>
    </div>
  );
}
