import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { REEL_TEMPLATES } from '../templates';
import { Inspector, type InspectorProps } from './Inspector';
import { addClip, addText, setMusic } from './ops';
import { emptyProject, planTimeline, templateTextStyle, type ReelProject } from './project';

const fundido = REEL_TEMPLATES.find((t) => t.id === 'fundido-suave')!;
const asset = (id: string, kind: 'image' | 'video', ms: number | null = null) => ({
  id,
  kind,
  storage_path: `o/m/media/${id}`,
  file_name: id,
  mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  duration_ms: ms,
});

function project(): ReelProject {
  let p = emptyProject(fundido);
  for (const name of ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']) p = addClip(p, asset(name, 'image'), fundido);
  p = addText(p, fundido, 0, templateTextStyle(fundido), 8);
  return setMusic(p, 'o/m/media/musica.m4a', fundido);
}

function setup(
  selection: InspectorProps['selection'],
  beats: InspectorProps['beats'] = { analysis: null, busy: false, error: null, analyze: vi.fn() },
) {
  const p = project();
  const applied: Array<(p: ReelProject) => ReelProject> = [];
  const props: InspectorProps = {
    project: p,
    selection,
    template: fundido,
    readOnly: false,
    apply: (change) => applied.push(change),
    onSelect: vi.fn(),
    labelOf: (path) => path.split('/').pop()!,
    fileSecondsOf: () => null,
    urlOf: () => undefined,
    palette: [],
    fonts: [],
    autoSubtitles: false,
    brandId: 'b',
    beats,
    onPlayFrom: vi.fn(),
  };
  render(<Inspector {...props} />);
  return { p, applied, props, beats };
}

describe('panel: animación del texto', () => {
  it('elige cómo entra y sale, y reproduce desde un poco antes', () => {
    const { p, applied, props } = setup({ kind: 'text', id: 't1' });
    expect(screen.getByLabelText('Cómo entra el texto')).toHaveValue('fade');
    fireEvent.change(screen.getByLabelText('Cómo entra el texto'), { target: { value: 'typewriter' } });
    fireEvent.change(screen.getByLabelText('Cómo sale el texto'), { target: { value: 'fall' } });
    expect(applied[0]!(p).plan.texts[0]!.animation).toEqual({ in: 'typewriter', out: 'fade' });
    expect(applied[1]!(p).plan.texts[0]!.animation).toEqual({ in: 'fade', out: 'fall' });
    fireEvent.click(screen.getByTestId('reel-text-animation-play'));
    expect(props.onPlayFrom).toHaveBeenCalledWith(0);
  });
});

describe('panel: movimiento de cámara', () => {
  it('ofrece los movimientos con su vista previa, elige uno y la intensidad', () => {
    const { p, applied } = setup({ kind: 'clip', id: 'c1' });
    expect(screen.getAllByRole('radio')).toHaveLength(8); // el de la plantilla + 7
    expect(screen.getByRole('radio', { name: 'Subir la cámara' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Bajar la cámara' }));
    expect(applied[0]!(p).plan.clips[0]).toMatchObject({ motion: 'pan-down' });
    fireEvent.change(screen.getByLabelText('Intensidad del movimiento'), { target: { value: '0.15' } });
    expect(applied[1]!(p).plan.clips[0]).toMatchObject({ motionAmount: 0.15 });
  });
});

describe('panel: cortes al ritmo', () => {
  it('analiza la música y reparte las duraciones en los golpes; se puede deshacer porque es un cambio más', async () => {
    const beatsList = Array.from({ length: 40 }, (_, i) => Number((0.3 + i * 0.6).toFixed(3)));
    const analyze = vi.fn().mockResolvedValue({ bpm: 100, beats: beatsList, confidence: 0.8 });
    const { p, applied } = setup({ kind: 'music' }, { analysis: null, busy: false, error: null, analyze });
    fireEvent.change(screen.getByLabelText('Cada cuántos golpes se corta'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('reel-fit-beats'));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(analyze).toHaveBeenCalledTimes(1);
    const next = applied[0]!(p);
    expect(next).not.toBe(p);
    const timeline = planTimeline(next.plan.clips, fundido);
    const cuts = next.plan.clips.slice(1).map((_, i) => timeline.starts[i + 1]! + timeline.transitions[i + 1]! / 2);
    for (const cut of cuts) expect(Math.min(...beatsList.map((b) => Math.abs(b - cut)))).toBeLessThan(0.07);
    expect(screen.getByTestId('reel-fit-note')).toHaveTextContent(/Cortes ajustados a la música/);
    expect(screen.getByTestId('reel-fit-note')).toHaveTextContent(/Deshacer/);
    // El proyecto de antes no se ha tocado: «Deshacer» lo recupera.
    expect(p.plan.clips[0]).toMatchObject({ seconds: 2.5 });
  });

  it('enseña el fallo si no se puede analizar y no cambia nada', async () => {
    const analyze = vi.fn().mockResolvedValue(null);
    const { applied } = setup({ kind: 'music' }, { analysis: null, busy: false, error: 'El navegador no ha podido leer esa música.', analyze });
    expect(screen.getByRole('alert')).toHaveTextContent('no ha podido leer');
    fireEvent.click(screen.getByTestId('reel-fit-beats'));
    await waitFor(() => expect(analyze).toHaveBeenCalled());
    expect(applied).toHaveLength(0);
  });
});
