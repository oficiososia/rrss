import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Dialog, Field, Input } from '@/components/ui';
import { reelLikeEnabled } from '@/config/app';
import { costSentence } from '@/features/ai/cupo';
import { useAiQuota } from '@/features/ai/api';
import { useOrg } from '@/features/orgs/context';
import { useWorkMode } from '@/features/orgs/workMode';
import { describeNeeds } from '@/features/reels/reelTemplate';
import { TemplateSample } from '@/features/reels/editor/TemplateCards';
import { useBrandReelTemplates, type BrandReelTemplate } from '@/features/reels/editor/api';
import { useReelLikeOptions } from '@/features/reels/like/api';
import { REEL_TEMPLATES } from '@/features/reels/templates';
import { PUBLISHABLE_TARGETS } from '@/features/social/calendar';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useContentMutations } from './api';
import { contentPaths } from './labels';
import { FORMAT_CARDS, formatIcon, type FormatCard } from './lista/formats';
import { defaultTitle } from './lista/stage';
import { formatsOf, NETWORKS } from './networks';
import type { BrandTemplate } from './templates/api';
import { TemplatePicker } from './templates/TemplatePicker';

interface CreateContentDialogProps {
  organizationId: string;
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Formato que sale marcado (los accesos directos «Nuevo reel», «Nueva publicación»…). */
  initialFormat?: string;
  /** Plantilla con la que se empieza (desde la pantalla vacía de Contenidos). */
  initialTemplate?: BrandTemplate | null;
}

/** Los formatos de una red como tarjetas: los cuatro de siempre con su proporción, y el resto con su nombre. */
function cardsFor(network: string): FormatCard[] {
  return formatsOf(network).map(
    (spec) =>
      FORMAT_CARDS.find((card) => card.format === spec.format) ?? {
        format: spec.format,
        label: spec.label,
        ratio: 1,
        ratioText: '',
        hint: '',
        icon: formatIcon(spec.format),
      },
  );
}

/**
 * Nueva idea: se elige el formato con una tarjeta que enseña su proporción, el nombre es opcional (por
 * defecto, el formato y el día) y se abre directamente el editor que le toca. El documento se crea al
 * abrirla en el editor.
 */
export function CreateContentDialog({
  organizationId,
  brandId,
  open,
  onOpenChange,
  initialFormat,
  initialTemplate,
}: CreateContentDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      // Sin relleno abajo: la barra de botones llega hasta el borde del diálogo.
      bodyClassName="pb-0"
      title="Nueva idea"
      description="Elige qué vas a publicar. Después la diseñas en el editor."
    >
      <CreateForm
        organizationId={organizationId}
        brandId={brandId}
        onClose={() => onOpenChange(false)}
        initialFormat={initialFormat}
        initialTemplate={initialTemplate ?? null}
      />
    </Dialog>
  );
}

