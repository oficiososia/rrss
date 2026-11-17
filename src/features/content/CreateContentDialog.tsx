import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { translateError } from '@/lib/errors';
import { useContentMutations } from './api';
import { contentPaths } from './labels';
import { formatsOf, NETWORKS } from './networks';

interface CreateContentDialogProps {
  organizationId: string;
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Nueva idea: nombre interno, red y formato del catálogo. El documento se crea al abrirla en el editor. */
export function CreateContentDialog({ organizationId, brandId, open, onOpenChange }: CreateContentDialogProps) {
  const navigate = useNavigate();
  const { create } = useContentMutations(organizationId, brandId);
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

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutateAsync({ title, network, format }).then(
      (item) => {
        toast.success('Idea creada');
        onOpenChange(false);
        setTitle('');
        navigate(contentPaths(organizationId, brandId).item(item.id));
      },
      (e: unknown) => setError(translateError(e)),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nueva idea"
      description="Ponle un nombre y elige dónde se publicará. Después la diseñas en el editor."
    >
      <form id="create-content" onSubmit={submit} className="space-y-4">
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
          <Button type="submit" loading={create.isPending} data-testid="create-content-submit">
            Crear idea
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
