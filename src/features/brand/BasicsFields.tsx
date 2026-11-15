import { useMemo } from 'react';
import { Field, Input, Select } from '@/components/ui';
import { LOCALES } from '@/config/app';
import type { BrandBasics } from './config';

const FALLBACK_TIMEZONES = [
  'Europe/Madrid',
  'Atlantic/Canary',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Paris',
  'America/Mexico_City',
  'America/Bogota',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'UTC',
];

function timezones(current: string): string[] {
  let list: string[] = FALLBACK_TIMEZONES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
      'timeZone',
    );
    if (supported && supported.length > 0) list = supported;
  } catch {
    /* navegador antiguo: lista corta */
  }
  return list.includes(current) ? list : [current, ...list];
}

interface BasicsFieldsProps {
  value: BrandBasics;
  onChange: (value: BrandBasics) => void;
  disabled?: boolean;
  nameError?: string | null;
}

/** Datos básicos de la marca (tabla `brands`). Los comparten el asistente y la pantalla de marca. */
export function BasicsFields({ value, onChange, disabled, nameError }: BasicsFieldsProps) {
  const zones = useMemo(() => timezones(value.timezone), [value.timezone]);
  const set = (patch: Partial<BrandBasics>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nombre comercial" error={nameError} className="sm:col-span-2">
        {(p) => (
          <Input
            {...p}
            required
            maxLength={120}
            disabled={disabled}
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
            data-testid="brand-name"
          />
        )}
      </Field>
      <Field label="Sector" optional>
        {(p) => (
          <Input
            {...p}
            maxLength={120}
            disabled={disabled}
            value={value.sector}
            onChange={(e) => set({ sector: e.target.value })}
            placeholder="Restauración, moda, salud…"
            data-testid="brand-sector"
          />
        )}
      </Field>
      <Field label="Página web" optional>
        {(p) => (
          <Input
            {...p}
            type="url"
            maxLength={300}
            disabled={disabled}
            value={value.website}
            onChange={(e) => set({ website: e.target.value })}
            placeholder="https://…"
            data-testid="brand-website"
          />
        )}
      </Field>
      <Field label="Idioma principal">
        {(p) => (
          <Select
            {...p}
            disabled={disabled}
            value={value.default_locale}
            onChange={(e) => set({ default_locale: e.target.value })}
          >
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
            {!LOCALES.some((l) => l.value === value.default_locale) && (
              <option value={value.default_locale}>{value.default_locale}</option>
            )}
          </Select>
        )}
      </Field>
      <Field label="Zona horaria" hint="Se usará para programar las publicaciones.">
        {(p) => (
          <Select {...p} disabled={disabled} value={value.timezone} onChange={(e) => set({ timezone: e.target.value })}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
