import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { StringListInput } from '@/features/brand/editor/inputs';
import { cleanFolderName, flattenTree, type FolderNode } from './folders';

const NEW_FOLDER = '__new';
const NO_FOLDER = '__none';

/** «Mover a…»: una carpeta que ya existe, ninguna o una nueva. */
export function MoveDialog({
  open,
  onOpenChange,
  count,
  tree,
  busy,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  tree: FolderNode[];
  busy: boolean;
  onMove: (folder: string) => void;
}) {
  const [choice, setChoice] = useState(NO_FOLDER);
  const [fresh, setFresh] = useState('');
  const folder = choice === NEW_FOLDER ? cleanFolderName(fresh) : choice === NO_FOLDER ? '' : choice;
  const invalid = choice === NEW_FOLDER && !folder;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!invalid) onMove(folder);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mover a una carpeta"
      description={`${count} ${count === 1 ? 'archivo' : 'archivos'}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="library-move" loading={busy} disabled={invalid} data-testid="move-confirm">
            Mover
          </Button>
        </>
      }
    >
      <form id="library-move" onSubmit={submit} className="space-y-4">
        <Field label="Carpeta de destino">
          {(p) => (
            <Select {...p} value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="move-target">
              <option value={NO_FOLDER}>Sin carpeta</option>
              {flattenTree(tree).map((node) => (
                <option key={node.path} value={node.path}>
                  {`${' '.repeat(node.depth)}${node.name}`}
                </option>
              ))}
              <option value={NEW_FOLDER}>Una carpeta nueva…</option>
            </Select>
          )}
        </Field>
        {choice === NEW_FOLDER && (
          <Field label="Nombre de la carpeta nueva" hint="Para meterla dentro de otra, escribe «Platos / Mariscos».">
            {(p) => (
              <Input
                {...p}
                autoFocus
                maxLength={200}
                value={fresh}
                onChange={(e) => setFresh(e.target.value)}
                data-testid="move-new-name"
              />
            )}
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/** Añadir etiquetas a varios archivos a la vez. */
export function TagDialog({
  open,
  onOpenChange,
  count,
  suggestions,
  busy,
  onTag,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  suggestions: string[];
  busy: boolean;
  onTag: (tags: string[]) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Etiquetar"
      description={`Se añaden a ${count} ${count === 1 ? 'archivo' : 'archivos'}; las que ya tienen se respetan.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => onTag(tags)} loading={busy} disabled={tags.length === 0} data-testid="tag-confirm">
            Añadir etiquetas
          </Button>
        </>
      }
    >
      <StringListInput
        label="Etiquetas"
        values={tags}
        onChange={setTags}
        placeholder="Escribe una y pulsa Intro"
        maxLength={50}
        testId="bulk-tag-input"
      />
      {suggestions.length > 0 && (
        <p className="mt-3 text-xs text-muted">Ya en uso: {suggestions.slice(0, 12).join(', ')}</p>
      )}
    </Dialog>
  );
}

/** Nombre de una carpeta nueva o nuevo nombre de una existente. */
export function FolderNameDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  confirmLabel,
  problem,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initial: string;
  confirmLabel: string;
  /** Qué falla con el nombre escrito (ya limpio); `null` si vale. */
  problem: (cleaned: string) => string | null;
  busy: boolean;
  onConfirm: (cleaned: string) => void;
}) {
  const [name, setName] = useState(initial);
  const cleaned = cleanFolderName(name);
  const issue = name.trim() ? problem(cleaned) : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (cleaned && !problem(cleaned)) onConfirm(cleaned);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="library-folder-name"
            loading={busy}
            disabled={!cleaned || problem(cleaned) !== null}
            data-testid="folder-name-confirm"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="library-folder-name" onSubmit={submit}>
        <Field label="Nombre" error={issue} hint="Para meterla dentro de otra, escribe «Platos / Mariscos».">
          {(p) => (
            <Input
              {...p}
              autoFocus
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="folder-name-input"
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
