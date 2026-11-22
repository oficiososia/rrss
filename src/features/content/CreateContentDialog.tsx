import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { translateError } from '@/lib/errors';
import { useContentMutations } from './api';
import { contentPaths } from './labels';
import { formatsOf, NETWORKS } from './networks';
import type { BrandTemplate } from './templates/api';
import { TemplatePicker } from './templates/TemplatePicker';

interface CreateContentDialogProps {
  organizationId: string;
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Nueva idea: nombre interno, red y formato del catálogo. El documento se crea al abrirla en el editor. */
export function CreateContentDialog({ organizationId, brandId, open, onOpenChange }: CreateContentDialogProps) {
  const navigate = useNavigate();
  const { create, saveVersion } = useContentMutations(organizationId, brandId);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [template, setTemplate] = useState<BrandTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [network, setNetwork] = useState<string>(NETWORKS[0]!.id);
  const [format, setFormat] = useState<string>(formatsOf(NETWORKS[0]!.id)[0]!.format);
  const [error, setError] = useState<string | null>(null);
  const formats = formatsOf(network);
  const spec = formats.find((f) => f.format === format);

  function changeNetwork(next: string) {
    setNetwork(next);
    setFormat(formatsOf(next)[0]?.format ?? '');
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
      const item = await create.mutateAsync({ title, ...target });
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
      onOpenChange(false);
      setTitle('');
      setFromTemplate(false);
      setTemplate(null);
      navigate(contentPaths(organizationId, brandId).item(item.id));
    } catch (e) {
      setError(translateError(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size={fromTemplate ? 'lg' : 'md'}
      title="Nueva idea"
      description="Ponle un nombre y elige dónde se publicará. Después la diseñas en el editor."
    >
      <form id="create-content" onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Nombre" hint="Solo lo ve el equipo." error={error}>
          {(props) => (
            <Input
              {...props}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Menú de otoño"
              autoFocus
              data-testid="create-content-title"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="Formato">
            {(props) => (
              <Select
                {...props}
                value={format}
                disabled={Boolean(template)}
                onChange={(e) => setFormat(e.target.value)}
                data-testid="create-content-format"
              >
                {formats.map((f) => (
                  <option key={f.format} value={f.format}>
                    {f.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Cómo quieres empezar</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                [false, 'En blanco', 'Eliges la red y el formato y diseñas desde cero.', 'create-content-blank'],
                [true, 'Desde una plantilla', 'Un diseño de la marca ya montado.', 'create-content-from-template'],
              ] as const
            ).map(([on, label, help, testId]) => (
              <label
                key={testId}
                className={`flex min-h-12 cursor-pointer items-start gap-2 rounded-xl border-2 p-3 text-sm ${
                  fromTemplate === on ? 'border-primary bg-primary-soft' : 'border-border'
                }`}
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
                La red y el formato son los de la plantilla. Las fotos son huecos para que pongas las tuyas; el texto,
                el pie y los hashtags son una guía.
              </p>
            )}
          </div>
        )}
        {spec && !spec.media.includes('image') && (
          <p className="text-xs text-muted">
            Es un formato de vídeo. Por ahora el editor prepara la imagen (portada o fotograma); el montaje de vídeo
            llegará más adelante.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending || saveVersion.isPending} data-testid="create-content-submit">
            Crear idea
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
