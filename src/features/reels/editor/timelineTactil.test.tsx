import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { REEL_TEMPLATES } from '../templates';
import { addClip, addText } from './ops';
import { emptyProject, planTimeline, templateTextStyle } from './project';
import { LONG_PRESS_MS, Timeline, type TimelineProps } from './Timeline';
import { CoverPicker } from './CoverPicker';

const fundido = REEL_TEMPLATES.find((t) => t.id === 'fundido-suave')!;
const asset = (id: string, kind: 'image' | 'video', ms: number | null = null) => ({
  id,
  kind,
  storage_path: `o/m/media/${id}`,
  file_name: id,
  mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  duration_ms: ms,
});

beforeAll(() => {
  // jsdom no trae PointerEvent: uno con `pointerType` y `pointerId`.
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerType?: string; pointerId?: number } = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
      this.pointerId = init.pointerId ?? 1;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
});
afterEach(() => vi.useRealTimers());

function setup(overrides: Partial<TimelineProps> = {}) {
  let project = addClip(emptyProject(fundido), asset('a.jpg', 'image'), fundido);
  project = addClip(project, asset('b.mp4', 'video', 10_000), fundido);
  project = addClip(project, asset('c.jpg', 'image'), fundido);
  project = addText(project, fundido, 0, templateTextStyle(fundido), 6);
  const timeline = planTimeline(project.plan.clips, fundido, () => 10);
  const props: TimelineProps = {
    plan: project.plan,
    timeline,
    pxPerSecond: 60,
    playhead: 0,
    selection: null,
    readOnly: false,
    labelOf: (p) => p.split('/').pop()!,
    fileSecondsOf: () => 10,
    onSeek: vi.fn(),
    onSelect: vi.fn(),
    onMoveClip: vi.fn(),
    onTrimClip: vi.fn(),
    onMoveText: vi.fn(),
    onTrimText: vi.fn(),
    onDragEnd: vi.fn(),
    ...overrides,
  };
  render(<Timeline {...props} />);
  return props;
}

describe('línea de tiempo con teclado', () => {
  it('las asas de recorte se alcanzan con el tabulador y se mueven con las flechas (Mayús = 1 s)', () => {
    const props = setup();
    const handle = screen.getByRole('slider', { name: 'Recortar el final del clip 2' });
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-valuenow', '4');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(props.onTrimClip).toHaveBeenLastCalledWith('c2', 'end', 4.1, 'kbd:c2:end');
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(props.onTrimClip).toHaveBeenLastCalledWith('c2', 'end', 3, 'kbd:c2:end');
    fireEvent.keyUp(handle, { key: 'ArrowLeft' });
    expect(props.onDragEnd).toHaveBeenCalled();
    // Principio del clip y duración de una foto.
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Recortar el principio del clip 2' }), { key: 'ArrowRight' });
    expect(props.onTrimClip).toHaveBeenLastCalledWith('c2', 'start', 0.1, 'kbd:c2:start');
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Duración de la foto 1' }), { key: 'ArrowRight' });
    expect(props.onTrimClip).toHaveBeenLastCalledWith('c1', 'end', 2.6, 'kbd:c1:end');
    // Los textos también.
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Cuándo sale el texto 1' }), { key: 'ArrowLeft' });
    expect(props.onTrimText).toHaveBeenLastCalledWith('t1', 'end', 1.9, 'kbd:t1:end');
  });

  it('en solo lectura las flechas no cambian nada', () => {
    const props = setup({ readOnly: true });
    expect(screen.queryByRole('slider', { name: 'Recortar el final del clip 2' })).toBeNull();
    expect(props.onTrimClip).not.toHaveBeenCalled();
  });

  it('Alt + flechas mueve el clip elegido', () => {
    const props = setup();
    const clip = screen.getByRole('button', { name: /^2\. Clip b\.mp4/ });
    fireEvent.keyDown(clip, { key: 'ArrowLeft', altKey: true });
    expect(props.onMoveClip).toHaveBeenCalledWith(1, 0);
  });
});

