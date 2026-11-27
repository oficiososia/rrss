import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Notice } from '@/components/ui';
import { translateError } from '@/lib/errors';
import type { AspectRatio, ContentDocument } from '../document';
import { useDeleteTemplate, type BrandTemplate } from './api';
import { fitTemplate } from './fit';
import { TemplatePicker } from './TemplatePicker';

interface ApplyTemplateDialogProps {
  orgId: string;
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { network: string; format: string };
  /** Proporción del lienzo de la pieza: si la plantilla hay que pasarla a otra, se prefiere esta. */
  currentRatio?: AspectRatio;
  /** La pieza ya tiene capas: se avisa de que se sustituyen (Ctrl+Z las recupera). */
  hasDesign: boolean;
  /** Quien edita puede borrar las plantillas que se guardaron desde el editor. */
  canDelete?: boolean;
  /** `changes`: lo que se ha adaptado (vacío si la plantilla encajaba tal cual). */
  onApply: (document: ContentDocument, template: BrandTemplate, changes: string[]) => void;
}

/**
 * «Empezar desde una plantilla» dentro del editor: sustituye el diseño en un paso que se puede deshacer.
 * Una plantilla de otra proporción o con otro número de páginas se adapta (con los anclajes de sus capas)
 * y el diálogo dice qué cambia antes de aplicarla.
 */
export function ApplyTemplateDialog({
  orgId,
  brandId,
  open,
  onOpenChange,
  target,
  currentRatio,
  hasDesign,
  canDelete = false,
  onApply,
}: ApplyTemplateDialogProps) {
  const [chosen, setChosen] = useState<BrandTemplate | null>(null);
  const remove = useDeleteTemplate(brandId);
  const fit = useMemo(
    () => (chosen ? fitTemplate(chosen, target, currentRatio) : null),
    [chosen, target, currentRatio],
  );
  const adapts = (fit?.changes.length ?? 0) > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Empezar desde una plantilla"
      description="Las fotos son huecos para que pongas las tuyas; el texto, el pie y los hashtags son una guía."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!fit}
            onClick={() => {
              if (!chosen || !fit) return;
              onApply(fit.document, chosen, fit.changes);
              onOpenChange(false);
              setChosen(null);
            }}
            data-testid="template-apply"
          >
            {adapts ? 'Adaptar y usar esta plantilla' : 'Usar esta plantilla'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {hasDesign && (
          <p className="text-xs text-warning" data-testid="template-replace-warning">
            Sustituye el diseño actual por el de la plantilla. Con Ctrl+Z lo recuperas.
          </p>
        )}
        {chosen && !fit && (
          <Notice tone="warning">
            <span data-testid="template-cannot-fit">
              Esta plantilla no se puede usar en esta pieza: su red o su formato no admiten ninguna proporción del
              lienzo.
            </span>
          </Notice>
        )}
        {adapts && (
          <Notice tone="warning">
            <span data-testid="template-adapt-notice">
              Esta plantilla no encaja tal cual y se adaptará:
              <ul className="mt-1 list-disc pl-5">
                {fit!.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              Con Ctrl+Z vuelves a como estaba.
            </span>
          </Notice>
        )}
        <TemplatePicker
          orgId={orgId}
          brandId={brandId}
          target={target}
          selectedId={chosen?.id ?? null}
          onSelect={setChosen}
          onDelete={
            canDelete
              ? (template) =>
                  remove.mutate(template.id, {
                    onSuccess: () => {
                      if (chosen?.id === template.id) setChosen(null);
                      toast.success(`Plantilla «${template.name}» borrada`);
                    },
                    onError: (error) => toast.error(translateError(error)),
                  })
              : undefined
          }
        />
      </div>
    </Dialog>
  );
}
