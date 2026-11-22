import { useMemo } from 'react';
import { targetLabel } from '../labels';
import { useBrandTemplates, type BrandTemplate } from '../templates/api';
import { TemplateThumb } from '../templates/TemplateThumb';
import { useTemplatePreviews } from '../templates/useTemplatePreviews';

/**
 * Hasta tres plantillas de la marca para empezar con un clic desde la pantalla vacía. Sin plantillas
 * no enseña nada (la pantalla vacía ya invita a «Nueva idea»).
 */
export function FeaturedTemplates({ brandId, onPick }: { brandId: string; onPick: (template: BrandTemplate) => void }) {
  const templates = useBrandTemplates(brandId);
  const featured = useMemo(() => (templates.data ?? []).filter((t) => t.document).slice(0, 3), [templates.data]);
  const { previewOf, fallbackOf } = useTemplatePreviews(brandId, featured);
  if (featured.length === 0) return null;
  return (
    <section className="border-t border-border px-4 pb-6 pt-5" aria-labelledby="featured-templates" data-testid="featured-templates">
      <h3 id="featured-templates" className="mb-3 text-center text-sm font-medium">
        O empieza desde una plantilla
      </h3>
      <ul className="mx-auto grid max-w-xl grid-cols-3 gap-3">
        {featured.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              onClick={() => onPick(template)}
              className="w-full space-y-1.5 rounded-xl border border-border p-2 text-left hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              data-testid="featured-template"
            >
              <TemplateThumb canvas={template.document!.canvas} preview={previewOf(template)} fallback={fallbackOf(template)} />
              <span className="block truncate text-xs font-medium">{template.name}</span>
              <span className="block truncate text-xs text-muted">{targetLabel(template.network, template.format)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