describe('arrastrar con el dedo', () => {
  it('un toque corto y un gesto de desplazar no arrastran el clip', () => {
    vi.useFakeTimers();
    const props = setup();
    const clip = screen.getByRole('button', { name: /^1\. Foto a\.jpg/ });
    fireEvent.pointerDown(clip, { pointerType: 'touch', clientX: 100, clientY: 50 });
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.pointerUp(window, { pointerType: 'touch', clientX: 100 });
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS + 50));
    expect(screen.queryByTestId('reel-drop-indicator')).toBeNull();
    // Desplazar: el dedo se mueve antes de cumplirse la pulsación larga → se cancela.
    fireEvent.pointerDown(clip, { pointerType: 'touch', clientX: 100, clientY: 50 });
    fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 160, clientY: 52 });
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS + 50));
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window, { clientX: 400 });
    expect(props.onMoveClip).not.toHaveBeenCalled();
  });

  it('con la pulsación larga el clip se arrastra y se suelta en su sitio (con aviso de vibración)', () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const props = setup();
    const clip = screen.getByRole('button', { name: /^1\. Foto a\.jpg/ });
    fireEvent.pointerDown(clip, { pointerType: 'touch', clientX: 20, clientY: 50 });
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    expect(vibrate).toHaveBeenCalled();
    // Arrastra a la derecha, más allá del centro del segundo clip.
    fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 330 });
    expect(screen.getByTestId('reel-drop-indicator')).toBeInTheDocument();
    fireEvent.pointerUp(window, { pointerType: 'touch', clientX: 330 });
    expect(props.onMoveClip).toHaveBeenCalledWith(0, 1);
  });

  it('con el ratón se arrastra al instante', () => {
    const props = setup();
    const clip = screen.getByRole('button', { name: /^1\. Foto a\.jpg/ });
    fireEvent.pointerDown(clip, { pointerType: 'mouse', button: 0, clientX: 20, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 330 });
    fireEvent.pointerUp(window, { clientX: 330 });
    expect(props.onMoveClip).toHaveBeenCalledWith(0, 1);
  });
});

describe('golpes de la música en la línea de tiempo', () => {
  it('marca cada golpe dentro del vídeo', () => {
    let p = addClip(emptyProject(fundido), asset('a.jpg', 'image'), fundido);
    p = { ...p, plan: { ...p.plan, music: { path: 'o/m/media/m.m4a', startAt: 0, volume: 0.3, fadeInSeconds: 0, fadeOutSeconds: 0 } } };
    setup({ plan: p.plan, timeline: planTimeline(p.plan.clips, fundido), beats: [0.5, 1, 1.5, 9] });
    expect(screen.getAllByTestId('reel-beat')).toHaveLength(3);
  });
});

describe('portada', () => {
  const plan = () => addClip(emptyProject(fundido), asset('a.jpg', 'image'), fundido).plan;

  it('usa el fotograma de ahora, una foto del reel, o se quita', () => {
    const onChange = vi.fn();
    const onSeek = vi.fn();
    const { rerender } = render(
      <CoverPicker plan={plan()} playhead={1.234} total={2.5} readOnly={false} urlOf={() => undefined} labelOf={(p) => p} onChange={onChange} onSeek={onSeek} />,
    );
    expect(screen.getByTestId('reel-cover-status')).toHaveTextContent('Sin elegir');
    fireEvent.click(screen.getByTestId('reel-cover-frame'));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'frame', at: 1.23 });
    fireEvent.click(screen.getByRole('radio', { name: /Portada: o\/m\/media\/a\.jpg/ }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'photo', path: 'o/m/media/a.jpg' });
    rerender(
      <CoverPicker plan={{ ...plan(), cover: { type: 'frame', at: 2 } }} playhead={0} total={2.5} readOnly={false} urlOf={() => undefined} labelOf={(p) => p} onChange={onChange} onSeek={onSeek} />,
    );
    expect(screen.getByTestId('reel-cover-status')).toHaveTextContent('segundo 2');
    fireEvent.click(screen.getByRole('button', { name: 'Ir a ese fotograma' }));
    expect(onSeek).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar la portada' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('en solo lectura no deja cambiarla', () => {
    render(
      <CoverPicker plan={plan()} playhead={0} total={2} readOnly urlOf={() => undefined} labelOf={(p) => p} onChange={vi.fn()} onSeek={vi.fn()} />,
    );
    expect(screen.queryByTestId('reel-cover-frame')).toBeNull();
    expect(screen.getByRole('radio', { name: /Portada/ })).toBeDisabled();
  });
});
