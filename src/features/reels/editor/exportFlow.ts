// «Exportar» del editor de reels: en qué punto está el vídeo de lo que se ve
// y qué cambios de estado hacen falta para publicarlo. Puro, para probarlo sin
// pantalla. Quien manda sigue siendo la base de datos (set_content_status):
// aquí solo se decide qué pedirle y en qué orden.
import type { ContentStatus } from '@/lib/database.types';

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
  /** Versión vigente (0 = ninguna todavía). */
  version: number;
  /** Vídeo montado de la versión vigente, si lo hay. */
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
  if (input.dirty || input.version === 0) return { kind: 'changed', first: input.render === null };
  if (input.render) return { kind: 'ready', assetId: input.render };
  if (input.failed) return { kind: 'failed', detail: input.failed.detail };
  return { kind: 'changed', first: true };
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
