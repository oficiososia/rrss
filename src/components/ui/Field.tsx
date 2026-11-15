import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const CONTROL =
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted/70 ' +
  'transition-colors hover:border-muted/60 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-11', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(CONTROL, 'py-2.5 leading-relaxed', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL, 'h-11 pr-8', className)} {...props}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  className?: string;
  /** Recibe los atributos de accesibilidad que debe llevar el control. */
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}

/** Etiqueta + control + ayuda + error, enlazados para lectores de pantalla. */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-medium text-fg">
        {label}
        {optional && <span className="text-xs font-normal text-muted">opcional</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
