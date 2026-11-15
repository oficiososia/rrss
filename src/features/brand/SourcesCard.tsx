import { FileText, Globe, Link2, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Input,
  Notice,
  Spinner,
} from '@/components/ui';
import { SOURCE_MIME_TYPES } from '@/config/app';
import type { KnowledgeSourceRow, SourceStatus } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { formatBytes, formatDate } from '@/lib/utils';
import { normalizeUrl, useSourceMutations, useSources } from './api';
import { SOURCES_NOTICE } from './sourcesNotice';

const STATUS: Record<SourceStatus, { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  pending: { label: 'Pendiente de analizar', tone: 'neutral' },
  processing: { label: 'Analizando', tone: 'warning' },
  ready: { label: 'Analizada', tone: 'success' },
  failed: { label: 'Error al analizar', tone: 'danger' },
};

export function SourcesCard({
  organizationId,
  brandId,
  canManage,
}: {
  organizationId: string;
  brandId: string;
  canManage: boolean;
}) {
  const sources = useSources(brandId);
  const { addUrl, upload, remove } = useSourceMutations(organizationId, brandId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [removing, setRemoving] = useState<KnowledgeSourceRow | null>(null);

  function submitUrl(event: FormEvent) {
    event.preventDefault();
    addUrl.mutate(url, {
      onSuccess: () => {
        setUrl('');
        toast.success('Web añadida');
      },
      onError: (e) => toast.error(translateError(e)),
    });
  }

  async function uploadFiles(files: FileList) {
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync(file);
        toast.success(`«${file.name}» añadido`);
      } catch (e) {
        toast.error(translateError(e));
      }
    }
  }

  return (
    <Card>
      <CardHeader
        title="Fuentes de conocimiento"
        description="El manual de marca, la web y los documentos de los que sale la identidad de la marca."
      />
      <CardBody className="space-y-4">
        <Notice>{SOURCES_NOTICE}</Notice>
        {canManage && (
          <div className="flex flex-col gap-3 lg:flex-row">
            <form onSubmit={submitUrl} className="flex flex-1 gap-2">
              <Input
                type="text"
                inputMode="url"
                aria-label="Dirección de la página web"
                placeholder="https://tumarca.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                data-testid="source-url"
              />
              <Button
                type="submit"
                variant="secondary"
                loading={addUrl.isPending}
                disabled={!normalizeUrl(url)}
                data-testid="source-url-add"
              >
                <Link2 className="h-4 w-4" aria-hidden />
                Añadir web
              </Button>
            </form>
            <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={upload.isPending}>
              <Upload className="h-4 w-4" aria-hidden />
              Subir documento
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={SOURCE_MIME_TYPES.join(',')}
              className="sr-only"
              aria-label="Subir documentos de la marca"
              data-testid="source-file-input"
              onChange={(e) => {
                if (e.target.files) void uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </CardBody>
      {sources.isPending ? (
        <Spinner />
      ) : sources.isError ? (
        <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
      ) : sources.data.length === 0 ? (
        <p className="border-t border-border px-5 py-6 text-sm text-muted">
          Todavía no hay fuentes. Un manual de marca en PDF es un buen comienzo.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border" data-testid="sources-list">
          {sources.data.map((source) => {
            const Icon = source.kind === 'website' ? Globe : FileText;
            const status = STATUS[source.status];
            return (
              <li key={source.id} className="flex items-center gap-3 px-5 py-3">
                <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{source.title}</p>
                  <p className="truncate text-xs text-muted">
                    {source.url ?? (source.bytes !== null ? formatBytes(source.bytes) : '')} ·{' '}
                    {formatDate(source.created_at)}
                  </p>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Eliminar la fuente ${source.title}`}
                    onClick={() => setRemoving(source)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="¿Eliminar esta fuente?"
        description={`«${removing?.title}» dejará de formar parte del conocimiento de la marca. No se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing, {
            onSuccess: () => {
              setRemoving(null);
              toast.success('Fuente eliminada');
            },
            onError: (e) => {
              setRemoving(null);
              toast.error(translateError(e));
            },
          })
        }
      />
    </Card>
  );
}
