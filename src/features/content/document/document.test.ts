import { describe, expect, it } from 'vitest';
import {
  ASPECT_RATIOS,
  CANVAS_SIZES,
  DOCUMENT_MIGRATIONS,
  DOCUMENT_SCHEMA_VERSION,
  DocumentError,
  aspectRatioValue,
  createEmptyDocument,
  migrateDocument,
  runMigrations,
  validateDocument,
  validateDocumentFromAnyVersion,
  type ContentDocumentInput,
  type DocumentMigration,
} from './index';

const ASSET = '11111111-1111-4111-8111-111111111111';
const GENERATION = '22222222-2222-4222-8222-222222222222';

/** Documento de ejemplo con una capa de cada tipo, escrito como lo escribiría un editor o la IA. */
function sample(): ContentDocumentInput {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    canvas: { aspectRatio: '4:5', width: 1080, height: 1350, backgroundColor: '#101010' },
    layers: [
      {
        id: 'fondo',
        type: 'image',
        x: 0,
        y: 0,
        width: 1080,
        height: 1350,
        source: { kind: 'asset', assetId: ASSET },
        anchor: { x: 'stretch', y: 'stretch' },
      },
      { id: 'banda', type: 'shape', shape: 'rectangle', x: 0, y: 1100, width: 1080, height: 250, fill: '#000000' },
      {
        id: 'titular',
        type: 'text',
        x: 80,
        y: 1130,
        width: 920,
        height: 120,
        text: 'Menú de otoño',
        fontFamily: 'Inter',
        fontSize: 72,
        color: '#FFFFFF',
      },
      { id: 'logo', type: 'logo', x: 900, y: 60, width: 120, height: 120, assetId: ASSET },
    ],
    copy: { caption: 'Ya está aquí.', hashtags: ['#otoño', 'menu_del_dia'], mentions: ['@proveedor.local'] },
  };
}

const issuesOf = (input: unknown) => {
  const result = validateDocument(input);
  return result.ok ? [] : result.issues;
};

describe('lienzo', () => {
  it('cada proporción tiene un lienzo lógico que la cumple', () => {
    for (const ratio of ASPECT_RATIOS) {
      const { width, height } = CANVAS_SIZES[ratio];
      expect(width / height, ratio).toBeCloseTo(aspectRatioValue(ratio), 6);
    }
    expect(aspectRatioValue('9:16')).toBeCloseTo(0.5625, 6);
  });
});

