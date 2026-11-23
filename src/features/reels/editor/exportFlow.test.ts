import { describe, expect, it } from 'vitest';
import type { MediaJobSummary } from '../plan';
import { REEL_TEMPLATES } from '../templates';
import { exportState, renderOfPlan, selfApprovalSteps, shouldRenderOnExport, type ExportInput } from './exportFlow';
import { buildRenderRequest, emptyProject } from './project';

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
    // Sin vídeo de lo que se ve (nunca montado, o con cambios en el montaje): se monta.
    expect(shouldRenderOnExport(exportState(input({ version: 0 })))).toBe(true);
    expect(shouldRenderOnExport(exportState(input()))).toBe(true);
    // Lo dice distinto si nunca hubo vídeo o si el que hay se ha quedado atrás.
    expect(exportState(input())).toEqual({ kind: 'changed', first: true });
    expect(exportState(input({ dirty: true, anyRender: true }))).toEqual({ kind: 'changed', first: false });
    // Con cambios que no tocan el montaje (el pie), el vídeo de ese montaje sigue valiendo.
    expect(exportState(input({ dirty: true, render: 'a' }))).toEqual({ kind: 'ready', assetId: 'a' });
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

  it('reconoce el vídeo de lo que se ve por su montaje, sea de la versión que sea', () => {
    const project = emptyProject(REEL_TEMPLATES[0]!);
    const withClip = {
      ...project,
      plan: { ...project.plan, clips: [{ id: 'c1', type: 'photo' as const, path: 'o/m/media/a.jpg', seconds: 2 }] },
    };
    const request = buildRenderRequest(withClip, { id: 'x', version: 3 }) as { template: unknown; plan: Record<string, unknown> };
    const job = (plan: unknown, status = 'succeeded') => ({
      id: `j-${status}`,
      kind: 'media.reel.template',
      status,
      attempts: 1,
      max_attempts: 3,
      last_error: null,
      created_at: '2026-11-23T10:00:00Z',
      result: status === 'succeeded' ? { assets: [{ id: 'video-1' }] } : null,
      // Como lo guarda la base de datos: otro orden de claves y la tipografía de la marca añadida.
      payload: { content: { id: 'x', version: 1 }, plan, template: request.template },
    }) as unknown as MediaJobSummary;
    const stored = { fontPath: 'o/m/fonts/marca.ttf', ...Object.fromEntries(Object.entries(request.plan).reverse()) };
    expect(renderOfPlan([job(stored)], withClip)).toBe('video-1');
    // Con el pie cambiado, el mismo vídeo.
    expect(renderOfPlan([job(stored)], { ...withClip, copy: { caption: 'Hola', hashtags: [] } })).toBe('video-1');
    // Con otro montaje, no; ni de un trabajo sin terminar.
    const other = REEL_TEMPLATES.find((t) => t.id !== withClip.template.id)!.id;
    expect(renderOfPlan([job(stored)], { ...withClip, template: { id: other } })).toBeNull();
    expect(renderOfPlan([job(stored, 'running')], withClip)).toBeNull();
  });
});
