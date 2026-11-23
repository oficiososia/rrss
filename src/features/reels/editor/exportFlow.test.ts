import { describe, expect, it } from 'vitest';
import { exportState, selfApprovalSteps, shouldRenderOnExport, type ExportInput } from './exportFlow';

// «Exportar» del editor de reels: qué enseña la hoja y cuándo se monta solo.

const input = (patch: Partial<ExportInput> = {}): ExportInput => ({
  empty: false,
  problems: [],
  worker: true,
  busy: false,
  rendering: false,
  renderLabel: null,
  dirty: false,
  version: 1,
  render: null,
  failed: null,
  ...patch,
});

describe('exportar un reel', () => {
  it('lo que impide montar va antes que nada: vacío, problemas (un archivo borrado, el primero) y sin trabajador', () => {
    expect(exportState(input({ empty: true, problems: ['x'] }))).toEqual({ kind: 'empty' });
    expect(exportState(input({ problems: ['Falta la foto 2'] }))).toEqual({
      kind: 'problems',
      problems: ['Falta la foto 2'],
    });
    expect(exportState(input({ worker: false, dirty: true }))).toEqual({ kind: 'unavailable' });
  });

  it('monta solo si lo que se ve no tiene vídeo; un montaje que falló no se repite solo', () => {
    // Cambios sin vídeo, o sin ninguna versión todavía: se monta.
    expect(shouldRenderOnExport(exportState(input({ dirty: true, render: 'a' })))).toBe(true);
    expect(shouldRenderOnExport(exportState(input({ version: 0 })))).toBe(true);
    expect(shouldRenderOnExport(exportState(input()))).toBe(true);
    // Lo dice distinto si nunca hubo vídeo o si el que hay se ha quedado atrás.
    expect(exportState(input())).toEqual({ kind: 'changed', first: true });
    expect(exportState(input({ dirty: true, render: 'a' }))).toEqual({ kind: 'changed', first: false });
    // Ya montado, montándose o fallido: no.
    expect(exportState(input({ render: 'video-1' }))).toEqual({ kind: 'ready', assetId: 'video-1' });
    expect(shouldRenderOnExport(exportState(input({ render: 'video-1' })))).toBe(false);
    expect(exportState(input({ rendering: true, renderLabel: 'En cola' }))).toEqual({
      kind: 'rendering',
      label: 'En cola',
    });
    expect(exportState(input({ busy: true }))).toEqual({ kind: 'rendering', label: 'Montando' });
    // Mientras llega la lista de montajes no se decide nada (no vaya a montarse otra vez lo que ya está).
    expect(exportState(input({ checking: true, dirty: true }))).toEqual({ kind: 'checking' });
    expect(shouldRenderOnExport({ kind: 'checking' })).toBe(false);
    const failed = exportState(input({ failed: { detail: 'Sin espacio' } }));
    expect(failed).toEqual({ kind: 'failed', detail: 'Sin espacio' });
    expect(shouldRenderOnExport(failed)).toBe(false);
  });

  it('en autogestión, «Publicar o programar» aprueba con los pasos que exige la base de datos', () => {
    expect(selfApprovalSteps('idea')).toEqual(['draft', 'approved']);
    expect(selfApprovalSteps('draft')).toEqual(['approved']);
    expect(selfApprovalSteps('in_review')).toEqual(['approved']);
    expect(selfApprovalSteps('approved')).toEqual([]);
  });
});
