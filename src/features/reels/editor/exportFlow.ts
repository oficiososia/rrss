// «Exportar» del editor de reels: en qué punto está el vídeo de lo que se ve
// y qué cambios de estado hacen falta para publicarlo. Puro, para probarlo sin
// pantalla. Quien manda sigue siendo la base de datos (set_content_status):
// aquí solo se decide qué pedirle y en qué orden.
import type { ContentStatus } from '@/lib/database.types';
import { describeJob, type MediaJobSummary } from '../plan';
import { buildRenderRequest, ProjectError, type ReelProject } from './project';

/** Lo que enseña la hoja «Exportar». */
export type ExportState =
  /** El reel no tiene fotos ni clips. */
  | { kind: 'empty' }
  /** Todavía no se sabe si ya hay vídeo (llegando la lista de montajes). */
  | { kind: 'checking' }
  /** Hay algo que impide montarlo (se dice qué). */
  | { kind: 'problems'; problems: string[] }
  /** En esta instalación no se monta vídeo. */
  | { kind: 'unavailable' }
  /** Guardando la versión o montando el vídeo. */
  | { kind: 'rendering'; label: string }
  /** El último montaje de esta versión falló. */
  | { kind: 'failed'; detail: string | null }
  /** Hay cambios que el vídeo todavía no tiene; `first`: nunca se ha montado lo que se ve. */
  | { kind: 'changed'; first: boolean }
  /** El vídeo de lo que se ve está montado y en la biblioteca. */
  | { kind: 'ready'; assetId: string };

export interface ExportInput {
  empty: boolean;
  problems: string[];
  /** ¿Hay trabajador de medios en esta instalación? */
  worker: boolean;
  /** La lista de montajes todavía no ha llegado. */
  checking?: boolean;
  /** Guardando la versión o encargando el montaje ahora mismo. */
  busy: boolean;
  /** Hay un montaje en cola o en marcha de la versión vigente. */
  rendering: boolean;
  /** Etiqueta del montaje en marcha («En cola», «Montando»…). */
  renderLabel?: string | null;
  /** Lo que se ve tiene cambios que no están en la versión vigente. */
  dirty: boolean;
  /** ¿Se ha montado alguna vez algún vídeo de esta pieza? */
  anyRender?: boolean;
  /** Versión vigente (0 = ninguna todavía). */
  version: number;
  /** Vídeo ya montado de lo que se ve (mismo estilo y mismo plan; ver `renderOfPlan`), si lo hay. */
  render: string | null;
  /** El último montaje de la versión vigente falló: por qué. */
  failed: { detail: string | null } | null;
}

export function exportState(input: ExportInput): ExportState {
  if (input.empty) return { kind: 'empty' };
  if (input.problems.length > 0) return { kind: 'problems', problems: input.problems };
  if (!input.worker) return { kind: 'unavailable' };
  if (input.checking) return { kind: 'checking' };
  if (input.busy || input.rendering) return { kind: 'rendering', label: input.renderLabel ?? 'Montando' };
  // Cambiar solo el pie no pide otro vídeo: vale el que ya tiene ese mismo montaje.
  if (input.render) return { kind: 'ready', assetId: input.render };
  if (input.failed && !input.dirty && input.version > 0) return { kind: 'failed', detail: input.failed.detail };
  return { kind: 'changed', first: !input.anyRender };
}

/**
 * Al pulsar «Exportar», ¿hay que montar? Solo si lo que se ve no tiene vídeo y no hay nada en marcha.
 * Un montaje que falló no se repite solo: se dice por qué y se ofrece «Probar otra vez».
 */
export function shouldRenderOnExport(state: ExportState): boolean {
  return state.kind === 'changed';
}

/**
 * En autogestión no hay paso de aprobación a la vista: «Publicar o programar» aprueba por debajo, con
 * los pasos que exige la base de datos (una idea pasa antes por borrador; un borrador o una pieza en
 * revisión se aprueban directamente).
 */
export function selfApprovalSteps(status: ContentStatus): ContentStatus[] {
  switch (status) {
    case 'approved':
      return [];
    case 'idea':
      return ['draft', 'approved'];
    case 'draft':
    case 'in_review':
      return ['approved'];
  }
}

/** JSON con las claves ordenadas: la base de datos (jsonb) no conserva el orden. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * El vídeo ya montado de lo que se ve: el del último montaje terminado con el mismo estilo y el mismo plan,
 * sea de la versión que sea. Así, cambiar solo el pie (o volver a algo que ya se montó) no pide montar otra
 * vez. Null si no lo hay o si el montaje todavía no es válido.
 */
export function renderOfPlan(jobs: MediaJobSummary[], project: ReelProject): string | null {
  let wanted: string;
  let ownFont: boolean;
  try {
    const request = buildRenderRequest(project, { id: '', version: 0 }) as {
      template: unknown;
      plan: Record<string, unknown>;
    };
    wanted = stable({ template: request.template, plan: request.plan });
    ownFont = 'fontPath' in request.plan;
  } catch (error) {
    if (error instanceof ProjectError) return null;
    throw error;
  }
  for (const job of jobs) {
    const view = describeJob(job);
    if (!view.assetId) continue;
    const payload = (job.payload ?? {}) as { template?: { id?: unknown }; plan?: Record<string, unknown> };
    // La base de datos pone la tipografía de la marca en el plan si no la llevaba (jobs_reel_brand_font).
    const plan = payload.plan && !ownFont ? { ...payload.plan, fontPath: undefined } : payload.plan;
    if (stable({ template: { id: payload.template?.id }, plan }) === wanted) return view.assetId;
  }
  return null;
}
