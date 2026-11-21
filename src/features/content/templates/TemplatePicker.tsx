import { LayoutTemplate, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { assetIdsOf } from '../editor/canvas/nodes';
import { PageThumb } from '../editor/panels/PageThumb';
import { targetLabel } from '../labels';
import { photoCount, templateFits, useBrandTemplates, type BrandTemplate } from './api';
import { useImageLookup } from './useImageLookup';

interface TemplatePickerProps {
  orgId: string;
  brandId: string;
  /**
   * Si se da, es la red y el formato de la pieza: las plantillas que no encajan (otra proporción u otro
   * número de páginas) se ofrecen igual, marcadas «Se adaptará», y se adaptan al usarlas.
   */
  target?: { network: string; format: string };
  selectedId: string | null;
  onSelect: (template: BrandTemplate) => void;
  /** Si se da, las plantillas guardadas desde el editor se pueden borrar (quien edita la marca). */
  onDelete?: (template: BrandTemplate) => void;
}

/**
 * Plantillas de la marca con su vista previa, nombre y análisis resumido. Sin
 * plantillas, explica cómo se consiguen (importar publicaciones y la agencia).
 */
export function TemplatePicker({ orgId, brandId, target, selectedId, onSelect, onDelete }: TemplatePickerProps) {
  const templates = useBrandTemplates(brandId);
  const [deleting, setDeleting] = useState<string | null>(null);
  const usable = useMemo(() => (templates.data ?? []).filter((t) => t.document), [templates.data]);
  const assetIds = useMemo(() => usable.flatMap((t) => (t.document ? assetIdsOf(t.document) : [])), [usable]);
  const images = useImageLookup(brandId, assetIds);

  if (templates.isPending) return <Skeleton className="h-32" />;
  if (templates.isError) return <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />;

  if ((templates.data ?? []).length === 0) {
    return (
      <div data-testid="template-empty">
        <EmptyState
          icon={LayoutTemplate}
          title="Esta marca todavía no tiene plantillas"
          description="Las plantillas salen de las publicaciones que la marca ya tiene en Instagram: importa las publicaciones desde Marca → Datos de la marca → Cuentas conectadas y pide a la agencia que las prepare. Mientras tanto, puedes diseñar la pieza desde cero."
          action={
            <Link className="text-sm font-medium text-primary underline" to={`/o/${orgId}/m/${brandId}/marca`}>
              Ir a los datos de la marca
            </Link>
          }
        />
      </div>
    );
  }
  if (usable.length === 0) {
    return (
      <div data-testid="template-none-fit">
        <Notice>Las plantillas de la marca no se pueden leer ahora mismo. Avisa a la agencia.</Notice>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="template-list" aria-label="Plantillas de la marca">
      {usable.map((template) => {
        const document = template.document!;
        const first = document.pages[0]!;
        const selected = template.id === selectedId;
        const photos = photoCount(document);
        const recurrence = template.source === 'editor' ? undefined : template.analysis?.recurrence;
        const adapts = Boolean(target) && !templateFits(template, target!.network, target!.format);
        return (
          <li key={template.id}>
            <button
              type="button"
              onClick={() => onSelect(template)}
              aria-pressed={selected}
              className={cn(
                'flex h-full w-full gap-3 rounded-xl border-2 p-2 text-left transition-colors',
                selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-primary/50',
              )}
              data-testid="template-option"
              data-template-key={template.key}
            >
              <span className="w-20 shrink-0">
                <PageThumb canvas={document.canvas} layers={first.layers} images={images} />
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span data-testid="template-name">{template.name}</span>
                  {template.source === 'manual' && (
                    <Badge tone="neutral" className="shrink-0">
                      Manual
                    </Badge>
                  )}
                  {template.source === 'editor' && (
                    <Badge tone="neutral" className="shrink-0">
                      Guardada aquí
                    </Badge>
                  )}
                  {adapts && (
                    <span className="shrink-0" data-testid="template-adapts">
                      <Badge tone="warning">Se adaptará</Badge>
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted">
                  {targetLabel(template.network, template.format)}
                  {document.pages.length > 1 ? ` · ${document.pages.length} páginas` : ''}
                </span>
                {template.analysis && (
                  <span className="block text-xs" data-testid="template-summary">
                    {template.analysis.summary}
                  </span>
                )}
                <span className="block text-xs text-muted">
                  {photos > 0 ? `${photos} ${photos === 1 ? 'foto' : 'fotos'} para sustituir` : 'Sin fotos'}
                  {recurrence ? ` · en ${recurrence.count} de ${recurrence.reviewed} publicaciones` : ''}
                </span>
              </span>
            </button>
            {onDelete && template.source === 'editor' && (
              <div className="mt-1 flex items-center justify-end gap-2 text-xs">
                {deleting === template.id ? (
                  <>
                    <span>¿Borrar esta plantilla?</span>
                    <Button
                      size="sm"
                      variant="danger"
                      className="h-7 px-2"
                      onClick={() => {
                        setDeleting(null);
                        onDelete(template);
                      }}
                      data-testid="template-delete-confirm"
                    >
                      Sí, borrar
                    </Button>
                    <Button size="sm" variant="secondary" className="h-7 px-2" onClick={() => setDeleting(null)}>
                      No
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-danger"
                    onClick={() => setDeleting(template.id)}
                    data-testid="template-delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Borrar
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
