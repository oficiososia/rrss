// Guardado con retoques fuera del hilo principal: mismo resultado en el worker y en el hilo principal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pixels } from '../pixels';
import { portraitBlur } from './blur';
import { applyStrokes, withAlpha, type BrushStroke } from './brush';
import { computeRetouch, renderRetouch, type RetouchJob, type RetouchMessage } from './retouch';

const W = 60;
const H = 40;
const image: Pixels = (() => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) data.set([(i * 5) & 255, 90, (i * 3) & 255, 255], i * 4);
  return { data, width: W, height: H };
})();
const baseAlpha = (() => {
  const a = new Uint8Array(W * H);
  for (let y = 10; y < 30; y += 1) a.fill(255, y * W + 15, y * W + 45);
  return a;
})();
const strokes: BrushStroke[] = [
  {
    mode: 'add',
    radius: 0.1,
    points: [
      [0.1, 0.1],
      [0.2, 0.15],
    ],
  },
  { mode: 'remove', radius: 0.08, points: [[0.5, 0.5]] },
];
const portraitJob = (): RetouchJob => ({
  kind: 'portrait',
  image,
  baseAlpha,
  strokes,
  options: { amount: 50, progressive: true, dim: 20 },
});

afterEach(() => vi.unstubAllGlobals());

describe('computeRetouch', () => {
  it('«subject» es la foto con la selección retocada y «portrait» el modo retrato con esa selección', () => {
    const alpha = applyStrokes(baseAlpha, W, H, strokes);
    expect(Array.from(computeRetouch({ kind: 'subject', image, baseAlpha, strokes }).data)).toEqual(
      Array.from(withAlpha(image, alpha).data),
    );
    const job = portraitJob();
    if (job.kind !== 'portrait') throw new Error();
    expect(Array.from(computeRetouch(job).data)).toEqual(Array.from(portraitBlur(image, alpha, job.options).data));
  });
});

describe('renderRetouch', () => {
  it('sin Workers calcula en el hilo principal y no toca lo que recibe', async () => {
    vi.stubGlobal('Worker', undefined);
    const before = Array.from(image.data);
    const out = await renderRetouch(portraitJob());
    expect(Array.from(out.data)).toEqual(Array.from(computeRetouch(portraitJob()).data));
    expect(Array.from(image.data)).toEqual(before);
  });

  it('con Worker manda una COPIA de la foto (la original sigue entera) y devuelve lo que calcula', async () => {
    const posted: RetouchMessage[] = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: RetouchMessage, transfer: Transferable[]) {
        posted.push(message);
        expect(transfer).toEqual([message.job.image.data.buffer]);
        const pixels = computeRetouch(message.job);
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true, pixels } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const out = await renderRetouch(portraitJob());
    expect(posted).toHaveLength(1);
    expect(posted[0]!.job.image.data).not.toBe(image.data);
    expect(image.data.byteLength).toBe(W * H * 4); // no se ha cedido la original
    expect(Array.from(out.data)).toEqual(Array.from(computeRetouch(portraitJob()).data));
  });

  it('si el worker falla, se calcula en el hilo principal', async () => {
    class BrokenWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: RetouchMessage) {
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: message.id, ok: false, message: 'sin memoria' } } as MessageEvent),
        );
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const out = await renderRetouch({ kind: 'subject', image, baseAlpha, strokes });
    expect(out.width).toBe(W);
  });
});
