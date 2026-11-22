// «Hacer un reel como este»: el análisis sin IA del vídeo de referencia
// (`media.reel.analyze`). Cuentas puras (cortes, planos, sonido, compás) y el
// manejador entero con un vídeo real generado con FFmpeg, también desde un
// enlace servido por un servidor HTTP local de la prueba.
import { readFile, readdir } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunkSegments, loudnessEnvelope, rhythmOfCuts, soundSegments } from '../src/analyze/audio.ts';
import { downloadReference, ogVideoUrl, ReferenceDownloadError, siteName } from '../src/analyze/download.ts';
import { detectBeats } from '../src/analyze/rhythm.ts';
import { buildShots, detectCuts, parseScdet, pickFrameTimes, type FrameChange } from '../src/analyze/scenes.ts';
import { PermanentError } from '../src/errors.ts';
import type { NetPolicy } from '../src/extract/net.ts';
import { createMediaHandlers } from '../src/handlers/index.ts';
import {
  createReelAnalyzeHandler,
  REEL_ANALYZE_KIND,
  REEL_ANALYZE_LIMITS,
  reelAnalyzePayloadSchema,
} from '../src/handlers/reel-analyze.ts';
import { BRAND, createBucket, deps, makeClip, makeMusic, ORG, probe, runHandler, tools, type Bucket } from './helpers/media.ts';
import { makeReferenceReel, REFERENCE_REEL } from './helpers/reference.ts';

const LOOPBACK_ONLY: NetPolicy = { isAllowedAddress: (ip) => ip === '127.0.0.1', allowedPorts: 'any' };
const REFERENCE_ID = '44444444-4444-4444-8444-444444444444';
const DIR = `${ORG}/${BRAND}/referencias/${REFERENCE_ID}`;
const SOURCE = `${ORG}/${BRAND}/referencias/55555555-5555-4555-8555-555555555555.mp4`;

// ───────────────────────────── Cuentas puras ─────────────────────────────

/** Serie de cambios a 30 fotogramas por segundo: `level` normal y lo que diga `edit`. */
function series(seconds: number, level: number, edit: (t: number, frame: FrameChange) => void): FrameChange[] {
  const frames: FrameChange[] = [];
  for (let i = 0; i < seconds * 30; i += 1) {
    const frame = { t: Number((i / 30).toFixed(4)), mafd: i === 0 ? 0 : level, score: 0 };
    edit(frame.t, frame);
    frames.push(frame);
  }
  return frames;
}
const near = (a: number, b: number, tolerance = 0.05) => Math.abs(a - b) <= tolerance;

