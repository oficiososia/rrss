import { describe, expect, it } from 'vitest';
import { ALL_AVAILABLE } from '@/test/fakeSupabase';
import type { IntegrationAvailability } from './api';
import { centsText, costLines, currentPeriodStart } from './aiFormat';
import { UI_INTEGRATIONS } from './catalog';
import {
  advancedGroups,
  catalogCoverageProblems,
  SERVICE_BY_ID,
  SERVICES,
  serviceStatus,
  simpleFields,
  SUMMARY,
  type ServiceCtx,
} from './services';

const ctx = (has: string[], patch: Partial<ServiceCtx> = {}, values: Record<string, string> = {}): ServiceCtx => ({
  availability: { ...ALL_AVAILABLE } as IntegrationAvailability,
  has: (k) => has.includes(k),
  value: (k) => values[k],
  lastTest: null,
  ...patch,
});

describe('tarjetas de Integraciones', () => {
  it('cada ajuste del catálogo pertenece a exactamente una tarjeta', () => {
    expect(catalogCoverageProblems()).toEqual([]);
  });

  it('lo sencillo y lo avanzado no se pisan, y juntos son todo lo que había (sin quitar ninguna capacidad)', () => {
    const shown = new Set<string>();
    for (const s of SERVICES) {
      for (const f of simpleFields(s)) shown.add(f.key);
      for (const g of advancedGroups(s)) for (const f of g.fields) shown.add(f.key);
    }
    const catalog = UI_INTEGRATIONS.flatMap((i) => i.groups.flatMap((g) => g.fields)).filter((f) => !f.hidden);
    expect([...shown].sort()).toEqual(catalog.map((f) => f.key).sort());
  });

  it('OpenAI: una sola clave a la vista; el resto, en avanzadas', () => {
    expect(simpleFields(SERVICE_BY_ID.openai).map((f) => f.key)).toEqual(['OPENAI_API_KEY']);
    const advanced = advancedGroups(SERVICE_BY_ID.openai).flatMap((g) => g.fields.map((f) => f.key));
    expect(advanced).toEqual(expect.arrayContaining(['AI_TEXT_PROVIDER', 'AI_PRICES', 'OPENAI_BASE_URL', 'AI_MEDIA_IMAGE_MODEL']));
  });

  it('el estado es una palabra: falta la clave, falta algo, sin probar, funciona, no funciona', () => {
    const openai = SERVICE_BY_ID.openai;
    expect(serviceStatus(openai, ctx([]))).toMatchObject({ word: 'Falta la clave', tone: 'warning' });
    const noText = { availability: { ...ALL_AVAILABLE, aiText: false, reelSubtitles: false } as IntegrationAvailability };
    expect(serviceStatus(openai, ctx(['OPENAI_API_KEY'], noText))).toMatchObject({
      word: 'Falta algo',
      detail: 'Falta la región, el modelo de texto y los precios.',
    });
    expect(serviceStatus(openai, ctx(['OPENAI_API_KEY']))).toMatchObject({ word: 'Sin probar', tone: 'neutral' });
    expect(serviceStatus(openai, ctx(['OPENAI_API_KEY'], { lastTest: { ok: true, message: 'bien' } }))).toMatchObject({
      word: 'Funciona',
      tone: 'success',
    });
    expect(
      serviceStatus(openai, ctx(['OPENAI_API_KEY'], { lastTest: { ok: false, message: 'OpenAI rechaza la clave (HTTP 401).' } })),
    ).toMatchObject({ word: 'No funciona', tone: 'danger', detail: 'OpenAI rechaza la clave (HTTP 401).' });
  });

  it('Falta algo dice qué, con nombres llanos', () => {
    const meta = serviceStatus(SERVICE_BY_ID.meta, ctx(['META_APP_ID']));
    expect(meta.word).toBe('Falta algo');
    expect(meta.detail).toBe(
      'Falta el secreto de la aplicación de Meta, la dirección de la aplicación y la clave de cifrado de las cuentas.',
    );
  });

  it('los servicios opcionales sin tocar no son un problema; Claude cuenta si hay otra vía (Anthropic directo)', () => {
    expect(serviceStatus(SERVICE_BY_ID.comfyui, ctx([]))).toMatchObject({ word: 'Sin configurar', tone: 'neutral' });
    expect(serviceStatus(SERVICE_BY_ID.claude, ctx([]))).toMatchObject({ word: 'Sin configurar' });
    expect(serviceStatus(SERVICE_BY_ID.claude, ctx(['ANTHROPIC_API_KEY']))).toMatchObject({ word: 'Sin probar' });
    expect(serviceStatus(SERVICE_BY_ID.fal, ctx(['FAL_KEY']))).toMatchObject({
      word: 'Falta algo',
      detail: 'Falta el permiso de procesar fuera de la UE.',
    });
    expect(
      serviceStatus(SERVICE_BY_ID.fal, ctx(['FAL_KEY'], {}, { AI_MEDIA_ALLOW_NON_EU: 'true' })),
    ).toMatchObject({ word: 'Sin probar' });
  });

  it('«Qué funciona ahora»: entre 6 y 8 funciones y cada una depende de una tarjeta que existe', () => {
    expect(SUMMARY.length).toBeGreaterThanOrEqual(6);
    expect(SUMMARY.length).toBeLessThanOrEqual(8);
    for (const item of SUMMARY) {
      expect(SERVICE_BY_ID[item.needs]).toBeDefined();
      expect(item.on(ALL_AVAILABLE as IntegrationAvailability)).toBe(true);
    }
  });
});

