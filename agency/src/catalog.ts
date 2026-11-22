// Catálogo de plantillas (agency/catalogo): cuatro juegos por sector, cada uno
// con sus plantillas de reel y de publicación, que se adaptan a una marca con
// los colores y las tipografías de su perfil.
//
//   catalogo                              lista los juegos y sus plantillas
//   cargar-catalogo <marca> <juego>       EN SECO por defecto: lee el perfil de la
//                                         marca, arma las plantillas con su tema, las
//                                         valida y las deja escritas en la carpeta de
//                                         trabajo. No guarda nada en la plataforma.
//   cargar-catalogo … --cargar            además las guarda en la marca
//   cargar-catalogo - <juego> --perfil <perfil.json>
//                                         sin red: con un perfil exportado a un archivo
//
// Las publicaciones se guardan como plantillas manuales (`deliver_design_templates`)
// y los reels con `deliver_reel_templates` (origen `catalog`). Volver a cargar el
// mismo juego actualiza las mismas plantillas (misma clave): no duplica.
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProfile, type BrandProfileData } from '../../src/features/brand/profile.ts';
import { validateTemplatesDelivery, type TemplateInput } from '../../src/features/brand/templates.ts';
import {
  describeNeeds,
  validateReelTemplatesDelivery,
  type ReelTemplateEntry,
} from '../../src/features/reels/reelTemplate.ts';
import {
  buildPublications,
  buildReels,
  CATALOG_SETS,
  findSet,
  themeFromProfile,
  themeOverridesSchema,
  type CatalogSet,
  type Theme,
  type ThemeOverrides,
} from '../catalogo/index.ts';
import type { SupabaseClient } from './supabase.ts';

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

export type CatalogPart = 'reels' | 'publicaciones';

/** Estilos de reel que conoce el trabajador (worker/templates): una plantilla debe montarse sobre uno de ellos. */
export function reelStyleIds(): string[] {
  const dir = fileURLToPath(new URL('../../worker/templates/', import.meta.url));
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => (JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { id: string }).id)
    .sort();
}

export interface BuiltCatalog {
  set: CatalogSet;
  theme: Theme;
  publications: { file: unknown; templates: TemplateInput[] };
  reels: { file: unknown; templates: ReelTemplateEntry[] };
}

/** Arma un juego con el tema dado y lo valida con los mismos validadores que la entrega. Lanza `CatalogError`. */
export function buildCatalog(setId: string, theme: Theme): BuiltCatalog {
  const set = findSet(setId);
  if (!set) {
    throw new CatalogError(`No existe el juego «${setId}». Los que hay: ${CATALOG_SETS.map((s) => s.id).join(', ')}.`);
  }
  const publicationsFile = buildPublications(set, theme);
  const publications = validateTemplatesDelivery(publicationsFile, { defaultSource: 'manual' });
  if (!publications.ok) {
    throw new CatalogError(
      `Las publicaciones del juego «${set.id}» no son válidas:\n${publications.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
    );
  }
  const reelsFile = buildReels(set, theme);
  const reels = validateReelTemplatesDelivery(reelsFile, reelStyleIds());
  if (!reels.ok) {
    throw new CatalogError(
      `Los reels del juego «${set.id}» no son válidos:\n${reels.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
    );
  }
  return {
    set,
    theme,
    publications: { file: publicationsFile, templates: publications.templates },
    reels: { file: reelsFile, templates: reels.templates },
  };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new CatalogError(`No puedo leer ${file} como JSON.`);
  }
}