describe('cortes y planos (sin FFmpeg)', () => {
  it('lee la salida de scdet', () => {
    const frames = parseScdet(
      [
        'frame:0    pts:0       pts_time:0',
        'lavfi.scd.mafd=0.000',
        'lavfi.scd.score=0.000',
        'frame:1    pts:512     pts_time:0.0333333',
        'lavfi.scd.mafd=29.307',
        'lavfi.scd.score=28.666',
        'lavfi.scd.time=0.0333333',
      ].join('\r\n'),
    );
    expect(frames).toEqual([
      { t: 0, mafd: 0, score: 0 },
      { t: 0.0333333, mafd: 29.307, score: 28.666 },
    ]);
  });

  it('un corte seco es un fotograma con puntuación alta', () => {
    const frames = series(6, 0.7, (t, f) => {
      if (near(t, 2, 0.001) || near(t, 4, 0.001)) Object.assign(f, { mafd: 30, score: 29 });
    });
    const cuts = detectCuts(frames);
    expect(cuts.map((c) => [c.at, c.type])).toEqual([
      [2, 'cut'],
      [4, 'cut'],
    ]);
    const { shots, truncated } = buildShots(cuts, 6, frames, { maxShots: 30 });
    expect(truncated).toBe(false);
    expect(shots.map((s) => s.seconds)).toEqual([2, 2, 2]);
    expect(shots[0]!.transitionIn).toBeUndefined();
    expect(shots[1]!.transitionIn).toEqual({ type: 'cut', seconds: 0 });
  });

  it('una transición suave es una racha corta con mucho más cambio que el segundo anterior', () => {
    const frames = series(6, 0.7, (t, f) => {
      if (t >= 3 && t < 3.5) f.mafd = 1.6;
    });
    const cuts = detectCuts(frames);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.type).toBe('fade');
    expect(near(cuts[0]!.at, 3.25)).toBe(true);
    expect(near(cuts[0]!.seconds, 0.5)).toBe(true);
  });

  it('un plano con mucho movimiento después de un corte no es una transición', () => {
    // Plano quieto, corte seco y plano que se mueve mucho durante un segundo y medio.
    const frames = series(6, 0.1, (t, f) => {
      if (near(t, 2, 0.001)) Object.assign(f, { mafd: 30, score: 29 });
      else if (t > 2 && t < 3.5) f.mafd = 4;
      else if (near(t, 3.5, 0.001)) Object.assign(f, { mafd: 25, score: 21 });
    });
    expect(detectCuts(frames).map((c) => [c.at, c.type])).toEqual([
      [2, 'cut'],
      [3.5, 'cut'],
    ]);
  });

  it('un movimiento largo de cámara no es una transición, ni un cambio pequeño', () => {
    const pan = series(8, 0.3, (t, f) => {
      if (t >= 2 && t < 6) f.mafd = 2;
    });
    expect(detectCuts(pan)).toEqual([]);
    const blip = series(4, 0.3, (t, f) => {
      if (t >= 2 && t < 2.1) f.mafd = 1.2;
    });
    expect(detectCuts(blip)).toEqual([]);
  });

  it('dos cortes casi juntos son uno, y con demasiados se quedan los más claros', () => {
    const double = series(4, 0.5, (t, f) => {
      if (near(t, 2, 0.001)) Object.assign(f, { mafd: 20, score: 20 });
      if (near(t, 2.1, 0.001)) Object.assign(f, { mafd: 40, score: 20 });
    });
    expect(detectCuts(double).map((c) => c.at)).toEqual([2.1]);

    const many = series(10, 0.5, (t, f) => {
      const second = Math.round(t);
      if (second >= 1 && second <= 9 && near(t, second, 0.001)) Object.assign(f, { mafd: 10 + second, score: 12 });
    });
    const { shots, truncated } = buildShots(detectCuts(many), 10, many, { maxShots: 4 });
    expect(truncated).toBe(true);
    // Los tres cortes más fuertes: 7, 8 y 9 s.
    expect(shots.map((s) => s.start)).toEqual([0, 7, 8, 9]);
  });

  it('sabe si un plano es una imagen fija', () => {
    const frames = series(4, 0.8, (t, f) => {
      if (near(t, 2, 0.001)) Object.assign(f, { mafd: 30, score: 29 });
      else if (t > 2) f.mafd = 0;
    });
    const { shots } = buildShots(detectCuts(frames), 4, frames, { maxShots: 30 });
    expect(shots.map((s) => s.still)).toEqual([false, true]);
  });

  it('reparte los fotogramas: uno por plano y, si sobran, más en los largos', () => {
    const shot = (index: number, start: number, seconds: number) => ({
      index,
      start,
      end: start + seconds,
      seconds,
      motion: 1,
      still: false,
    });
    const three = [shot(0, 0, 2), shot(1, 2, 10), shot(2, 12, 1)];
    const picks = pickFrameTimes(three, 12);
    expect(picks.map((p) => p.shot)).toEqual([0, 1, 1, 1, 2]);
    expect(picks.every((p, i) => i === 0 || p.at > picks[i - 1]!.at)).toBe(true);

    const twenty = Array.from({ length: 20 }, (_, i) => shot(i, i, 1));
    const few = pickFrameTimes(twenty, 5);
    expect(few).toHaveLength(5);
    expect(few[0]!.shot).toBe(0);
    expect(few[4]!.shot).toBe(19);
  });
});

