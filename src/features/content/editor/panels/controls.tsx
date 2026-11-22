import { useId, useState, type ReactNode } from 'react';
import { HEX_COLOR } from '../../document';
import { cn } from '@/lib/utils';
import { recalledSection, rememberSection } from './sectionMemory';

// Controles compactos del panel de propiedades. Todos avisan del cambio al
// teclear (para ver el resultado en el lienzo) y cortan el paso de deshacer al
// salir del campo (`onCommit`).

const INPUT =
  'h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-fg disabled:cursor-not-allowed disabled:opacity-60';

export function Labeled({
  label,
  children,
  className,
}: {
  label: string;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  testId?: string;
}) {
  // Texto propio mientras se escribe, para no pelearse con «-» o «1.» a medias.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(value * 100) / 100);
  return (
    <Labeled label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={INPUT}
          value={shown}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => {
            setDraft(e.target.value);
            const parsed = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(parsed)) {
              const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
              onChange(clamped);
            }
          }}
          onBlur={() => {
            setDraft(null);
            onCommit?.();
          }}
        />
      )}
    </Labeled>
  );
}

export function SelectInput<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Labeled label={label}>
      {(id) => (
        <select
          id={id}
          className={INPUT}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Labeled>
  );
}

/**
 * Color: primero los de la marca (lo recomendable), y un selector libre. El
 * verificador de marca avisa si se usa un color fuera de la paleta.
 */
export function ColorInput({
  label,
  value,
  palette,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: string;
  palette: { hex: string; name: string }[];
  onChange: (value: string) => void;
  onCommit?: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="text-xs font-medium text-muted">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {palette.map((color) => (
          <button
            key={color.hex + color.name}
            type="button"
            title={color.name || color.hex}
            aria-label={`${color.name || 'Color de la marca'} ${color.hex}`}
            aria-pressed={color.hex.toUpperCase() === value.toUpperCase()}
            onClick={() => {
              onChange(color.hex.toUpperCase());
              onCommit?.();
            }}
            className="h-7 w-7 rounded-full border border-border ring-primary ring-offset-2 ring-offset-surface aria-pressed:ring-2"
            style={{ backgroundColor: color.hex }}
          />
        ))}
        <label htmlFor={id} className="sr-only">
          {`${label}: otro color`}
        </label>
        <input
          id={id}
          type="color"
          className="h-7 w-10 cursor-pointer rounded border border-border bg-surface"
          value={HEX_COLOR.test(value) ? value.toLowerCase() : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={onCommit}
        />
        <span className="font-mono text-xs text-muted">{value.toUpperCase()}</span>
      </div>
    </fieldset>
  );
}

/** Deslizador con su valor a la vista. Avisa al mover y corta el paso de deshacer al soltar. */
export function RangeInput({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  const shown = Math.round(value * 100) / 100;
  return (
    <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2">
      <label htmlFor={id} className="truncate text-xs font-medium text-muted" title={label}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="h-6 w-full accent-primary disabled:opacity-60"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        data-testid={testId}
        aria-valuetext={String(shown)}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      <output htmlFor={id} className="text-right font-mono text-xs tabular-nums text-muted">
        {shown}
      </output>
    </div>
  );
}

export function CheckInput({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/**
 * Sección plegable del panel (nativa, con teclado y lector de pantalla). Las
 * abiertas por defecto son las de uso más común. Con `id`, el navegador recuerda
 * si la persona la dejó abierta o cerrada; `summary` enseña en la cabecera el
 * valor de ahora, para no tener que abrirla a mirar.
 */
export function Section({
  title,
  summary,
  id,
  defaultOpen = false,
  testId,
  className,
  children,
}: {
  title: string;
  summary?: string;
  id?: string;
  defaultOpen?: boolean;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => (id ? (recalledSection(id) ?? defaultOpen) : defaultOpen));
  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setOpen(next);
        if (id) rememberSection(id, next);
      }}
      className={cn('group border-t border-border', className)}
      data-testid={testId}
      data-section={id}
    >
      <summary
        className="flex min-h-[2.5rem] cursor-pointer list-none items-center gap-2 rounded text-sm font-medium text-fg marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-lg:min-h-[2.75rem] [&::-webkit-details-marker]:hidden"
        data-testid="section-summary"
      >
        <span className="shrink-0">{title}</span>
        {summary && (
          <span
            className="min-w-0 flex-1 truncate text-right text-xs font-normal text-muted"
            data-testid="section-value"
          >
            {summary}
          </span>
        )}
        {!summary && <span className="flex-1" />}
        <span aria-hidden className="text-base leading-none text-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-3 pb-3 pt-1">{children}</div>
    </details>
  );
}
