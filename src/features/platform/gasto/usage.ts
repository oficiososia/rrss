// Cálculos puros de la pantalla «Gasto y uso» (sin red ni React).

/** Fracción usada de un límite (0..1+). `null` si no hay límite o es 0 y no se ha usado nada. */
export function usageRatio(used: number, limit: number | null | undefined): number | null {
  if (limit === null || limit === undefined) return null;
  if (limit <= 0) return used > 0 ? 1 : null;
  return used / limit;
}

export type Severity = 'ok' | 'warning' | 'danger';

/** 80 % o más = aviso; 100 % o más = agotado. */
export function severityOf(ratio: number | null): Severity {
  if (ratio === null) return 'ok';
  if (ratio >= 1) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

export function percentText(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)} %`;
}

/** Segundos de máquina como «2 h 05 min», «3 min 20 s» o «45 s». */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

/** Importe del ajuste «tope global» (con punto decimal) → micros, o `null` si no es válido. */
export function capToMicros(raw: string): number | null {
  const value = raw.trim();
  if (!/^[0-9]{1,9}(\.[0-9]{1,6})?$/.test(value)) return null;
  return Math.round(Number(value) * 1_000_000);
}