/** Un golpe corto cada `60 / bpm` segundos (la misma pista de la prueba del editor). */
function clickTrack(bpm: number, seconds: number, offset: number, rate = 22050): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * rate));
  const period = 60 / bpm;
  for (let t = offset; t < seconds; t += period) {
    const at = Math.round(t * rate);
    for (let i = 0; i < 400 && at + i < samples.length; i += 1) {
      samples[at + i] = Math.sin((2 * Math.PI * 900 * i) / rate) * Math.exp(-i / 90);
    }
  }
  for (let i = 0; i < samples.length; i += 1) samples[i] = samples[i]! + Math.sin(i * 12.9898) * 0.003;
  return samples;
}

describe('sonido y compás (sin FFmpeg)', () => {
  it('encuentra el tempo igual que el editor de reels', () => {
    const result = detectBeats(clickTrack(120, 16, 0.25), 22050);
    expect(result.bpm).toBeGreaterThan(117);
    expect(result.bpm).toBeLessThan(123);
    expect(result.confidence).toBeGreaterThan(0.25);
    const closest = (t: number) => Math.min(...result.beats.map((b) => Math.abs(b - t)));
    for (const t of [0.25, 1.25, 4.25, 9.75]) expect(closest(t)).toBeLessThan(0.05);
    expect(detectBeats(new Float32Array(22050 * 10), 22050)).toEqual({ bpm: 0, beats: [], confidence: 0 });
  });

  it('dice qué parte de los cortes cae en un golpe y cada cuántos golpes se corta', () => {
    const beats = Array.from({ length: 20 }, (_, i) => i * 0.5);
    expect(rhythmOfCuts([2, 4, 6.05], beats, 120)).toEqual({ cutsOnBeat: 1, beatsPerCut: 4 });
    expect(rhythmOfCuts([2, 3.5, 5.75], beats, 120)).toEqual({ cutsOnBeat: 0.67, beatsPerCut: 4 });
    expect(rhythmOfCuts([], beats, 120)).toEqual({ cutsOnBeat: 0, beatsPerCut: null });
  });

  it('mide el volumen por ventanas y encuentra los tramos con sonido', () => {
    const rate = 8000;
    const samples = new Float32Array(rate * 6);
    const tone = (from: number, to: number, gain: number) => {
      for (let i = Math.floor(from * rate); i < to * rate; i += 1) samples[i] = gain * Math.sin((2 * Math.PI * 300 * i) / rate);
    };
    tone(1, 2.5, 0.5);
    tone(4, 5, 0.25);
    const { energy, peak } = loudnessEnvelope(samples, rate, 0.5);
    expect(energy).toHaveLength(12);
    expect(energy[0]).toBe(0);
    expect(energy[2]).toBe(1);
    expect(energy[8]).toBeCloseTo(0.5, 1);
    expect(peak).toBeGreaterThan(0.3);

    const segments = soundSegments(samples, rate);
    expect(segments).toHaveLength(2);
    expect(near(segments[0]!.start, 1) && near(segments[0]!.end, 2.5)).toBe(true);
    expect(near(segments[1]!.start, 4) && near(segments[1]!.end, 5)).toBe(true);
    expect(soundSegments(new Float32Array(rate * 3), rate)).toEqual([]);
  });

  it('prepara trozos para transcribir sin pasar de los topes', () => {
    const limits = { maxChunkSeconds: 20, maxTotalSeconds: 120, maxChunks: 12 };
    // Frases cortas seguidas se juntan; una pista continua se parte.
    expect(chunkSegments([{ start: 1, end: 4 }, { start: 5, end: 9 }, { start: 30, end: 33 }], limits)).toEqual({
      chunks: [
        { start: 1, end: 9 },
        { start: 30, end: 33 },
      ],
      truncated: false,
    });
    const long = chunkSegments([{ start: 0, end: 170 }], limits);
    expect(long.truncated).toBe(true);
    expect(long.chunks).toHaveLength(6);
    expect(long.chunks.reduce((sum, c) => sum + (c.end - c.start), 0)).toBeCloseTo(120, 5);
    expect(long.chunks.every((c) => c.end - c.start <= 20)).toBe(true);
  });
});

