import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { REEL_TEMPLATES } from '../templates';
import { createClock } from './clock';
import { addClip, addText } from './ops';
import { emptyProject, planTimeline, templateTextStyle } from './project';
import { LONG_PRESS_MS, textRows, Timeline, type TimelineProps } from './Timeline';
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
    clock: createClock(0),
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
  it('las asas de recorte salen en lo elegido, se alcanzan con el tabulador y se mueven con las flechas (Mayús = 1 s)', () => {
    // Sin nada elegido no hay asas: no estorban al desplazar ni a los botones de transición.
    const none = setup();
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    expect(none.onTrimClip).not.toHaveBeenCalled();
    cleanup();
    const props = setup({ selection: { kind: 'clip', id: 'c2' } });
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
    cleanup();
    const photo = setup({ selection: { kind: 'clip', id: 'c1' } });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Duración de la foto 1' }), { key: 'ArrowRight' });
    expect(photo.onTrimClip).toHaveBeenLastCalledWith('c1', 'end', 2.6, 'kbd:c1:end');
    // Los textos también.
    cleanup();
    const text = setup({ selection: { kind: 'text', id: 't1' } });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Cuándo sale el texto 1' }), { key: 'ArrowLeft' });
    expect(text.onTrimText).toHaveBeenLastCalledWith('t1', 'end', 2.4, 'kbd:t1:end');
  });

  it('en solo lectura las flechas no cambian nada', () => {
    const props = setup({ readOnly: true, selection: { kind: 'clip', id: 'c2' } });
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

describe('la línea de tiempo como en los editores de móvil', () => {
  it('el cabezal está fijo en el centro: desplazar la línea mueve el cabezal, y el cabezal desplaza la línea', () => {
    const clock = createClock(0);
    const props = setup({ clock });
    const scroller = screen.getByTestId('reel-timeline');
    // El usuario desplaza 120 px a 60 px por segundo: el cabezal va al segundo 2.
    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(props.onSeek).toHaveBeenLastCalledWith(2);
    // Al reproducir, el reloj avanza y la línea se desliza sola (sin volver a pedir el salto).
    (props.onSeek as ReturnType<typeof vi.fn>).mockClear();
    act(() => clock.set(3));
    expect(scroller.scrollLeft).toBe(180);
    fireEvent.scroll(scroller);
    expect(props.onSeek).not.toHaveBeenCalled();
  });

  it('un toque en la regla lleva el cabezal a ese segundo', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('reel-ruler'), { clientX: 150 });
    expect(props.onSeek).toHaveBeenLastCalledWith(2.5);
  });

  it('amplía con Ctrl + rueda y con el pellizco de dos dedos; la rueda sola desplaza', () => {
    const onZoom = vi.fn();
    setup({ onZoom });
    const scroller = screen.getByTestId('reel-timeline');
    fireEvent.wheel(scroller, { deltaY: -200, ctrlKey: true });
    expect(onZoom.mock.calls[0]![0]).toBeGreaterThan(60);
    fireEvent.wheel(scroller, { deltaY: 200, ctrlKey: true });
    expect(onZoom.mock.calls[1]![0]).toBeLessThan(60);
    onZoom.mockClear();
    fireEvent.wheel(scroller, { deltaY: 90 });
    expect(onZoom).not.toHaveBeenCalled();
    expect(scroller.scrollLeft).toBe(90);
    // Pellizco: los dedos pasan de 100 px a 200 px de separación → el doble de zoom.
    const touch = (x: number) => ({ clientX: x, clientY: 10 });
    fireEvent.touchStart(scroller, { touches: [touch(100), touch(200)] });
    fireEvent.touchMove(scroller, { touches: [touch(50), touch(250)] });
    expect(onZoom).toHaveBeenLastCalledWith(120);
    fireEvent.touchEnd(scroller, { touches: [] });
  });

  it('tocar el fondo de una pista suelta lo elegido; entre dos clips hay un botón para su transición', () => {
    const props = setup({ selection: { kind: 'clip', id: 'c1' } });
    fireEvent.click(screen.getByRole('group', { name: 'Vídeo y fotos' }));
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
    const transitions = screen.getAllByTestId('reel-transition');
    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toHaveAccessibleName('Transición entre 1 y 2: fundido');
    fireEvent.click(transitions[1]!);
    expect(props.onSelect).toHaveBeenLastCalledWith({ kind: 'transition', id: 'c3' });
  });

  it('cada elemento lleva su tira de miniaturas, y los textos que se solapan van en filas distintas', () => {
    setup({ thumbOf: () => 'https://ejemplo.test/mini.jpg', urlOf: () => 'https://ejemplo.test/archivo' });
    expect(screen.getAllByTestId('reel-strip')).toHaveLength(3);
    expect(textRows([{ start: 0, end: 2 }, { start: 1, end: 3 }, { start: 2.5, end: 4 }])).toEqual({
      rows: [0, 1, 0],
      count: 2,
    });
    // Nunca más de tres filas: el cuarto solapado comparte la que antes queda libre.
    const many = textRows([0, 0, 0, 0].map((_, i) => ({ start: 0, end: 2 + i })));
    expect(many.count).toBe(3);
    expect(many.rows).toEqual([0, 1, 2, 0]);
  });

  it('las pistas vacías ofrecen lo que se puede añadir, y al final de la principal hay un «+»', () => {
    let project = addClip(emptyProject(fundido), asset('a.jpg', 'image'), fundido);
    project = { ...project };
    const onAddText = vi.fn();
    const onAddMusic = vi.fn();
    const onAddMedia = vi.fn();
    setup({ plan: project.plan, timeline: planTimeline(project.plan.clips, fundido), onAddText, onAddMusic, onAddMedia });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir texto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Añadir música' }));
    fireEvent.click(screen.getByTestId('reel-add-end'));
    expect([onAddText, onAddMusic, onAddMedia].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('un clip a otra velocidad lo dice en su etiqueta y se recorta en segundos del archivo', () => {
    let project = addClip(emptyProject(fundido), asset('b.mp4', 'video', 10_000), fundido);
    project = { ...project, plan: { ...project.plan, clips: [{ ...project.plan.clips[0]!, speed: 2 } as never] } };
    const props = setup({
      plan: project.plan,
      timeline: planTimeline(project.plan.clips, fundido, () => 10),
      selection: { kind: 'clip', id: 'c1' },
    });
    expect(screen.getByTestId('reel-clip-speed-badge')).toHaveTextContent('2×');
    // 60 px a 60 px/s = 1 s de pantalla = 2 s de archivo.
    const handle = screen.getByTestId('reel-handle-end');
    fireEvent.pointerDown(handle, { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 40 });
    fireEvent.pointerUp(window, { clientX: 40 });
    expect(props.onTrimClip).toHaveBeenLastCalledWith('c1', 'end', 2, expect.any(String));
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