/** Papeles del tema fijados a mano (`--tema`). */
export async function readThemeOverrides(file: string | undefined): Promise<ThemeOverrides> {
  if (!file) return {};
  const parsed = themeOverridesSchema.safeParse(await readJson(file));
  if (!parsed.success) {
    throw new CatalogError(
      `El archivo de tema no es válido: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * Perfil de marca desde un archivo: la exportación de la aplicación
 * (`{ "format": "rrss.brand-config", "profile": … }`), el `perfil.json` que
 * escribe `contexto` (`{ "data": … }`) o el perfil a secas.
 */
export async function readProfileFile(file: string): Promise<BrandProfileData> {
  const raw = (await readJson(file)) as Record<string, unknown> | null;
  const data = raw && typeof raw === 'object' ? (raw.profile ?? raw.data ?? raw) : raw;
  return parseProfile(data);
}

async function serverProfile(client: SupabaseClient, brandId: string): Promise<BrandProfileData | null> {
  const [profile] = await client.select<{ data: unknown }>(
    'brand_profiles',
    `select=data&brand_id=eq.${brandId}&status=eq.active`,
  );
  return profile ? parseProfile(profile.data) : null;
}

export interface LoadCatalogOptions {
  /** Guardar de verdad. Sin esto, la carga es en seco. */
  deliver?: boolean;
  themeFile?: string;
  /** Perfil desde un archivo en vez de leerlo de la plataforma (solo en seco). */
  profileFile?: string;
  only?: CatalogPart;
}

export interface LoadCatalogResult {
  dir: string;
  files: string[];
  catalog: BuiltCatalog;
  profileFound: boolean;
  delivered: { publications: string[]; reels: string[] } | null;
}

/**
 * Carga un juego del catálogo en una marca. En seco (por defecto) solo arma,
 * valida y escribe los archivos; con `deliver` los guarda en la plataforma.
 * `client` puede faltar si el perfil viene de un archivo.
 */
export async function loadCatalog(
  client: SupabaseClient | null,
  workDir: string,
  brandId: string | null,
  setId: string,
  options: LoadCatalogOptions = {},
): Promise<LoadCatalogResult> {
  if (options.deliver && (!client || !brandId)) {
    throw new CatalogError('Para cargar hace falta la marca: «cargar-catalogo <marca> <juego> --cargar».');
  }
  if (options.deliver && options.profileFile) {
    throw new CatalogError('Con --cargar el tema sale del perfil guardado en la plataforma: quita --perfil.');
  }
  let profile: BrandProfileData | null;
  if (options.profileFile) profile = await readProfileFile(options.profileFile);
  else if (client && brandId) profile = await serverProfile(client, brandId);
  else throw new CatalogError('Indica la marca o un perfil con --perfil <archivo>.');

  const theme = themeFromProfile(profile, await readThemeOverrides(options.themeFile));
  const catalog = buildCatalog(setId, theme);

  const dir = path.join(workDir, `catalogo-${brandId ?? 'sin-marca'}`, catalog.set.id);
  await mkdir(dir, { recursive: true });
  const write = (name: string, data: unknown) =>
    writeFile(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  const files = ['tema.json'];
  await write('tema.json', theme);
  if (options.only !== 'reels') {
    await write('publicaciones.json', catalog.publications.file);
    files.push('publicaciones.json');
  }
  if (options.only !== 'publicaciones') {
    await write('reels.json', catalog.reels.file);
    files.push('reels.json');
  }

  let delivered: LoadCatalogResult['delivered'] = null;
  if (options.deliver && client && brandId) {
    delivered = { publications: [], reels: [] };
    if (options.only !== 'reels') {
      const rows = await client.rpc<Array<{ template_key: string }>>('deliver_design_templates', {
        p_brand_id: brandId,
        p_templates: catalog.publications.templates,
      });
      delivered.publications = rows.map((row) => row.template_key);
    }
    if (options.only !== 'publicaciones') {
      const rows = await client.rpc<Array<{ template_key: string }>>('deliver_reel_templates', {
        p_brand_id: brandId,
        p_templates: catalog.reels.templates,
        p_source: 'catalog',
      });
      delivered.reels = rows.map((row) => row.template_key);
    }
  }
  return { dir, files, catalog, profileFound: profile !== null, delivered };
}

/** Lo que hay en el catálogo, para leerlo en la terminal. */
export function describeCatalog(setId?: string): string {
  const sets = setId ? CATALOG_SETS.filter((set) => set.id === setId) : CATALOG_SETS;
  if (sets.length === 0) {
    throw new CatalogError(`No existe el juego «${setId}». Los que hay: ${CATALOG_SETS.map((s) => s.id).join(', ')}.`);
  }
  const lines: string[] = [];
  for (const set of sets) {
    const built = buildCatalog(set.id, themeFromProfile(null));
    lines.push(`${set.id} — ${set.name}. ${set.forWhom}`);
    lines.push(`  Reels (${built.reels.templates.length}):`);
    for (const reel of built.reels.templates) {
      lines.push(`    ${reel.key}  «${reel.name}» · ${describeNeeds(reel.document)} · ${reel.document.purpose}`);
    }
    lines.push(`  Publicaciones (${built.publications.templates.length}):`);
    for (const post of built.publications.templates) {
      const pages = post.document.pages.length;
      lines.push(
        `    ${post.key}  «${post.name}» · ${post.format === 'carousel' ? `carrusel de ${pages} páginas` : 'publicación'}`,
      );
    }
  }
  return lines.join('\n');
}

export function describeLoad(result: LoadCatalogResult, only?: CatalogPart): string {
  const { catalog, theme } = { catalog: result.catalog, theme: result.catalog.theme };
  const lines = [
    `Juego «${catalog.set.name}» (${catalog.set.id}) con el tema de la marca:`,
    `  fondo oscuro ${theme.dark} · fondo claro ${theme.light} · acento ${theme.accent} (sobre oscuro, ${theme.accentOnDark})`,
    `  titulares «${theme.headline}» · texto «${theme.body}»`,
  ];
  if (!result.profileFound) {
    lines.push('  AVISO: la marca no tiene perfil activo (o la cuenta no lo ve): se usa el tema neutro.');
  }
  if (only !== 'publicaciones') {
    lines.push(`Reels (${catalog.reels.templates.length}): ${catalog.reels.templates.map((t) => t.key).join(', ')}.`);
  }
  if (only !== 'reels') {
    lines.push(
      `Publicaciones (${catalog.publications.templates.length}): ${catalog.publications.templates.map((t) => t.key).join(', ')}.`,
    );
  }
  lines.push(`Archivos en ${result.dir}: ${result.files.join(', ')}.`);
  if (result.delivered) {
    lines.push(
      `GUARDADAS en la marca: ${result.delivered.reels.length} de reel y ${result.delivered.publications.length} de publicación.`,
    );
  } else {
    lines.push('EN SECO: todo es válido, pero no se ha guardado nada. Para guardarlas, repite la orden con --cargar.');
  }
  return lines.join('\n');
}