// ───────────────────────────── Enlaces ─────────────────────────────

type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let routes: Record<string, Route> = {};
let server: http.Server;
let base: string;
let bucket: Bucket;
let tmp: string;
let sampleFile: string;
let sampleBytes: Buffer;

const send =
  (status: number, type: string, body: string | Buffer): Route =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };

beforeAll(async () => {
  bucket = await createBucket();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'rrss-reel-analyze-'));
  sampleFile = bucket.file(SOURCE);
  await (await import('node:fs/promises')).mkdir(path.dirname(sampleFile), { recursive: true });
  await makeReferenceReel(sampleFile, { ffmpeg: tools.ffmpeg, fontFile: deps.defaultFontFile });
  sampleBytes = await readFile(sampleFile);
  server = http.createServer((req, res) => {
    const route = routes[(req.url ?? '/').split('?')[0]!];
    if (route) return route(req, res);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('no existe');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await bucket?.cleanup();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const download = (urlPath: string, maxBytes = 50 * 1024 * 1024) =>
  downloadReference(`${base}${urlPath}`, path.join(tmp, 'bajado'), {
    policy: LOOPBACK_ONLY,
    maxBytes,
    timeoutMs: 5000,
  });

describe('bajar el vídeo de un enlace, sin trucos', () => {
  it('baja un enlace directo a un vídeo', async () => {
    routes = { '/v.mp4': send(200, 'video/mp4', sampleBytes) };
    const result = await download('/v.mp4');
    expect(result).toMatchObject({ host: '127.0.0.1', bytes: sampleBytes.length, contentType: 'video/mp4', via: 'direct' });
    expect((await probe(path.join(tmp, 'bajado'))).durationSeconds).toBeCloseTo(REFERENCE_REEL.durationSeconds, 0);
  });

  it('usa el vídeo que la página declara para compartir (og:video)', async () => {
    routes = {
      '/reel': send(
        200,
        'text/html; charset=utf-8',
        '<html><head><meta property="og:video" content="/archivos/v.mp4"></head><body>Vídeo</body></html>',
      ),
      '/archivos/v.mp4': send(200, 'video/mp4', sampleBytes),
    };
    expect(await download('/reel')).toMatchObject({ via: 'og:video', bytes: sampleBytes.length });
    expect(ogVideoUrl('<meta property="og:video:secure_url" content="https://cdn.example/v.mp4">', new URL(base))).toBe(
      'https://cdn.example/v.mp4',
    );
    expect(ogVideoUrl('<p>nada</p>', new URL(base))).toBeNull();
  });

  it('si la página no ofrece el archivo, lo dice claro y pide el archivo', async () => {
    routes = { '/p/abc': send(200, 'text/html', '<html><body><script>var player={}</script></body></html>') };
    const error = await download('/p/abc').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReferenceDownloadError);
    expect(error).toBeInstanceOf(PermanentError);
    expect((error as Error).message).toMatch(/no deja descargar este vídeo desde un enlace/);
    expect((error as Error).message).toMatch(/súbelo aquí como archivo/);
  });

  it('respeta robots.txt: si el sitio no admite descargas automáticas, no descarga', async () => {
    let served = 0;
    routes = {
      '/robots.txt': send(200, 'text/plain', 'User-agent: *\nDisallow: /'),
      '/v.mp4': (_req, res) => {
        served += 1;
        res.writeHead(200, { 'content-type': 'video/mp4' });
        res.end(sampleBytes);
      },
    };
    await expect(download('/v.mp4')).rejects.toThrow(/robots\.txt no admite descargas automáticas/);
    expect(served).toBe(0);
    // Y si el vídeo declarado está en otro sitio vedado, tampoco.
    routes = {
      '/robots.txt': send(200, 'text/plain', 'User-agent: rrss-referencias\nDisallow: /archivos/'),
      '/reel': send(200, 'text/html', '<meta property="og:video" content="/archivos/v.mp4">'),
      '/archivos/v.mp4': send(200, 'video/mp4', sampleBytes),
    };
    await expect(download('/reel')).rejects.toThrow(ReferenceDownloadError);
  });

  it('si pide sesión, no insiste; y dice el nombre de la red', async () => {
    routes = { '/privado': send(403, 'text/html', 'Inicia sesión') };
    await expect(download('/privado')).rejects.toThrow(/pide iniciar sesión o bloquea las descargas automáticas/);
    routes = { '/borrado': send(404, 'text/html', 'no') };
    await expect(download('/borrado')).rejects.toThrow(/no existe o el vídeo se ha borrado/);
    expect(siteName('www.instagram.com')).toBe('Instagram');
    expect(siteName('vm.tiktok.com')).toBe('TikTok');
    expect(siteName('youtu.be')).toBe('YouTube');
    expect(siteName('videos.example.org')).toBe('videos.example.org');
  });

  it('no baja vídeos más pesados que el tope ni abre direcciones internas', async () => {
    routes = { '/v.mp4': send(200, 'video/mp4', sampleBytes) };
    await expect(download('/v.mp4', 1000)).rejects.toThrow(/pesa más de/);
    // Con la política por defecto, una dirección local no se abre.
    await expect(
      downloadReference(`${base}/v.mp4`, path.join(tmp, 'no'), { maxBytes: 1e6, timeoutMs: 2000 }),
    ).rejects.toThrow(/no se puede abrir/);
    await expect(
      downloadReference('file:///etc/passwd', path.join(tmp, 'no'), { maxBytes: 1e6, timeoutMs: 2000 }),
    ).rejects.toThrow(ReferenceDownloadError);
  });
});

// ───────────────────────────── El trabajo entero ─────────────────────────────

interface AnalysisResult {
  reference: { id: string };
  source: { kind: string; host?: string; durationSeconds: number; width: number; height: number; fps: number; hasAudio: boolean };
  shots: Array<{ index: number; start: number; end: number; seconds: number; still: boolean; transitionIn?: { type: string; seconds: number } }>;
  frames: Array<{ path: string; at: number; shot: number; bytes: number }>;
  audio: {
    present: boolean;
    silent?: boolean;
    bpm?: number | null;
    confidence?: number;
    beats?: number[];
    energy?: number[];
    cutsOnBeat?: number;
    beatsPerCut?: number | null;
    speech: Array<{ path: string; start: number; seconds: number; bytes: number }>;
  };
  warnings: string[];
  timings: Record<string, number>;
}

const handler = createReelAnalyzeHandler({ ...deps, netPolicy: LOOPBACK_ONLY });
const analyze = (payload: unknown) => runHandler(handler, bucket, payload) as unknown as Promise<AnalysisResult>;

describe('media.reel.analyze con un vídeo real', () => {
  it('el trabajador lo atiende y su carga es estricta', () => {
    expect(createMediaHandlers(deps).map((h) => h.kind)).toContain(REEL_ANALYZE_KIND);
    const valid = { reference: { id: REFERENCE_ID }, source: { path: SOURCE }, output: { dir: DIR } };
    expect(reelAnalyzePayloadSchema.parse(valid).speech).toBe(false);
    expect(reelAnalyzePayloadSchema.safeParse({ ...valid, source: { path: SOURCE, url: 'https://a.example/v' } }).success).toBe(false);
    expect(reelAnalyzePayloadSchema.safeParse({ ...valid, keepSource: true }).success).toBe(false);
    expect(reelAnalyzePayloadSchema.safeParse({ ...valid, reference: { id: 'x' } }).success).toBe(false);
  });

  it('detecta los cortes, la duración de cada plano y el encadenado del ejemplo', async () => {
    const result = await analyze({ reference: { id: REFERENCE_ID }, source: { path: SOURCE }, speech: true, output: { dir: DIR } });

    expect(result.reference.id).toBe(REFERENCE_ID);
    expect(result.source).toMatchObject({ kind: 'upload', width: 540, height: 960, hasAudio: true });
    expect(result.source.durationSeconds).toBeCloseTo(REFERENCE_REEL.durationSeconds, 1);
    expect(result.source.fps).toBeCloseTo(30, 0);

    // Cuatro planos, con el principio y la duración de cada uno a menos de 0,1 s.
    expect(result.shots).toHaveLength(REFERENCE_REEL.shots.length);
    result.shots.forEach((shot, index) => {
      const expected = REFERENCE_REEL.shots[index]!;
      expect(Math.abs(shot.start - expected.start), `inicio del plano ${index + 1}`).toBeLessThan(0.1);
      expect(Math.abs(shot.seconds - expected.seconds), `duración del plano ${index + 1}`).toBeLessThan(0.1);
      expect(shot.still, `imagen fija en el plano ${index + 1}`).toBe(expected.still);
    });
    expect(result.shots.reduce((sum, s) => sum + s.seconds, 0)).toBeCloseTo(result.source.durationSeconds, 2);
    // Dos cortes secos y un encadenado de medio segundo.
    expect(result.shots.map((s) => s.transitionIn?.type)).toEqual([undefined, 'cut', 'cut', 'fade']);
    expect(Math.abs(result.shots[3]!.transitionIn!.seconds - REFERENCE_REEL.dissolve.seconds)).toBeLessThan(0.15);

    // Un fotograma por plano, en la carpeta privada del análisis y dentro de su plano.
    expect(result.frames).toHaveLength(4);
    for (const [index, frame] of result.frames.entries()) {
      expect(frame.path).toBe(`${DIR}/f-0${index + 1}.jpg`);
      expect(frame.shot).toBe(index);
      const shot = result.shots[index]!;
      expect(frame.at).toBeGreaterThan(shot.start);
      expect(frame.at).toBeLessThan(shot.end);
      const info = await probe(bucket.file(frame.path));
      expect(info.video).toMatchObject({ width: 288, height: 512 });
      expect(frame.bytes).toBeGreaterThan(1000);
    }

    // Sonido: 120 pulsaciones; dos de los tres cortes caen en un golpe.
    expect(result.audio.present).toBe(true);
    expect(result.audio.silent).toBe(false);
    expect(result.audio.bpm).toBeGreaterThan(115);
    expect(result.audio.bpm).toBeLessThan(125);
    expect(result.audio.cutsOnBeat).toBeCloseTo(0.67, 1);
    expect(result.audio.energy!.length).toBe(15);
    // Trozos para transcribir: sonido de verdad (AAC a 16 kHz), sin pasar de 20 s cada uno.
    expect(result.audio.speech.length).toBeGreaterThan(0);
    for (const chunk of result.audio.speech) {
      expect(chunk.path.startsWith(`${DIR}/a-`)).toBe(true);
      expect(chunk.seconds).toBeLessThanOrEqual(REEL_ANALYZE_LIMITS.speech.maxChunkSeconds);
      const info = await probe(bucket.file(chunk.path));
      expect(info.audio).toMatchObject({ codec: 'aac', sampleRate: 16000, channels: 1 });
      expect(info.video).toBeUndefined();
    }
    expect(result.warnings).toEqual([]);
    expect(Object.keys(result.timings).sort()).toEqual(['analyzeMs', 'downloadMs', 'uploadMs']);
    // El vídeo de referencia no se copia a ningún sitio: en la carpeta solo hay fotogramas y sonido.
    const files = await readdir(bucket.file(DIR));
    expect(files.every((name) => /^(f-\d\d\.jpg|a-\d\d\.m4a)$/.test(name))).toBe(true);
  }, 120_000);

  it('sin pedirlo no prepara sonido para transcribir', async () => {
    const dir = `${ORG}/${BRAND}/referencias/66666666-6666-4666-8666-666666666666`;
    const result = await analyze({ reference: { id: REFERENCE_ID }, source: { path: SOURCE }, output: { dir } });
    expect(result.audio.speech).toEqual([]);
    expect((await readdir(bucket.file(dir))).every((name) => name.endsWith('.jpg'))).toBe(true);
  }, 120_000);

  it('desde un enlace: lo baja, lo mide y no lo guarda', async () => {
    routes = { '/v.mp4': send(200, 'video/mp4', sampleBytes) };
    const dir = `${ORG}/${BRAND}/referencias/77777777-7777-4777-8777-777777777777`;
    const result = await analyze({ reference: { id: REFERENCE_ID }, source: { url: `${base}/v.mp4` }, output: { dir } });
    expect(result.source).toMatchObject({ kind: 'link', host: '127.0.0.1', via: 'direct' });
    expect(result.shots).toHaveLength(4);
    expect((await readdir(bucket.file(dir))).sort()).toEqual(['f-01.jpg', 'f-02.jpg', 'f-03.jpg', 'f-04.jpg']);
  }, 120_000);

  it('un enlace que no deja descargar falla sin reintento y con el motivo', async () => {
    routes = { '/reel/xyz': send(200, 'text/html', '<html><body>Inicia sesión para ver este reel</body></html>') };
    const error = await analyze({
      reference: { id: REFERENCE_ID },
      source: { url: `${base}/reel/xyz` },
      output: { dir: DIR },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentError);
    expect((error as Error).message).toMatch(/no deja descargar este vídeo desde un enlace/);
  });

  it('un vídeo sin sonido, uno de un solo plano y lo que no es un vídeo', async () => {
    const mute = `${ORG}/${BRAND}/referencias/88888888-8888-4888-8888-888888888888.mp4`;
    await makeClip(bucket.file(mute), { width: 360, height: 640, seconds: 3, audio: false });
    const dir = `${ORG}/${BRAND}/referencias/99999999-9999-4999-8999-999999999999`;
    const result = await analyze({ reference: { id: REFERENCE_ID }, source: { path: mute }, speech: true, output: { dir } });
    expect(result.audio).toEqual({ present: false, speech: [] });
    expect(result.shots).toHaveLength(1);
    expect(result.shots[0]).toMatchObject({ start: 0, still: false });
    expect(result.frames).toHaveLength(1);

    const song = `${ORG}/${BRAND}/referencias/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.m4a`;
    await makeMusic(bucket.file(song), 3);
    await expect(analyze({ reference: { id: REFERENCE_ID }, source: { path: song }, output: { dir } })).rejects.toThrow(
      /no es un vídeo/,
    );
  }, 120_000);

  it('no lee ni escribe fuera de la marca del trabajo', async () => {
    const other = `${ORG}/33333333-3333-4333-8333-333333333333/referencias/x`;
    await expect(
      analyze({ reference: { id: REFERENCE_ID }, source: { path: SOURCE }, output: { dir: other } }),
    ).rejects.toThrow(/no pertenece a la marca/);
    await expect(
      analyze({
        reference: { id: REFERENCE_ID },
        source: { path: `${ORG}/33333333-3333-4333-8333-333333333333/referencias/v.mp4` },
        output: { dir: DIR },
      }),
    ).rejects.toThrow(/no pertenece a la marca/);
  });
});
