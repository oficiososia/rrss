import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input, Notice } from '@/components/ui';
import { translateError } from '@/lib/errors';
import { allLayers, type ContentDocument } from '../document';
import { targetLabel } from '../labels';
import { useSaveTemplate } from './api';
import { buildEditorTemplate } from './build';

interface SaveTemplateDialogProps {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nombre que se propone (el de la pieza). */
  defaultName: string;
  network: string;
  format: string;
  /** El diseño tal como está ahora en el editor, con o sin guardar como versión. */
  document: ContentDocument;
  onSaved: (name: string) => void;
}

/** «Guardar como plantilla»: el diseño abierto pasa a ser una plantilla de la marca para otras piezas. */
export function SaveTemplateDialog({
  brandId,
  open,
  onOpenChange,
  defaultName,
  network,
  format,
  document,
  onSaved,
}: SaveTemplateDialogProps) {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveTemplate(brandId);
  const empty = allLayers(document).length === 0;
  const pages = document.pages.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const draft = buildEditorTemplate({ name, network, format, document });
    if (!draft) {
      setError(empty ? 'El diseño está vacío: añade algo antes de guardarlo como plantilla.' : 'Escribe un nombre.');
      return;
    }
    setError(null);
    try {
      await save.mutateAsync(draft);
      onSaved(draft.name);
      onOpenChange(false);
    } catch (caught) {
      setError(translateError(caught));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title="Guardar como plantilla"
      description="La marca podrá empezar otras piezas con este diseño. Se guarda lo que ves ahora en el editor, aunque no hayas guardado la versión."
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field
          label="Nombre de la plantilla"
          hint={`${targetLabel(network, format)} · ${pages === 1 ? '1 página' : `${pages} páginas`}`}
        >
          {(props) => (
            <Input
              {...props}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              data-testid="template-name-input"
              autoFocus
            />
          )}
        </Field>
        <Notice>
          Las fotos y los textos de ahora se quedan como guía: quien use la plantilla los sustituye. Si la usa en otra
          proporción o con otro número de páginas, se adapta y se le avisa de lo que cambia.
        </Notice>
        {empty && <Notice tone="warning">El diseño está vacío: añade algo antes de guardarlo como plantilla.</Notice>}
        {error && (
          <p role="alert" className="text-sm text-danger" data-testid="template-save-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending} disabled={empty || !name.trim()} data-testid="template-save">
            Guardar plantilla
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
