import { LayoutTemplate, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui';
import { useWorkMode } from '@/features/orgs/workMode';
import { cn } from '@/lib/utils';
import { targetLabel } from '../labels';
import { getFormatSpec } from '../networks';
import { photoCount, templateFits, useBrandTemplates, type BrandTemplate } from './api';
import { hasDetail, photosLine, templateBlurb, templateDetail } from './summary';
import { TemplateThumb } from './TemplateThumb';
import { useTemplatePreviews } from './useTemplatePreviews';

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
 * Plantillas de la marca con su vista previa real, nombre y una frase de para qué sirven. Sin
 * plantillas, explica cómo se consiguen (importar publicaciones y la agencia).
 */
export function TemplatePicker({ orgId, brandId, target, selectedId, onSelect, onDelete }: TemplatePickerProps) {
  const templates = useBrandTemplates(brandId);
  const { selfManaged } = useWorkMode();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const usable = useMemo(() => (templates.data ?? []).filter((t) => t.document), [templates.data]);
  const { previewOf, fallbackOf } = useTemplatePreviews(brandId, usable);

  if (templates.isPending) return <Skeleton className="h-32" />;
  if (templates.isError) return <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />;

  if ((templates.data ?? []).length === 0) {
    return (
      <div data-testid="template-empty">
        <EmptyState
          icon={LayoutTemplate}
          title="Esta marca todavía no tiene plantillas"
          description={
            selfManaged
              ? 'Carga las del catálogo desde Marca → Identidad visual → Plantillas, guarda una desde el editor o importa las publicaciones que la marca ya tiene en Instagram. Mientras tanto, puedes diseñar la pieza desde cero.'
              : 'Las plantillas salen de las publicaciones que la marca ya tiene en Instagram: importa las publicaciones desde Marca → Datos de la marca → Cuentas conectadas y pide a la agencia que las prepare. Mientras tanto, puedes diseñar la pieza desde cero.'
          }
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
        <Notice>
          {selfManaged
            ? 'Las plantillas de la marca no se pueden leer ahora mismo. Vuelve a intentarlo en unos minutos.'
            : 'Las plantillas de la marca no se pueden leer ahora mismo. Avisa a la agencia.'}
        </Notice>
      </div>
    );
  }

  const formatOf = (t: BrandTemplate) => getFormatSpec(t.network, t.format)?.label ?? t.format;
  const formats = [...new Set(usable.map(formatOf))];
  const shown = filter ? usable.filter((t) => formatOf(t) === filter) : usable;

  return (
    <div className="space-y-3">
      {formats.length > 1 && (
        <div
          role="group"
          aria-label="Filtrar por formato"
          className="flex flex-wrap gap-2"
          data-testid="template-filters"
        >
          {[null, ...formats].map((label) => (
            <button
              key={label ?? 'todas'}
              type="button"
              aria-pressed={filter === label}
              onClick={() => setFilter(label)}
              className={cn(
                'min-h-9 rounded-full border px-3 text-sm transition-colors',
                filter === label
                  ? 'border-primary bg-primary-soft font-medium'
                  : 'border-border hover:border-primary/50',
              )}
              data-testid="template-filter"
            >
              {label ?? 'Todas'}
            </button>
          ))}
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="template-list" aria-label="Plantillas de la marca">
        {shown.map((template) => {
          const document = template.document!;
          const selected = template.id === selectedId;
          const photos = photoCount(document);
          const adapts = Boolean(target) && !templateFits(template, target!.network, target!.format);
          const blurb = templateBlurb(template);
          const detail = templateDetail(template);
          const open = expanded === template.id;
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
                <span className="w-24 shrink-0 self-start">
                  <TemplateThumb
                    canvas={document.canvas}
                    preview={previewOf(template)}
                    fallback={fallbackOf(template)}
                  />
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="break-words" data-testid="template-name">
                      {template.name}
                    </span>
                    {template.source === 'manual' && (
                      <Badge tone="neutral" className="shrink-0">
                        {selfManaged ? 'Nuestra' : 'De la agencia'}
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
                  {blurb && (
                    <span className="block text-sm" data-testid="template-summary">
                      {blurb}
                    </span>
                  )}
                  <span className="block text-xs text-muted">
                    {targetLabel(template.network, template.format)}
                    {document.pages.length > 1 ? ` · ${document.pages.length} páginas` : ''} · {photosLine(photos)}
                  </span>
                </span>
              </button>
              {hasDetail(detail) && (
                <div className="mt-1 px-1 text-xs">
                  <button
                    type="button"
                    className="min-h-8 font-medium text-primary underline"
                    aria-expanded={open}
                    aria-controls={`template-detail-${template.id}`}
                    onClick={() => setExpanded(open ? null : template.id)}
                    data-testid="template-more"
                  >
                    {open ? 'Ver menos' : 'Ver más'}
                  </button>
                  {open && (
                    <div
                      id={`template-detail-${template.id}`}
                      className="mt-1 space-y-1 text-muted"
                      data-testid="template-detail"
                    >
                      {detail.summary && (
                        <p>
                          {detail.proposal ? (selfManaged ? 'Propuesta: ' : 'Propuesta de la agencia: ') : ''}
                          {detail.summary}
                        </p>
                      )}
                      {detail.photo && <p>Foto que pide: {detail.photo}</p>}
                      {detail.repeats && <p>{detail.repeats}</p>}
                    </div>
                  )}
                </div>
              )}
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
    </div>
  );
}
