import { Copy, LayoutTemplate, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
} from '@/components/ui';
import {
  useBrandTemplates,
  useDeleteTemplate,
  useDuplicateTemplate,
  useRenameTemplate,
  type BrandTemplate,
} from '@/features/content/templates/api';
import { assetIdsOf } from '@/features/content/editor/canvas/nodes';
import { PageThumb } from '@/features/content/editor/panels/PageThumb';
import { useImageLookup } from '@/features/content/templates/useImageLookup';
import { targetLabel } from '@/features/content/labels';
import { translateError } from '@/lib/errors';

/** De dónde viene cada plantilla, en palabras de quien no es técnico. */
const TEMPLATE_ORIGIN: Record<BrandTemplate['source'], { label: string; help: string }> = {
  instagram_import: {
    label: 'Importada',
    help: 'Sale de las publicaciones que la marca ya tenía en Instagram.',
  },
  manual: { label: 'Manual', help: 'La entregó la agencia.' },
  editor: { label: 'Del editor', help: 'Se guardó (o se duplicó) desde el editor de piezas.' },
};

/**
 * Gestión de las plantillas de la marca (Marca → Identidad visual): lista con miniatura, de dónde viene
 * cada una, y renombrar, duplicar y borrar para quien edita la marca.
 */
export function BrandTemplatesCard({ brandId, canManage }: { brandId: string; canManage: boolean }) {
  const templates = useBrandTemplates(brandId);
  const rename = useRenameTemplate(brandId);
  const duplicate = useDuplicateTemplate(brandId);
  const remove = useDeleteTemplate(brandId);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<BrandTemplate | null>(null);
  const assetIds = useMemo(
    () => (templates.data ?? []).flatMap((t) => (t.document ? assetIdsOf(t.document) : [])),
    [templates.data],
  );
  const images = useImageLookup(brandId, assetIds);

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    rename.mutate(
      { id: renaming.id, name },
      {
        onSuccess: () => {
          setRenaming(null);
          toast.success('Plantilla renombrada');
        },
        onError: (e) => toast.error(translateError(e)),
      },
    );
  }

  return (
    <Card>
      <CardHeader
        title="Plantillas de la marca"
        description="Diseños para crear piezas nuevas («Desde una plantilla»). Aquí se renombran, se duplican y se borran."
      />
      <CardBody className="space-y-3">
        {templates.isPending ? (
          <Skeleton className="h-24" />
        ) : templates.isError ? (
          <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
        ) : templates.data.length === 0 ? (
          <div data-testid="brand-templates-empty">
            <EmptyState
              icon={LayoutTemplate}
              title="Todavía no hay plantillas"
              description="Se crean desde el editor de piezas («Guardar como plantilla») o importando las publicaciones de Instagram."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border" data-testid="brand-templates" aria-label="Plantillas de la marca">
            {templates.data.map((template) => {
              const document = template.document;
              const origin = TEMPLATE_ORIGIN[template.source];
              const editing = renaming?.id === template.id;
              return (
                <li key={template.id} className="flex flex-wrap items-start gap-3 py-3" data-testid="brand-template">
                  <span className="w-16 shrink-0" aria-hidden>
                    {document ? (
                      <PageThumb canvas={document.canvas} layers={document.pages[0]!.layers} images={images} />
                    ) : (
                      <span className="flex aspect-square items-center justify-center rounded-md bg-subtle">
                        <LayoutTemplate className="h-5 w-5 text-muted" />
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    {editing ? (
                      <form onSubmit={submitRename} className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`rename-${template.id}`}>
                          Nombre de la plantilla
                        </label>
                        <Input
                          id={`rename-${template.id}`}
                          value={renaming.name}
                          maxLength={120}
                          autoFocus
                          onChange={(e) => setRenaming({ id: template.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setRenaming(null);
                            }
                          }}
                          className="min-w-0 flex-1"
                          data-testid="brand-template-rename-input"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          loading={rename.isPending}
                          disabled={!renaming.name.trim()}
                          data-testid="brand-template-rename-save"
                        >
                          Guardar
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => setRenaming(null)}>
                          Cancelar
                        </Button>
                      </form>
                    ) : (
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        <span className="break-words" data-testid="brand-template-name">
                          {template.name}
                        </span>
                        <Badge tone="neutral" className="shrink-0">
                          {origin.label}
                        </Badge>
                        {!document && <Badge tone="warning">No se puede leer</Badge>}
                      </p>
                    )}
                    <p className="text-xs text-muted">
                      {targetLabel(template.network, template.format)}
                      {document && document.pages.length > 1 ? ` · ${document.pages.length} páginas` : ''} ·{' '}
                      {origin.help}
                    </p>
                  </div>
                  {canManage && !editing && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRenaming({ id: template.id, name: template.name })}
                        aria-label={`Renombrar «${template.name}»`}
                        data-testid="brand-template-rename"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                        Renombrar
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={duplicate.isPending && duplicate.variables === template.id}
                        disabled={duplicate.isPending}
                        onClick={() =>
                          duplicate.mutate(template.id, {
                            onSuccess: () => toast.success('Plantilla duplicada'),
                            onError: (e) => toast.error(translateError(e)),
                          })
                        }
                        aria-label={`Duplicar «${template.name}»`}
                        data-testid="brand-template-duplicate"
                      >
                        <Copy className="h-4 w-4" aria-hidden />
                        Duplicar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        onClick={() => setDeleting(template)}
                        aria-label={`Borrar «${template.name}»`}
                        data-testid="brand-template-delete"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        Borrar
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!canManage && (templates.data?.length ?? 0) > 0 && (
          <p className="text-xs text-muted">Solo quien edita la marca puede cambiar sus plantillas.</p>
        )}
      </CardBody>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="¿Borrar esta plantilla?"
        description={
          deleting
            ? `«${deleting.name}» dejará de ofrecerse en «Desde una plantilla». Las piezas que ya se hicieron con ella no cambian.${
                deleting.source === 'editor'
                  ? ''
                  : ' Esta no la creaste aquí: si la necesitas, habrá que volver a pedirla.'
              }`
            : ''
        }
        confirmLabel="Borrar"
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast.success('Plantilla borrada');
            },
            onError: (e) => {
              setDeleting(null);
              toast.error(translateError(e));
            },
          })
        }
      />
    </Card>
  );
}
