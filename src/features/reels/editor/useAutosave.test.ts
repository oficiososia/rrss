// Guardado automático del editor de reels: lo que pasa al salir con un guardado a medias.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReelProject } from './project';
import { AUTOSAVE_DELAY_MS, useAutosave, type AutosaveOptions } from './useAutosave';

const api = vi.hoisted(() => ({
  saveReelDraft: vi.fn<(contentId: string, project: unknown, baseVersion: number) => Promise<string>>(),
  discardReelDraft: vi.fn(async () => undefined),
  keepLocalDraft: vi.fn(),
  dropLocalDraft: vi.fn(),
}));
vi.mock('./api', () => api);

const project = (name: string) => ({ kind: 'reel', name }) as unknown as ReelProject;
const options = (snapshot: string): AutosaveOptions => ({
  contentId: 'reel-1',
  project: project(snapshot),
  snapshot,
  dirty: true,
  baseVersion: 1,
  enabled: true,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAutosave al salir del editor', () => {
  it('si sale con un guardado en marcha y cambios más nuevos, los guarda en cuanto acaba, sin dejar relojes vivos', async () => {
    // Antes: al acabar el guardado en marcha, lo nuevo se dejaba para 1,5 s después con un reloj
    // que sobrevivía al editor. Si en ese rato se volvía a abrir el reel, ese reloj pisaba el
    // borrador del servidor con el montaje del editor ya cerrado (y en las pruebas se colaba en
    // la prueba siguiente).
    let finishFirst: (value: string) => void = () => undefined;
    api.saveReelDraft.mockImplementationOnce(() => new Promise<string>((resolve) => (finishFirst = resolve)));
    api.saveReelDraft.mockResolvedValue('2026-11-24T10:00:00Z');

    const { rerender, unmount } = renderHook((props: AutosaveOptions) => useAutosave(props), {
      initialProps: options('A'),
    });
    // Un momento después del cambio empieza el guardado de A, que tarda.
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(api.saveReelDraft).toHaveBeenCalledTimes(1);
    // Mientras se guarda, otro cambio (B) y se sale del editor.
    rerender(options('B'));
    unmount();
    expect(api.saveReelDraft).toHaveBeenCalledTimes(1);

    // Acaba el guardado de A: B se guarda en el acto, y no queda ningún reloj pendiente.
    await act(async () => finishFirst('2026-11-24T09:59:00Z'));
    expect(api.saveReelDraft).toHaveBeenCalledTimes(2);
    expect(api.saveReelDraft.mock.calls[1]![1]).toEqual(project('B'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('si el guardado falla después de salir, queda la copia del navegador y no se reintenta con un reloj', async () => {
    let failFirst: (error: unknown) => void = () => undefined;
    api.saveReelDraft.mockImplementationOnce(() => new Promise<string>((_, reject) => (failFirst = reject)));

    const { unmount } = renderHook((props: AutosaveOptions) => useAutosave(props), { initialProps: options('A') });
    act(() => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    unmount();
    await act(async () => failFirst(new Error('sin conexión')));
    expect(api.keepLocalDraft).toHaveBeenCalledWith('reel-1', project('A'), 1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
