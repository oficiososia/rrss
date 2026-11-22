// Pantalla de salida de un reel vacío. Dos caminos:
//   · con una plantilla de la marca (si las tiene): se elige, pide las fotos y
//     clips de sus planos y el reel queda montado con sus textos de muestra;
//   · desde cero, en tres pasos: estilo (con su muestra en movimiento), un texto
//     de apertura opcional y las fotos y clips.
// Al confirmar, el reel queda montado en la línea de tiempo con todo en orden.
import { Images, Music2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardBody, Field, Input } from '@/components/ui';
import { describeNeeds } from '../reelTemplate';
import type { ReelTemplateSummary } from '../templates';
import type { BrandReelTemplate } from './api';
import { TemplateCards } from './TemplateCards';

export interface StarterProps {
  templates: ReelTemplateSummary[];
  templateId: string;
  onTemplate: (id: string) => void;
  onPickMedia: (openingText: string) => void;
  /** Plantillas de reel de la marca (con estructura). Sin ninguna, solo se ofrecen los tres pasos. */
  brandTemplates?: BrandReelTemplate[];
  onBrandTemplate?: (template: BrandReelTemplate) => void;
}

export function Starter({
  templates,
  templateId,
  onTemplate,
  onPickMedia,
  brandTemplates = [],
  onBrandTemplate,
}: StarterProps) {
  const [opening, setOpening] = useState('');
  const withTemplates = brandTemplates.length > 0 && Boolean(onBrandTemplate);
  return (
    <Card>
      <CardBody className="space-y-5" data-testid="reel-starter">
        {withTemplates && (
          <section className="space-y-2" data-testid="reel-brand-templates">
            <div>
              <h2 className="text-base font-semibold">Empieza con una plantilla</h2>
              <p className="text-sm text-muted">
                Elige una, toca las fotos y clips que pide y el reel queda montado. Luego cambias lo que quieras.
              </p>
            </div>
            <ul className="grid max-h-[26rem] gap-2 overflow-y-auto sm:grid-cols-2">
              {brandTemplates.map((entry) => (
                <li key={entry.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onBrandTemplate?.(entry)}
                    className="flex h-full w-full flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:bg-subtle"
                    data-testid="reel-brand-template"
                    data-template={entry.key}
                  >
                    <span className="text-sm font-medium">{entry.name}</span>
                    <span className="text-xs text-muted">{entry.template.purpose}</span>
                    <span className="text-xs">
                      <span className="font-medium">Necesita:</span> {describeNeeds(entry.template)}
                    </span>
                    <span className="line-clamp-2 text-xs text-muted">{entry.template.whenToUse}</span>
                    {entry.template.music && (
                      <span className="flex items-start gap-1 text-xs text-muted">
                        <Music2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span className="line-clamp-2">{entry.template.music.suggestion}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div>
          <h2 className="text-base font-semibold">
            {withTemplates ? 'O empieza desde cero, en tres pasos' : 'Empieza tu reel en tres pasos'}
          </h2>
          <p className="text-sm text-muted">
            Luego podrás cambiar cualquier cosa: el orden, lo que dura cada foto, los textos y la música.
          </p>
        </div>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">1. Elige un estilo</h3>
          <TemplateCards templates={templates} value={templateId} onChange={onTemplate} />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">2. Un texto para el principio (opcional)</h3>
          <Field label="Texto de apertura">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={opening}
                maxLength={80}
                placeholder="Por ejemplo: Nuevo menú de otoño"
                onChange={(e) => setOpening(e.target.value)}
                data-testid="reel-starter-text"
              />
            )}
          </Field>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">3. Elige las fotos y los clips</h3>
          <p className="text-xs text-muted">Toca varias de una vez: entran en el orden en que las eliges.</p>
          <Button onClick={() => onPickMedia(opening)} data-testid="reel-starter-pick">
            <Images className="h-4 w-4" aria-hidden />
            Elegir fotos y clips
          </Button>
        </section>
      </CardBody>
    </Card>
  );
}
