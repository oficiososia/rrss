import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
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
  const [title, setTitle] = useState('');
  const [network, setNetwork] = useState<string>(initialTemplate?.network ?? NETWORKS[0]!.id);
  const [format, setFormat] = useState<string>(
    initialTemplate?.format ??
      (cardsFor(NETWORKS[0]!.id).some((c) => c.format === initialFormat) ? initialFormat! : cardsFor(NETWORKS[0]!.id)[0]!.format),
  );
  const [error, setError] = useState<string | null>(null);
  const cards = cardsFor(network);
  const current = cards.find((c) => c.format === format);
  const spec = formatsOf(network).find((f) => f.format === format);
  const suggested = defaultTitle(current?.label ?? 'Pieza');

  function changeNetwork(next: string) {
    setNetwork(next);
    setFormat(cardsFor(next)[0]?.format ?? '');
  }

  function chooseTemplate(next: BrandTemplate) {
    setTemplate(next);
    // La plantilla manda en la red y el formato: su documento solo vale para ellos.
    setNetwork(next.network);
    setFormat(next.format);
  }

  function toggleTemplate(on: boolean) {
    setFromTemplate(on);
    if (!on) setTemplate(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (fromTemplate && !template) {
      setError('Elige una plantilla o desmarca «Empezar desde una plantilla».');
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
      navigate(contentPaths(organizationId, brandId).item(item.id));
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
                  onChange={() => setFormat(card.format)}
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
        {current?.hint && <p className="text-xs text-muted">{current.hint}.</p>}
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
              [false, 'En blanco', 'Diseñas desde cero.', 'create-content-blank'],
              [true, 'Desde una plantilla', 'Un diseño de la marca ya montado.', 'create-content-from-template'],
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
      {fromTemplate && (
        <div className="space-y-2" data-testid="create-content-templates">
          <TemplatePicker
            orgId={organizationId}
            brandId={brandId}
            selectedId={template?.id ?? null}
            onSelect={chooseTemplate}
          />
          {template && (
            <p className="text-xs text-muted">
              El formato es el de la plantilla. Las fotos son huecos para que pongas las tuyas; el texto, el pie y los
              hashtags son una guía.
            </p>
          )}
        </div>
      )}

      <details className="text-sm">
        <summary className="min-h-8 cursor-pointer text-muted hover:text-fg">Publicar en otra red</summary>
        <div className="mt-2 max-w-xs">
          <Field label="Red">
            {(props) => (
              <Select
                {...props}
                value={network}
                disabled={Boolean(template)}
                onChange={(e) => changeNetwork(e.target.value)}
                data-testid="create-content-network"
              >
                {NETWORKS.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </details>

      {spec && !spec.media.includes('image') && (
        <p className="text-xs text-muted">
          Es un formato de vídeo. Por ahora el editor prepara la imagen (portada o fotograma); el montaje de vídeo
          llegará más adelante.
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
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
