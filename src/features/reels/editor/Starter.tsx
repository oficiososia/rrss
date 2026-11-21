// Pantalla de salida de un reel vacío: en un solo paso se elige el estilo (con
// su muestra en movimiento), un texto de apertura opcional y las fotos y clips.
// Al confirmar, el reel queda montado en la línea de tiempo con todo en orden.
import { Images } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardBody, Field, Input } from '@/components/ui';
import type { ReelTemplateSummary } from '../templates';
import { TemplateCards } from './TemplateCards';

export interface StarterProps {
  templates: ReelTemplateSummary[];
  templateId: string;
  onTemplate: (id: string) => void;
  onPickMedia: (openingText: string) => void;
}

export function Starter({ templates, templateId, onTemplate, onPickMedia }: StarterProps) {
  const [opening, setOpening] = useState('');
  return (
    <Card>
      <CardBody className="space-y-5" data-testid="reel-starter">
        <div>
          <h2 className="text-base font-semibold">Empieza tu reel en tres pasos</h2>
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
