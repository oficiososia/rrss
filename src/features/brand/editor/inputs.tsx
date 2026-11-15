import { Plus, Trash2, X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { Button, Input, Textarea } from '@/components/ui';

interface StringListProps {
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  testId?: string;
}

/** Lista de textos cortos (tono, valores, objetivos…) como etiquetas que se añaden y se quitan. */
export function StringListInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
  disabled,
  maxLength = 300,
  testId,
}: StringListProps) {
  const id = useId();
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (!value) return;
    if (!values.some((v) => v.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-subtle py-1 pl-3 pr-1 text-sm"
            >
              <span className="break-words">{value}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(values.filter((v) => v !== value))}
                  aria-label={`Quitar «${value}»`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-border hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <Input
            id={id}
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={add}
            data-testid={testId}
          />
          <Button variant="secondary" onClick={add} disabled={!draft.trim()} aria-label={`Añadir a ${label}`}>
            <Plus className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Añadir</span>
          </Button>
        </div>
      )}
      {disabled && values.length === 0 && <p className="text-sm text-muted">Sin datos.</p>}
    </div>
  );
}

export interface RowField<T> {
  key: keyof T & string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  type?: 'text' | 'color' | 'url';
  width?: 'narrow' | 'normal' | 'wide';
}

interface RowListProps<T extends Record<string, string>> {
  label: string;
  hint?: string;
  rows: T[];
  fields: RowField<T>[];
  onChange: (rows: T[]) => void;
  newRow: () => T;
  addLabel: string;
  disabled?: boolean;
  testId?: string;
}

/** Lista de filas con varios campos (productos, colores, tipografías, redes…). */
export function RowListInput<T extends Record<string, string>>({
  label,
  hint,
  rows,
  fields,
  onChange,
  newRow,
  addLabel,
  disabled,
  testId,
}: RowListProps<T>) {
  const groupId = useId();
  const update = (index: number, key: keyof T & string, value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {rows.length === 0 && disabled && <p className="text-sm text-muted">Sin datos.</p>}
      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={index} className="flex items-start gap-2 rounded-lg border border-border bg-bg/50 p-2.5">
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-6">
              {fields.map((field) => {
                const id = `${groupId}-${index}-${field.key}`;
                const span =
                  field.width === 'narrow'
                    ? 'sm:col-span-2'
                    : field.width === 'wide'
                      ? 'sm:col-span-6'
                      : 'sm:col-span-3';
                const common = {
                  id,
                  value: row[field.key] ?? '',
                  placeholder: field.placeholder,
                  disabled,
                  'aria-label': `${field.label} (${index + 1})`,
                };
                return (
                  <div key={field.key} className={span}>
                    {field.multiline ? (
                      <Textarea {...common} rows={2} onChange={(e) => update(index, field.key, e.target.value)} />
                    ) : field.type === 'color' ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          aria-label={`Selector de ${field.label.toLowerCase()} (${index + 1})`}
                          disabled={disabled}
                          value={/^#[0-9a-fA-F]{6}$/.test(row[field.key] ?? '') ? row[field.key] : '#000000'}
                          onChange={(e) => update(index, field.key, e.target.value)}
                          className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1"
                        />
                        <Input
                          {...common}
                          maxLength={7}
                          onChange={(e) => update(index, field.key, e.target.value)}
                          className="font-mono"
                        />
                      </div>
                    ) : (
                      <Input
                        {...common}
                        type={field.type === 'url' ? 'url' : 'text'}
                        onChange={(e) => update(index, field.key, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {!disabled && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar fila ${index + 1} de ${label}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <Button variant="secondary" size="sm" onClick={() => onChange([...rows, newRow()])} data-testid={testId}>
          <Plus className="h-4 w-4" aria-hidden />
          {addLabel}
        </Button>
      )}
    </fieldset>
  );
}
