// Catálogo de plantillas de la agencia: recorre TODAS las plantillas de los
// cuatro juegos con varios temas y las pasa por los validadores de la
// aplicación (documento v6, análisis, plantilla de reel, plan v2 del reel), y
// comprueba la carga en seco y la carga de verdad contra el Supabase simulado.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseProfile } from '../../src/features/brand/profile.ts';
import { DOCUMENT_SCHEMA_VERSION, type Layer } from '../../src/features/content/document/index.ts';
import { finalizeProject, planTimeline } from '../../src/features/reels/editor/project.ts';
import type { SourceAsset } from '../../src/features/reels/editor/ops.ts';
import { buildReelFromTemplate, reelTemplateNeeds } from '../../src/features/reels/reelTemplate.ts';
import { CATALOG_SETS, NEUTRAL_THEME, themeFromProfile, type Theme } from '../catalogo/index.ts';
import { contrast } from '../catalogo/tema.ts';
import { buildCatalog, describeCatalog, loadCatalog, reelStyleIds } from '../src/catalog.ts';
import { run } from '../src/cli.ts';
import { createClient, type SupabaseClient } from '../src/supabase.ts';
import { AGENCY_USER, ANON_KEY, PASSWORD, startFakeSupabase, type FakeSupabase } from './fakeServer.ts';

const BRAND = '22222222-2222-4222-8222-222222222222';

// Dos marcas inventadas: una clara con un acento cálido y otra oscura con un acento que no se lee sobre el negro.
const CLARA = {
  visual: {
    colors: [
      { name: 'Gris', hex: '#3A4046', role: 'Texto' },
      { name: 'Ocre', hex: '#B5842E', role: 'Acento' },
      { name: 'Crema', hex: '#FAF7F2', role: 'Fondo' },
      { name: 'Negro', hex: '#050505', role: 'Logotipo' },
    ],
    fonts: [{ family: 'Serif De Prueba', usage: 'Todo', license: '' }],
  },
};
const OSCURA = {
  visual: {
    colors: [
      { name: 'Granate', hex: '#A00008', role: 'Principal' },
      { name: 'Tinta', hex: '#0A0A0B', role: 'Fondo' },
      { name: 'Hueso', hex: '#FAFAFA', role: 'Texto' },
      { name: 'Rojo vivo', hex: '#FF3030', role: 'Brillos' },
    ],
    fonts: [
      { family: 'Condensada De Prueba', usage: 'Titulares', license: '' },
      { family: 'Palo De Prueba', usage: 'Texto', license: '' },
    ],
  },
};

const THEMES: Array<[string, Theme]> = [
  ['neutro', themeFromProfile(null)],
  ['marca clara', themeFromProfile(parseProfile(CLARA))],
  ['marca oscura', themeFromProfile(parseProfile(OSCURA))],
];

const STYLES = Object.fromEntries(
  await Promise.all(
    ['corte-ritmico', 'fundido-suave', 'pase-lateral'].map(async (id) => [
      id,
      JSON.parse(await readFile(new URL(`../../worker/templates/${id}.json`, import.meta.url), 'utf8')),
    ]),
  ),
);

const asset = (n: number, kind: 'image' | 'video'): SourceAsset => ({
  id: `a${n}`,
  kind,
  storage_path: `org/marca/media/${kind}-${n}.${kind === 'video' ? 'mp4' : 'jpg'}`,
  file_name: `${kind}-${n}`,
  mime_type: kind === 'video' ? 'video/mp4' : 'image/jpeg',
  duration_ms: kind === 'video' ? 20_000 : null,
});