function CreateForm({
  organizationId,
  brandId,
  onClose,
  initialFormat,
  initialTemplate,
}: {
  organizationId: string;
  brandId: string;
  onClose: () => void;
  initialFormat?: string;
  initialTemplate: BrandTemplate | null;
}) {
  const navigate = useNavigate();
  const { create, saveVersion } = useContentMutations(organizationId, brandId);
  const [fromTemplate, setFromTemplate] = useState(Boolean(initialTemplate));
  const [template, setTemplate] = useState<BrandTemplate | null>(initialTemplate);
  const [reelTemplate, setReelTemplate] = useState<BrandReelTemplate | null>(null);
  const [title, setTitle] = useState('');
  // Solo Instagram se publica hoy: la red no se pregunta.
  const network = initialTemplate?.network ?? NETWORKS[0]!.id;
  const [format, setFormat] = useState<string>(
    initialTemplate?.format ??
      (cardsFor(NETWORKS[0]!.id).some((c) => c.format === initialFormat) ? initialFormat! : cardsFor(NETWORKS[0]!.id)[0]!.format),
  );
  const [error, setError] = useState<string | null>(null);
  const isReel = format === 'reel';
  const { isAdmin } = useOrg();
  const reelTemplates = useBrandReelTemplates(brandId);
  const like = useReelLikeOptions(brandId, reelLikeEnabled());
  const { selfManaged } = useWorkMode();
  // En autogestión el cupo no se enseña: ni se pregunta.
  const quota = useAiQuota(organizationId, !selfManaged && isAdmin && Boolean(like.data?.available));
  const likeCost = like.data?.estimate
    ? costSentence(like.data.estimate.maxMicros, { selfManaged, limitMicros: quota.data?.limit_value })
    : null;
  const brandReelTemplates = reelTemplates.data ?? [];
  const cards = cardsFor(network);
  const current = cards.find((c) => c.format === format);
  const suggested = defaultTitle(current?.label ?? 'Pieza');

  function changeFormat(next: string) {
    setFormat(next);
    // Las plantillas de una pieza y las de un reel son distintas: al cambiar de formato se vuelve a «En blanco».
    setFromTemplate(false);
    setTemplate(null);
    setReelTemplate(null);
  }

  function chooseTemplate(next: BrandTemplate) {
    setTemplate(next);
    // La plantilla manda en el formato: su documento solo vale para él.
    setFormat(next.format);
  }

  function toggleTemplate(on: boolean) {
    setFromTemplate(on);
    if (!on) {
      setTemplate(null);
      setReelTemplate(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (fromTemplate && !template && !(isReel && reelTemplate)) {
      setError('Elige una plantilla o marca «En blanco».');
      return;
    }
    const target = template ? { network: template.network, format: template.format } : { network, format };
    try {
      const item = await create.mutateAsync({ title: title.trim() || suggested, ...target });
      if (template?.document) {
        try {
          await saveVersion.mutateAsync({
            contentId: item.id,
            document: template.document,
            note: `Desde la plantilla «${template.name}»`,
          });
          toast.success('Idea creada desde la plantilla');
        } catch (e) {
          // La idea existe: se abre sin diseño y se puede reintentar desde el editor.
          toast.error(`La idea se ha creado, pero no se ha podido aplicar la plantilla. ${translateError(e)}`);
        }
      } else {
        toast.success('Idea creada');
      }
      onClose();
      // Un reel con plantilla de la marca se abre en el editor de reels con ella elegida.
      const path = contentPaths(organizationId, brandId).item(item.id);
      navigate(reelTemplate ? `${path}?plantilla=${encodeURIComponent(reelTemplate.key)}` : path);
    } catch (e) {
      setError(translateError(e));
    }
  }

  return (
    <form id="create-content" onSubmit={(e) => void submit(e)} className="space-y-4">
      <fieldset className="space-y-2" disabled={Boolean(template)}>
        <legend className="mb-2 text-sm font-medium">Formato</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Formato" data-testid="create-content-format">
          {cards.map((card) => {
            const Icon = card.icon;
            const on = card.format === format;
            return (
              <label
                key={card.format}
                className={cn(
                  'flex min-h-[7.5rem] cursor-pointer flex-col items-center justify-between gap-2 rounded-xl border-2 p-3 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-primary',
                  on ? 'border-primary bg-primary-soft' : 'border-border hover:border-primary/50',
                  template && 'cursor-not-allowed opacity-60',
                )}
                data-testid={`create-content-format-${card.format}`}
              >
                <input
                  type="radio"
                  name="create-content-format"
                  value={card.format}
                  checked={on}
                  onChange={() => changeFormat(card.format)}
                  className="sr-only"
                />
                <span
                  className={cn('flex h-14 items-center justify-center rounded-md border-2 border-dashed', on ? 'border-primary text-primary' : 'border-border text-muted')}
                  style={{ aspectRatio: String(card.ratio) }}
                  aria-hidden
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{card.label}</span>
                  {card.ratioText && <span className="block text-xs text-muted">{card.ratioText}</span>}
                </span>
              </label>
            );
          })}
        </div>
        {current?.hint && (
          <p className="text-xs text-muted">
            {current.hint}.{PUBLISHABLE_TARGETS.has(`${network}:${format}`) ? '' : ' Todavía no se publica sola: se prepara aquí y se sube a mano.'}
          </p>
        )}
      </fieldset>

      <Field label="Nombre" hint={`Opcional, solo lo ve el equipo. Si lo dejas vacío: «${suggested}».`} error={error}>
        {(props) => (
          <Input
            {...props}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={suggested}
            data-testid="create-content-title"
          />
        )}
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Cómo quieres empezar</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              [false, 'En blanco', isReel ? 'Montas el vídeo desde cero.' : 'Diseñas desde cero.', 'create-content-blank'],
              ...(!isReel || brandReelTemplates.length > 0
                ? ([
                    [
                      true,
                      'Desde una plantilla',
                      isReel ? 'Un montaje de la marca: tú pones las fotos.' : 'Un diseño de la marca ya montado.',
                      'create-content-from-template',
                    ],
                  ] as const)
                : []),
            ] as const
          ).map(([on, label, help, testId]) => (
            <label
              key={testId}
              className={cn(
                'flex min-h-12 cursor-pointer items-start gap-2 rounded-xl border-2 p-3 text-sm',
                fromTemplate === on ? 'border-primary bg-primary-soft' : 'border-border',
              )}
            >
              <input
                type="radio"
                name="create-content-start"
                className="mt-1"
                checked={fromTemplate === on}
                onChange={() => toggleTemplate(on)}
                data-testid={testId}
              />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-muted">{help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {isReel && like.data?.available && (
        <Link
          to={`/o/${organizationId}/m/${brandId}/biblioteca/reels/como-este`}
          onClick={onClose}
          className="flex min-h-14 items-center gap-3 rounded-xl border-2 border-border p-3 text-sm hover:border-primary/50"
          data-testid="create-content-reel-like"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Hacer un reel como este</span>
            <span className="block text-xs text-muted">
              Sube un vídeo que te guste y lo rehacemos con tu material.
              {likeCost && <span data-testid="create-content-reel-like-cost"> {likeCost}</span>}
            </span>
          </span>
        </Link>
      )}
      {fromTemplate && isReel && (
        <div className="space-y-2" data-testid="create-content-reel-templates">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Plantillas de reel de la marca">
            {brandReelTemplates.map((entry) => {
              const style = REEL_TEMPLATES.find((t) => t.id === entry.template.style.id);
              const selected = reelTemplate?.id === entry.id;
              return (
                <li key={entry.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setReelTemplate(entry)}
                    className={cn(
                      'flex h-full w-full flex-col gap-2 rounded-xl border-2 p-2 text-left transition-colors',
                      selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-primary/50',
                    )}
                    data-testid="create-content-reel-template"
                    data-template={entry.key}
                  >
                    {style && <TemplateSample template={style} className="mx-auto w-full max-w-[9rem]" />}
                    <span className="block text-sm font-medium">{entry.name}</span>
                    <span className="block text-xs text-muted">{describeNeeds(entry.template)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {fromTemplate && !isReel && (
        <div className="space-y-2" data-testid="create-content-templates">
          <TemplatePicker
            orgId={organizationId}
            brandId={brandId}
            selectedId={template?.id ?? null}
            onSelect={chooseTemplate}
            defaultFormat={format}
          />
          {template && (
            <p className="text-xs text-muted">
              El formato es el de la plantilla. Las fotos son huecos para que pongas las tuyas; el texto, el pie y los
              hashtags son una guía.
            </p>
          )}
        </div>
      )}

      {/*
        Los botones se quedan a la vista aunque la lista de plantillas sea larga. El cuerpo del diálogo va
        sin relleno abajo (`bodyClassName="pb-0"`): con él, la barra pegada se quedaba 1rem por encima del
        borde y por esa franja asomaban las miniaturas de las plantillas.
      */}
      <div
        className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-border bg-surface px-5 py-3"
        data-testid="create-content-actions"
      >
        <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button type="submit" loading={create.isPending || saveVersion.isPending} data-testid="create-content-submit">
          Crear y abrir
        </Button>
      </div>
    </form>
  );
}
