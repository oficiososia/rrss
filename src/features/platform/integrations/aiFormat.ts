import type { PlatformCostRow } from '@/lib/database.types';
import type { AiProviderId } from './api';

// Formato y cuentas de las sugerencias de IA (sin React).

const number = (digits: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits });

/** «≈ 0,04 céntimos» o «menos de 0,01 céntimos». */
export function centsText(cents: number): string {
  if (cents < 0.01) return 'menos de 0,01 céntimos';
  const digits = cents < 1 ? 3 : cents < 10 ? 2 : 1;
  return `≈ ${number(digits).format(cents)} céntimos`;
}


/** Primer día del mes en curso (UTC), como lo pide la base de datos. */
export function currentPeriodStart(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}


/** Coste liquidado del mes por tipo de operación, con la media por operación. */
const COST_LABELS: Record<string, { label: string; unit: string }> = {
  'editor.copilot': { label: 'Órdenes del copiloto', unit: 'orden' },
  'post.caption': { label: 'Pies de foto y textos', unit: 'pie' },
  'profile.proposal': { label: 'Propuestas de perfil de marca', unit: 'propuesta' },
  'brand.check': { label: 'Revisiones de marca', unit: 'revisión' },
  'campaign.plan': { label: 'Planes de campaña', unit: 'plan' },
  'analytics.summary': { label: 'Informes de analítica', unit: 'informe' },
};

export interface CostLine {
  key: string;
  label: string;
  unit: string;
  operations: number;
  totalUsd: number;
  /** Céntimos por unidad (por operación; por minuto en los subtítulos). */
  centsPerUnit: number;
}

export function costLines(rows: PlatformCostRow[], provider: AiProviderId): CostLine[] {
  const mine = rows.filter((r) =>
    provider === 'openai' ? r.provider === 'openai' : r.provider.startsWith('anthropic'),
  );
  return mine.map((r) => {
    const totalUsd = Number(r.cost_micros) / 1_000_000;
    const operations = Number(r.operations);
    if (r.task === 'transcription') {
      const minutes = Number(r.audio_seconds) / 60;
      return {
        key: `${r.purpose}/${r.model}`,
        label: 'Subtítulos',
        unit: 'minuto transcrito',
        operations,
        totalUsd,
        centsPerUnit: minutes > 0 ? (totalUsd * 100) / minutes : 0,
      };
    }
    const known = COST_LABELS[r.purpose];
    return {
      key: `${r.purpose}/${r.model}`,
      label: r.task === 'image' ? 'Imágenes' : (known?.label ?? r.purpose),
      unit: r.task === 'image' ? 'imagen' : (known?.unit ?? 'operación'),
      operations,
      totalUsd,
      centsPerUnit: operations > 0 ? (totalUsd * 100) / operations : 0,
    };
  });
}