describe('formato del coste', () => {
  it('céntimos con decimales útiles', () => {
    expect(centsText(0.0363)).toBe('≈ 0,036 céntimos');
    expect(centsText(0.0001)).toBe('menos de 0,01 céntimos');
    expect(centsText(12.34)).toBe('≈ 12,3 céntimos');
    expect(currentPeriodStart(new Date('2026-11-22T10:00:00Z'))).toBe('2026-11-01');
  });

  it('el coste medio por operación se calcula con el coste liquidado y no mezcla proveedores', () => {
    const rows = [
      { task: 'text', purpose: 'editor.copilot', provider: 'openai', model: 'a', operations: 10, cost_micros: 4000, audio_seconds: 0 },
      { task: 'text', purpose: 'editor.copilot', provider: 'anthropic-vertex', model: 'b', operations: 10, cost_micros: 9000, audio_seconds: 0 },
      { task: 'transcription', purpose: 'reel.subtitles', provider: 'openai', model: 'c', operations: 2, cost_micros: 9000, audio_seconds: 120 },
    ] as Parameters<typeof costLines>[0];
    const openai = costLines(rows, 'openai');
    expect(openai.map((l) => l.label)).toEqual(['Órdenes del copiloto', 'Subtítulos']);
    expect(openai[0]!.centsPerUnit).toBeCloseTo(0.04, 6);
    expect(openai[1]!.centsPerUnit).toBeCloseTo(0.45, 6);
    expect(costLines(rows, 'claude')).toHaveLength(1);
  });

  it('el dictado del copiloto con el transcriptor sale con su nombre, no como subtítulos', () => {
    const rows = [
      { task: 'transcription', purpose: 'reel.subtitles', provider: 'openai', model: 'c', operations: 2, cost_micros: 9000, audio_seconds: 120 },
      { task: 'transcription', purpose: 'editor.dictation', provider: 'openai', model: 'c', operations: 30, cost_micros: 13_500, audio_seconds: 180 },
    ] as Parameters<typeof costLines>[0];
    const lines = costLines(rows, 'openai');
    expect(lines.map((l) => [l.label, l.unit])).toEqual([
      ['Subtítulos', 'minuto transcrito'],
      ['Dictado del copiloto', 'minuto transcrito'],
    ]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(2);
    expect(lines[1]!.centsPerUnit).toBeCloseTo(0.45, 6);
  });
});