const hexes = (value: unknown): string[] => JSON.stringify(value).match(/#[0-9a-fA-F]{6}\b/g) ?? [];

describe('tema de la marca', () => {
  it('reparte los colores por papel con el orden del perfil', () => {
    const clara = themeFromProfile(parseProfile(CLARA));
    expect(clara).toMatchObject({
      accent: '#B5842E',
      dark: '#3A4046',
      light: '#FAF7F2',
      accentOnDark: '#B5842E',
      onDark: '#FAF7F2',
      onLight: '#3A4046',
      headline: 'Serif De Prueba',
      body: 'Serif De Prueba',
    });
    const oscura = themeFromProfile(parseProfile(OSCURA));
    // El granate no se lee sobre el negro: el acento sobre oscuro pasa al rojo vivo.
    expect(oscura).toMatchObject({
      accent: '#A00008',
      dark: '#0A0A0B',
      accentOnDark: '#FF3030',
      onAccent: '#FAFAFA',
      headline: 'Condensada De Prueba',
      body: 'Palo De Prueba',
    });
  });

  it('sin perfil usa el tema neutro, y un archivo de tema corrige el papel que haga falta', () => {
    expect(themeFromProfile(null)).toEqual(NEUTRAL_THEME);
    expect(themeFromProfile(parseProfile(CLARA), { dark: '#111111' }).dark).toBe('#111111');
  });

  it('los textos se leen sobre su fondo en cualquier tema', () => {
    for (const [name, theme] of THEMES) {
      expect(contrast(theme.onDark, theme.dark), name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.onLight, theme.light), name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.onAccent, theme.accent), name).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.accentOnDark, theme.dark), name).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('catálogo: todas las plantillas de los cuatro juegos', () => {
  it('hay cuatro juegos, tres de sector y uno genérico', () => {
    expect(CATALOG_SETS.map((set) => set.id)).toEqual(['restaurante', 'cocteleria', 'gimnasio', 'generico']);
  });

  for (const set of CATALOG_SETS) {
    for (const [themeName, theme] of THEMES) {
      describe(`${set.id} · ${themeName}`, () => {
        const catalog = buildCatalog(set.id, theme);
        const allowed = new Set(Object.values(theme).map((value) => value.toUpperCase()));

        it('lleva de 8 a 10 plantillas de reel y de 8 a 10 de publicación, con claves propias del juego', () => {
          for (const list of [catalog.reels.templates, catalog.publications.templates]) {
            expect(list.length).toBeGreaterThanOrEqual(8);
            expect(list.length).toBeLessThanOrEqual(10);
            expect(new Set(list.map((t) => t.key)).size).toBe(list.length);
            expect(new Set(list.map((t) => t.name)).size).toBe(list.length);
            for (const t of list) expect(t.key.startsWith(`${set.prefix}-`), t.key).toBe(true);
          }
        });

        it('los nombres son neutros: sirven a cualquier marca del sector', () => {
          const names = [...catalog.reels.templates, ...catalog.publications.templates].map((t) => t.name);
          for (const name of names) {
            expect(name, name).not.toMatch(/\b(plato|chulet|cóctel|coctel|copa|boxeo|crossfit)/i);
            expect(name.length, name).toBeLessThanOrEqual(40);
          }
        });

        it('solo usa los colores y las tipografías del tema (por papeles)', () => {
          for (const hex of [...hexes(catalog.reels.file), ...hexes(catalog.publications.file)]) {
            expect(allowed.has(hex.toUpperCase()), hex).toBe(true);
          }
          for (const template of catalog.publications.templates) {
            for (const page of template.document.pages) {
              for (const layer of page.layers) {
                if (layer.type === 'text') expect([theme.headline, theme.body]).toContain(layer.fontFamily);
              }
            }
          }
        });

        it('las publicaciones son documentos v6 válidos: capas dentro del lienzo y carruseles de 2 a 10 páginas', () => {
          for (const template of catalog.publications.templates) {
            const { document } = template;
            expect(document.schemaVersion, template.key).toBe(DOCUMENT_SCHEMA_VERSION);
            expect(document.canvas, template.key).toMatchObject({ aspectRatio: '4:5', width: 1080, height: 1350 });
            if (template.format === 'carousel') {
              expect(document.pages.length, template.key).toBeGreaterThanOrEqual(5);
              expect(document.pages.length, template.key).toBeLessThanOrEqual(10);
            } else {
              expect(document.pages, template.key).toHaveLength(1);
            }
            for (const page of document.pages) {
              expect(page.layers.length, `${template.key}/${page.id}`).toBeGreaterThan(0);
              for (const layer of page.layers as Layer[]) {
                const where = `${template.key}/${layer.id}`;
                expect(layer.x, where).toBeGreaterThanOrEqual(0);
                expect(layer.y, where).toBeGreaterThanOrEqual(0);
                expect(layer.x + layer.width, where).toBeLessThanOrEqual(1080);
                expect(layer.y + layer.height, where).toBeLessThanOrEqual(1350);
                // Las fotos son marcos vacíos (nunca un recurso que la marca no tiene) con su nombre.
                if (layer.type === 'image') {
                  expect(layer.source, where).toEqual({ kind: 'empty' });
                  expect(layer.frame, where).toBe(true);
                  expect(layer.name.trim().length, where).toBeGreaterThan(0);
                }
                if (layer.type === 'text') {
                  expect(layer.text.trim().length, where).toBeGreaterThan(0);
                  // El texto cabe en su caja con un ancho medio de letra de 0,56 del cuerpo.
                  const perLine = Math.max(1, Math.floor(layer.width / (layer.fontSize * 0.56)));
                  const lines = Math.ceil(layer.text.length / perLine);
                  expect(lines * layer.fontSize * layer.lineHeight, where).toBeLessThanOrEqual(layer.height * 1.25);
                }
              }
            }
            // El pie es una indicación (se ve en gris en el editor), no el texto que se publicaría.
            expect(document.copy.caption, template.key).toBe('');
            expect(document.copy.captionHint?.length ?? 0, template.key).toBeGreaterThan(10);
            // Para qué sirve, cuándo usarla y qué material necesita van en el resumen del análisis.
            expect(template.analysis.summary, template.key).toMatch(/Cuándo: .+ Material: /);
            expect(template.source).toBe('manual');
          }
        });

        it('los reels son plantillas válidas y montan un plan v2 válido con el mínimo y con todo el material', () => {
          for (const entry of catalog.reels.templates) {
            const template = entry.document;
            const style = STYLES[template.style.id];
            expect(style, entry.key).toBeDefined();
            const needs = reelTemplateNeeds(template);
            expect(needs.min, entry.key).toBeGreaterThanOrEqual(2);
            expect(needs.max, entry.key).toBeLessThanOrEqual(10);
            expect(needs.seconds, entry.key).toBeGreaterThanOrEqual(7);
            expect(needs.seconds, entry.key).toBeLessThanOrEqual(60);
            expect(template.music?.suggestion, entry.key).toBeTruthy();
            expect(template.cover, entry.key).toBeDefined();
            // Gancho: el primer plano lleva texto desde el principio, salvo en las de plano largo con sonido.
            const first = template.slots[0]!.id;
            expect(
              template.texts.some((t) => t.from === first && (t.offset ?? 0) <= 1),
              entry.key,
            ).toBe(true);
            // Una sola llamada, y nunca en un plano opcional (se perdería con poco material).
            const ctas = template.texts.filter((t) => t.role === 'cta');
            expect(ctas, entry.key).toHaveLength(1);
            expect(template.slots.find((s) => s.id === ctas[0]!.from)?.optional, entry.key).toBeUndefined();
            for (const text of template.texts) {
              const words = text.text.split(/\s+/).length;
              expect(words, `${entry.key}/${text.id}`).toBeLessThanOrEqual(8);
              // Fuera de lo que tapa Instagram: 14 % arriba y 35 % abajo.
              const margin = text.style?.marginRatio ?? style.text.marginRatio;
              if (text.position === 'top') expect(margin, `${entry.key}/${text.id}`).toBeGreaterThanOrEqual(0.14);
              if (text.position === 'bottom') expect(margin, `${entry.key}/${text.id}`).toBeGreaterThanOrEqual(0.35);
            }

            for (const count of [needs.min, needs.max]) {
              for (const kind of ['image', 'video'] as const) {
                const assets = Array.from({ length: count }, (_, i) => asset(i + 1, kind));
                const project = buildReelFromTemplate(template, assets, style);
                const ready = finalizeProject(project);
                expect(ready.plan.clips, `${entry.key} con ${count}`).toHaveLength(count);
                const { total } = planTimeline(ready.plan.clips, style);
                expect(total, entry.key).toBeGreaterThan(5);
                expect(total, entry.key).toBeLessThanOrEqual(90);
                expect(ready.plan.texts.length, entry.key).toBeGreaterThanOrEqual(2);
                for (const text of ready.plan.texts) {
                  expect(text.start, `${entry.key}/${text.id}`).toBeGreaterThanOrEqual(0);
                  expect(text.end, `${entry.key}/${text.id}`).toBeLessThanOrEqual(total + 0.01);
                  expect(text.end - text.start, `${entry.key}/${text.id}`).toBeGreaterThanOrEqual(0.5);
                }
                // La llamada final sigue estando aunque falte material.
                const cta = template.texts.find((t) => t.role === 'cta')!.text;
                expect(
                  ready.plan.texts.some((t) => t.text === cta),
                  `${entry.key} con ${count}`,
                ).toBe(true);
                if (ready.plan.cover?.type === 'frame') expect(ready.plan.cover.at).toBeLessThanOrEqual(total);
                // Nunca lleva música ni archivos que no sean el material elegido.
                expect(ready.plan.music).toBeUndefined();
              }
            }
          }
        });
      });
    }
  }

  it('los estilos de partida son los del trabajador', () => {
    expect(reelStyleIds()).toEqual(['corte-ritmico', 'fundido-suave', 'pase-lateral']);
  });

  it('el listado enseña cada plantilla con lo que necesita', () => {
    const text = describeCatalog('gimnasio');
    expect(text).toContain('gim-asi-no-asi-si');
    expect(text).toMatch(/«Antes y después» · 2 a 4 fotos o clips · unos/);
    expect(() => describeCatalog('panaderia')).toThrow(/No existe el juego/);
  });
});

describe('cargar un juego en una marca', () => {
  let fake: FakeSupabase;
  let client: SupabaseClient;
  let workDir: string;

  beforeAll(async () => {
    fake = await startFakeSupabase();
    client = createClient({ url: fake.url, anonKey: ANON_KEY });
    await client.signIn(AGENCY_USER.email, PASSWORD);
  });
  afterAll(async () => {
    await fake.close();
  });
  beforeEach(async () => {
    fake.seen.length = 0;
    workDir = await mkdtemp(path.join(os.tmpdir(), 'rrss-agencia-catalogo-'));
    fake.tables.brand_profiles = [{ id: 'p1', brand_id: BRAND, status: 'active', version: 3, data: OSCURA }];
    fake.rpc.deliver_design_templates = (body) => ({
      status: 200,
      body: (body.p_templates as Array<{ key: string; name: string }>).map((t) => ({
        id: t.key,
        template_key: t.key,
        name: t.name,
      })),
    });
    fake.rpc.deliver_reel_templates = (body) => ({
      status: 200,
      body: (body.p_templates as Array<{ key: string; name: string }>).map((t) => ({
        id: t.key,
        template_key: t.key,
        name: t.name,
      })),
    });
  });

  const rpcCalls = () => fake.seen.filter((s) => s.path.startsWith('/rest/v1/rpc/'));

  it('en seco (por defecto) lee el perfil, escribe los archivos y NO guarda nada', async () => {
    const result = await loadCatalog(client, workDir, BRAND, 'gimnasio');
    expect(result.delivered).toBeNull();
    expect(result.profileFound).toBe(true);
    expect(result.catalog.theme.accent).toBe('#A00008');
    expect(rpcCalls()).toEqual([]);
    expect(result.files).toEqual(['tema.json', 'publicaciones.json', 'reels.json']);
    const reels = JSON.parse(await readFile(path.join(result.dir, 'reels.json'), 'utf8'));
    expect(reels.format).toBe('rrss.agency-reel-templates');
    expect(reels.templates).toHaveLength(10);
    const posts = JSON.parse(await readFile(path.join(result.dir, 'publicaciones.json'), 'utf8'));
    expect(posts).toMatchObject({ format: 'rrss.agency-templates', source: 'manual' });
    expect(posts.templates[0].document.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION);
  });

  it('con --cargar entrega las publicaciones como manuales y los reels como catálogo', async () => {
    const result = await loadCatalog(client, workDir, BRAND, 'gimnasio', { deliver: true });
    expect(result.delivered?.reels).toHaveLength(10);
    expect(result.delivered?.publications).toHaveLength(10);
    const [posts, reels] = rpcCalls();
    expect(posts!.path).toBe('/rest/v1/rpc/deliver_design_templates');
    const sent = posts!.body as {
      p_brand_id: string;
      p_templates: Array<{ source: string; document: { schemaVersion: number } }>;
    };
    expect(sent.p_brand_id).toBe(BRAND);
    expect(
      sent.p_templates.every((t) => t.source === 'manual' && t.document.schemaVersion === DOCUMENT_SCHEMA_VERSION),
    ).toBe(true);
    expect(reels!.path).toBe('/rest/v1/rpc/deliver_reel_templates');
    expect(reels!.body).toMatchObject({ p_brand_id: BRAND, p_source: 'catalog' });
  });

  it('--solo carga una mitad, y un juego que no existe o cargar sin marca se rechazan', async () => {
    const result = await loadCatalog(client, workDir, BRAND, 'generico', { deliver: true, only: 'reels' });
    expect(result.delivered).toEqual({ publications: [], reels: expect.arrayContaining(['gen-asi-se-hace']) });
    expect(rpcCalls().map((c) => c.path)).toEqual(['/rest/v1/rpc/deliver_reel_templates']);
    await expect(loadCatalog(client, workDir, BRAND, 'panaderia')).rejects.toThrow(/No existe el juego/);
    await expect(loadCatalog(null, workDir, null, 'generico', { deliver: true })).rejects.toThrow(
      /hace falta la marca/,
    );
  });

  it('sin perfil en la plataforma avisa y usa el tema neutro', async () => {
    fake.tables.brand_profiles = [];
    const result = await loadCatalog(client, workDir, BRAND, 'restaurante');
    expect(result.profileFound).toBe(false);
    expect(result.catalog.theme).toEqual(NEUTRAL_THEME);
  });

  it('la orden «cargar-catalogo - <juego> --perfil» trabaja sin red y «catalogo» lista los juegos', async () => {
    const profile = path.join(workDir, 'perfil.json');
    await writeFile(profile, JSON.stringify({ format: 'rrss.brand-config', version: 1, profile: CLARA }));
    const tema = path.join(workDir, 'tema.json');
    await writeFile(tema, JSON.stringify({ dark: '#101010' }));
    const lines: string[] = [];
    const out = { log: (t: string) => lines.push(t), error: (t: string) => lines.push(`ERROR ${t}`) };
    const env = {
      ...process.env,
      RRSS_AGENCIA_TRABAJO: workDir,
      RRSS_AGENCIA_CREDENCIALES: path.join(workDir, 'no-existe.json'),
    };
    expect(await run(['cargar-catalogo', '-', 'restaurante', '--perfil', profile, '--tema', tema], env, out)).toBe(0);
    expect(lines.join('\n')).toMatch(/EN SECO/);
    expect(lines.join('\n')).toContain('fondo oscuro #101010');
    expect(lines.join('\n')).toContain('acento #B5842E');
    expect(rpcCalls()).toEqual([]);

    lines.length = 0;
    expect(await run(['catalogo'], env, out)).toBe(0);
    for (const id of ['restaurante', 'cocteleria', 'gimnasio', 'generico'])
      expect(lines.join('\n')).toContain(`${id} — `);

    lines.length = 0;
    expect(await run(['cargar-catalogo', '-', 'restaurante', '--perfil', profile, '--cargar'], env, out)).toBe(2);
    expect(lines.join('\n')).toMatch(/hace falta la marca/);
    expect(await run(['cargar-catalogo', '-', 'restaurante'], env, out)).toBe(2);
    expect(await run(['cargar-catalogo', BRAND], env, out)).toBe(2);
  });
});