describe('createEmptyDocument', () => {
  it('crea un documento válido, cuadrado y blanco por defecto', () => {
    const document = createEmptyDocument();
    expect(document).toEqual({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      canvas: { aspectRatio: '1:1', width: 1080, height: 1080, backgroundColor: '#FFFFFF' },
      layers: [],
      copy: { caption: '', hashtags: [], mentions: [], altText: '', callToAction: { label: '', url: '' } },
    });
    expect(validateDocument(document)).toEqual({ ok: true, document });
  });

  it('respeta la proporción y el color de fondo pedidos', () => {
    for (const ratio of ASPECT_RATIOS) {
      const { canvas } = createEmptyDocument({ aspectRatio: ratio, backgroundColor: '#112233' });
      expect(canvas).toEqual({ aspectRatio: ratio, ...CANVAS_SIZES[ratio], backgroundColor: '#112233' });
    }
  });

  it('no admite un color que no sea #RRGGBB', () => {
    expect(() => createEmptyDocument({ backgroundColor: 'rojo' })).toThrow(/#RRGGBB/);
  });
});

describe('validateDocument', () => {
  it('acepta un documento con las cuatro clases de capa y pone los valores por defecto', () => {
    const result = validateDocument(sample());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const [fondo, banda, titular, logo] = result.document.layers;

    expect(fondo).toMatchObject({
      type: 'image',
      fit: 'cover',
      focus: { x: 0.5, y: 0.5 },
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      name: '',
    });
    expect(banda).toMatchObject({ type: 'shape', stroke: null, cornerRadius: 0, anchor: { x: 'center', y: 'center' } });
    expect(titular).toMatchObject({ type: 'text', fontWeight: 400, italic: false, align: 'left', lineHeight: 1.2 });
    expect(logo).toMatchObject({ type: 'logo', assetId: ASSET });
    // El orden de las capas es el orden de apilado y se conserva.
    expect(result.document.layers.map((l) => l.id)).toEqual(['fondo', 'banda', 'titular', 'logo']);
  });

  it('una imagen puede venir de la biblioteca o de una generación, nunca incrustada', () => {
    const withSource = (source: unknown) => {
      const document = sample();
      (document.layers![0] as { source: unknown }).source = source;
      return issuesOf(document);
    };
    expect(withSource({ kind: 'generation', generationId: GENERATION })).toEqual([]);
    expect(withSource({ kind: 'asset', assetId: 'no-es-uuid' })).not.toEqual([]);
    expect(withSource({ kind: 'url', url: 'https://x.test/a.jpg' })).not.toEqual([]);
    expect(withSource('data:image/png;base64,AAAA')).not.toEqual([]);
  });

  it('normaliza hashtags y menciones: sin almohadilla ni arroba', () => {
    const result = validateDocument(sample());
    if (!result.ok) throw new Error('inválido');
    expect(result.document.copy.hashtags).toEqual(['otoño', 'menu_del_dia']);
    expect(result.document.copy.mentions).toEqual(['proveedor.local']);
  });

  it('rechaza hashtags y menciones mal formados, y enlaces que no son http', () => {
    const withCopy = (copy: ContentDocumentInput['copy']) => issuesOf({ ...sample(), copy });
    expect(withCopy({ hashtags: ['dos palabras'] })[0]).toMatchObject({ path: 'copy.hashtags.0' });
    expect(withCopy({ hashtags: ['#'] })[0]).toMatchObject({ path: 'copy.hashtags.0' });
    expect(withCopy({ mentions: ['con espacio'] })[0]).toMatchObject({ path: 'copy.mentions.0' });
    expect(withCopy({ callToAction: { label: 'Reserva', url: 'javascript:alert(1)' } })[0]).toMatchObject({
      path: 'copy.callToAction.url',
    });
    expect(withCopy({ callToAction: { label: 'Reserva', url: 'https://x.test/reservas' } })).toEqual([]);
    expect(withCopy({ callToAction: { label: 'Reserva' } })).toEqual([]);
  });

  it('dice qué falla y dónde', () => {
    const document = sample();
    (document.layers![2] as { fontSize: number }).fontSize = 0;
    (document.layers![3] as { opacity: number }).opacity = 1.5;
    expect(issuesOf(document).map((issue) => issue.path)).toEqual(['layers.2.fontSize', 'layers.3.opacity']);
  });

  it('rechaza capas de un tipo desconocido, sin tamaño o con identificador repetido', () => {
    const base = sample();
    expect(issuesOf({ ...base, layers: [{ id: 'v', type: 'video', x: 0, y: 0, width: 1, height: 1 }] })[0]?.path).toBe(
      'layers.0.type',
    );
    expect(
      issuesOf({ ...base, layers: [{ id: 'a', type: 'logo', x: 0, y: 0, width: 0, height: 10, assetId: ASSET }] })[0]
        ?.path,
    ).toBe('layers.0.width');
    const repeated = { id: 'a', type: 'logo', x: 0, y: 0, width: 10, height: 10, assetId: ASSET };
    expect(issuesOf({ ...base, layers: [repeated, repeated] })).toEqual([
      { path: 'layers.1.id', message: 'Hay dos capas con el mismo identificador' },
    ]);
  });

  it('rechaza un lienzo cuyo tamaño no corresponde a su proporción, o una proporción que no existe', () => {
    const base = sample();
    expect(issuesOf({ ...base, canvas: { aspectRatio: '1:1', width: 1080, height: 1350 } })).toEqual([
      { path: 'canvas.width', message: 'El tamaño del lienzo no corresponde a su proporción' },
    ]);
    expect(issuesOf({ ...base, canvas: { aspectRatio: '2:3', width: 1000, height: 1500 } })[0]?.path).toBe(
      'canvas.aspectRatio',
    );
    // Otro tamaño lógico con la misma proporción sí vale.
    expect(issuesOf({ ...base, layers: [], canvas: { aspectRatio: '4:5', width: 2160, height: 2700 } })).toEqual([]);
  });

  it('no migra: un documento de otra versión del esquema no es válido tal cual', () => {
    expect(issuesOf({ ...sample(), schemaVersion: DOCUMENT_SCHEMA_VERSION + 1 })[0]?.path).toBe('schemaVersion');
    expect(issuesOf(null)).not.toEqual([]);
    expect(issuesOf('texto')).not.toEqual([]);
  });
});

describe('migrar entre versiones del esquema', () => {
  // Migraciones de ejemplo, solo para probar el mecanismo: hoy el esquema
  // real tiene una única versión.
  const toV2: DocumentMigration = (d) => ({ ...d, pie: d.texto, texto: undefined });
  const toV3: DocumentMigration = (d) => ({ ...d, etiquetas: [] });

  it('aplica en orden las migraciones que faltan y deja la versión de destino', () => {
    const v1 = { schemaVersion: 1, texto: 'hola' };
    expect(runMigrations(v1, 3, { 1: toV2, 2: toV3 })).toEqual({
      schemaVersion: 3,
      pie: 'hola',
      texto: undefined,
      etiquetas: [],
    });
    expect(runMigrations({ schemaVersion: 2, pie: 'x' }, 3, { 1: toV2, 2: toV3 })).toEqual({
      schemaVersion: 3,
      pie: 'x',
      etiquetas: [],
    });
    // No toca el original.
    expect(v1).toEqual({ schemaVersion: 1, texto: 'hola' });
  });

  it('un documento ya en la versión de destino se devuelve igual, en una copia', () => {
    const v1 = { schemaVersion: 1, a: { b: 1 } };
    const result = runMigrations(v1, 1, {});
    expect(result).toEqual(v1);
    expect(result).not.toBe(v1);
    expect(result.a).not.toBe(v1.a);
  });

  const reasonOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof DocumentError) return error.reason;
      throw error;
    }
    return 'sin error';
  };

  it('distingue por qué no se puede leer un documento', () => {
    expect(reasonOf(() => runMigrations(null))).toBe('not_a_document');
    expect(reasonOf(() => runMigrations([]))).toBe('not_a_document');
    expect(reasonOf(() => runMigrations({ canvas: {} }))).toBe('not_a_document');
    expect(reasonOf(() => runMigrations({ schemaVersion: '1' }))).toBe('not_a_document');
    expect(reasonOf(() => runMigrations({ schemaVersion: 0 }))).toBe('not_a_document');
    expect(reasonOf(() => runMigrations({ schemaVersion: DOCUMENT_SCHEMA_VERSION + 1 }))).toBe('newer_version');
    expect(reasonOf(() => runMigrations({ schemaVersion: 1 }, 3, { 1: toV2 }))).toBe('missing_migration');
  });

  it('hay una migración por cada versión anterior a la actual', () => {
    for (let version = 1; version < DOCUMENT_SCHEMA_VERSION; version += 1) {
      expect(DOCUMENT_MIGRATIONS[version], `falta la migración de la versión ${version}`).toBeTypeOf('function');
    }
  });

  it('migrateDocument devuelve el documento actual validado y normalizado', () => {
    const document = migrateDocument(sample());
    expect(document.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION);
    expect(document.copy.hashtags).toEqual(['otoño', 'menu_del_dia']);
    // Lo ya normalizado se lee igual: guardar y volver a abrir no cambia nada.
    expect(migrateDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('migrateDocument falla con los problemas concretos si el documento no cumple el esquema', () => {
    let error: unknown;
    try {
      migrateDocument({ schemaVersion: 1, canvas: { aspectRatio: '1:1', width: 10, height: 10 }, layers: [{}] });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DocumentError);
    expect((error as DocumentError).reason).toBe('invalid');
    expect((error as DocumentError).issues[0]?.path).toBe('layers.0.type');
    expect((error as DocumentError).message).toBe('El documento no es válido.');
    expect(reasonOf(() => migrateDocument({ schemaVersion: 99 }))).toBe('newer_version');
  });
});

describe('versión 2: grupos de capas', () => {
  /** Un documento tal y como lo guardaba la versión 1 de la aplicación (sin grupos). */
  const savedV1 = () => ({ ...sample(), schemaVersion: 1 });

  it('un documento guardado con la versión 1 se lee igual, sin grupos', () => {
    const document = migrateDocument(savedV1());
    expect(document.schemaVersion).toBe(2);
    expect(document.layers).toHaveLength(sample().layers!.length);
    expect(document.layers.every((layer) => layer.groupId === undefined)).toBe(true);
    // Lo demás no cambia: mismo resultado que validar el de la versión actual.
    const current = validateDocument({ ...sample(), schemaVersion: DOCUMENT_SCHEMA_VERSION });
    expect(current.ok && current.document).toEqual(document);
  });

  it('la migración 1 → 2 no agrupa nada que no estuviera agrupado y no toca el original', () => {
    const raw = savedV1() as Record<string, unknown> & { layers: Record<string, unknown>[] };
    raw.layers[0] = { ...raw.layers[0], groupId: 'colado' };
    const migrated = runMigrations(raw) as { layers: Record<string, unknown>[] };
    expect(migrated.layers[0]).not.toHaveProperty('groupId');
    expect(raw.layers[0]).toHaveProperty('groupId', 'colado');
  });

  it('acepta capas con grupo y rechaza un identificador de grupo mal formado', () => {
    const layers = sample().layers!.map((layer) => ({ ...layer, groupId: 'g1' }));
    const ok = validateDocument({ ...sample(), layers });
    expect(ok.ok && ok.document.layers.every((layer) => layer.groupId === 'g1')).toBe(true);
    const bad = validateDocument({ ...sample(), layers: [{ ...layers[0]!, groupId: 'con espacio' }] });
    expect(bad.ok).toBe(false);
  });

  it('validateDocumentFromAnyVersion migra lo antiguo y dice por qué no puede con lo más nuevo', () => {
    expect(validateDocumentFromAnyVersion(savedV1()).ok).toBe(true);
    const newer = validateDocumentFromAnyVersion({ ...sample(), schemaVersion: DOCUMENT_SCHEMA_VERSION + 1 });
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.issues[0]?.path).toBe('schemaVersion');
  });
});
