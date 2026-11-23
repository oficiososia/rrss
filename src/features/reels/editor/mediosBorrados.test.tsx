import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ContentVersionRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { REEL_TEMPLATES } from '../templates';
import { missingItems, missingSummary, replaceClipAndCover } from './missing';
import type { ReelProject } from './project';

// Un reel que usa una foto o un vídeo que después se borró de la biblioteca (el caso del
// reel «Reel nuevo» de staging, 23/11/2026): se marca en la línea de tiempo y en la vista
// previa, se avisa arriba, «Montar el vídeo» no se encarga y lleva a lo que falta, y
// «Sustituir» conserva duración, movimiento, filtro y textos.

const EDITOR = `${BRAND_BASE}/contenidos/reel-1`;
const path = (name: string) => `${ORG_ID}/${BRAND_ID}/media/${name}`;
const BORRADA = path('1b0334e5-f180-4d14-a642-a8ce24fed92e-fondo-nuevo-chuleton.jpg');

beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerType = 'mouse';
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const asset = (id: string, kind: string, fileName: string, mime: string, durationMs: number | null = null) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind,
  origin: 'upload',
  storage_path: path(fileName),
  file_name: fileName,
  mime_type: mime,
  bytes: 1000,
  width: null,
  height: null,
  duration_ms: durationMs,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: null,
  created_by: null,
  created_at: '2026-11-18T09:00:00Z',
  updated_at: '2026-11-18T09:00:00Z',
});

const STYLE = {
  sizeRatio: 0.06,
  color: '#FFFFFF',
  marginRatio: 0.2,
  maxWidthRatio: 0.84,
  lineHeight: 1.3,
  box: null,
  outline: null,
  fadeSeconds: 0.25,
};

const reel = (clips: unknown[], extra: Record<string, unknown> = {}) => ({
  kind: 'reel',
  template: { id: 'fundido-suave' },
  plan: {
    version: 2,
    clips,
    texts: [{ id: 't1', text: 'Chuletón madurado', start: 0, end: 2, position: 'top', style: STYLE }],
    ...extra,
  },
});

const MISSING_PHOTO = {
  id: 'c1',
  type: 'photo',
  path: BORRADA,
  seconds: 3,
  motion: 'zoom-in',
  motionAmount: 0.2,
  filter: 'warm',
  transition: { type: 'fade', seconds: 0.4 },
};
const LOCAL = { id: 'c2', type: 'photo', path: path('local.jpg'), seconds: 2 };

function seed(data: unknown = reel([MISSING_PHOTO, LOCAL]), options: { draft?: unknown } = {}) {
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.content_items = [
    {
      id: 'reel-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      title: 'Reel nuevo',
      network: 'instagram',
      format: 'reel',
      status: 'draft',
      current_version: 1,
      archived_at: null,
      created_by: ME.id,
      created_at: '2026-11-21T09:00:00Z',
      updated_at: '2026-11-21T09:00:00Z',
    } as ContentItemRow,
  ];
  fake.tables.content_versions = [
    {
      id: 'v-1',
      content_id: 'reel-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      schema_version: 2,
      data,
      change_note: '',
      restored_from: null,
      created_by: ME.id,
      created_at: '2026-11-21T09:00:00Z',
    } as unknown as ContentVersionRow,
  ];
  // La foto del chuletón ya no está: se borró de la biblioteca.
  fake.tables.media_assets = [
    asset('foto-2', 'image', 'local.jpg', 'image/jpeg'),
    asset('foto-3', 'image', 'plato.jpg', 'image/jpeg'),
    asset('clip-1', 'video', 'cocina.mp4', 'video/mp4', 6000),
  ];
  fake.tables.jobs = [];
  fake.tables.reel_drafts = options.draft
    ? [
        {
          content_id: 'reel-1',
          brand_id: BRAND_ID,
          organization_id: ORG_ID,
          data: options.draft,
          base_version: 1,
          updated_by: ME.id,
          updated_at: '2026-11-22T12:00:00Z',
        },
      ]
    : [];
  fake.tables.brand_fonts = [];
  fake.rpc('save_reel_draft', () => '2026-11-22T12:00:00Z');
  fake.rpc('discard_reel_draft', () => null);
  fake.rpc('brand_reel_font_info', () => []);
  fake.rpc('request_media_job', () => {
    throw new Error('no debería encargarse');
  });
}

async function open() {
  renderApp(EDITOR);
  await screen.findByTestId('reel-editor');
}

const clips = () => screen.getAllByTestId('reel-clip');
const NOTICE = '1 foto de este reel se ha borrado de la biblioteca. Sustitúyela para poder montarlo.';

describe('reel con una foto borrada de la biblioteca', () => {
  it('marca el clip en la línea de tiempo y en la vista previa, y avisa arriba en una línea', async () => {
    seed();
    await open();
    expect(await screen.findByTestId('reel-missing-notice')).toHaveTextContent(NOTICE);
    const first = clips()[0]!;
    expect(first).toHaveAttribute('data-missing', 'true');
    expect(within(first).getByTestId('reel-clip-missing')).toHaveTextContent('Falta esta foto');
    // El nombre, sin el identificador interno; y lo que pasa, para los lectores de pantalla.
    expect(within(first).getAllByRole('button')[0]).toHaveAccessibleName(
      '1. Foto fondo-nuevo-chuleton.jpg, 3 s. Falta esta foto: se ha borrado de la biblioteca',
    );
    expect(clips()[1]).not.toHaveAttribute('data-missing');
    // El cabezal está en el principio: la vista previa dice qué falta y qué hacer.
    const overlay = screen.getByTestId('reel-preview-missing');
    expect(overlay).toHaveTextContent('Falta esta foto');
    expect(within(overlay).getByTestId('reel-missing-replace')).toHaveTextContent('Sustituir');
    expect(within(overlay).getByTestId('reel-missing-remove')).toHaveTextContent('Quitar');
    // En ningún sitio sale la ruta interna.
    expect(document.body.textContent).not.toContain(`${ORG_ID}/`);
  });

  it('«Montar el vídeo» no se encarga: dice lo mismo y lleva al primero que falta', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seed();
    await open();
    await screen.findByTestId('reel-missing-notice');
    // Se elige otro y se aparta el cabezal, para ver que lleva al que falta.
    fireEvent.click(within(clips()[1]!).getAllByRole('button')[0]!);
    const render = screen.getByTestId('reel-render');
    expect(render).toBeEnabled();
    fireEvent.click(render);
    expect(await screen.findByText(NOTICE, { selector: '[data-sonner-toast] *' })).toBeInTheDocument();
    expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(0);
    expect(within(clips()[0]!).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
    // Y en «Avisos», lo mismo, lo primero.
    expect(screen.getByTestId('reel-notices-chip')).toHaveTextContent('1');
  });

  it('«Sustituir» abre la biblioteca y conserva la duración, el movimiento, el filtro, la transición y los textos', async () => {
    seed();
    await open();
    fireEvent.click(await screen.findByTestId('reel-missing-replace'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Sustituir por otra foto o clip');
    fireEvent.click(within(dialog).getByRole('button', { name: /«plato.jpg»/ }));
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));
    await waitFor(() => expect(screen.queryByTestId('reel-missing-notice')).not.toBeInTheDocument());
    expect(clips()[0]).not.toHaveAttribute('data-missing');
    expect(within(clips()[0]!).getAllByRole('button')[0]).toHaveAccessibleName('1. Foto plato.jpg, 3 s');
    expect(screen.queryByTestId('reel-preview-missing')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(1);
    // Lo que queda guardado en el borrador: el mismo clip con la foto nueva.
    await waitFor(() => expect(fake.callsTo('save_reel_draft', 'rpc').length).toBeGreaterThan(0), { timeout: 4000 });
    const saved = fake.callsTo('save_reel_draft', 'rpc').at(-1)!.payload as { p_data: ReelProject };
    expect(saved.p_data.plan.clips[0]).toEqual({ ...MISSING_PHOTO, path: path('plato.jpg') });
    expect(saved.p_data.plan.texts[0]!.text).toBe('Chuletón madurado');
  });

  it('«Quitar» lo saca del reel', async () => {
    seed();
    await open();
    fireEvent.click(await screen.findByTestId('reel-missing-remove'));
    await waitFor(() => expect(clips()).toHaveLength(1));
    expect(screen.queryByTestId('reel-missing-notice')).not.toBeInTheDocument();
  });

  it('también en el borrador automático, con un vídeo y la música', async () => {
    const draft = reel(
      [LOCAL, { id: 'c3', type: 'video', path: path('borrado.mp4'), in: 0, out: 2, volume: 0.5 }],
      {
        music: {
          path: path('borrada.m4a'),
          startAt: 0,
          volume: 0.3,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
          license: { confirmed: true },
        },
      },
    );
    seed(reel([LOCAL]), { draft });
    await open();
    expect(await screen.findByTestId('reel-missing-notice')).toHaveTextContent(
      '1 vídeo de este reel se ha borrado de la biblioteca. Sustitúyelo para poder montarlo. La música de este reel se ha borrado de la biblioteca. Cámbiala o quítala para poder montarlo.',
    );
    expect(clips()[1]).toHaveAttribute('data-missing', 'true');
    expect(within(clips()[1]!).getByTestId('reel-clip-missing')).toHaveTextContent('Falta este vídeo');
    expect(screen.getByTestId('reel-music-block')).toHaveTextContent('Falta esta música');
  });
});

describe('qué falta y el aviso (puro)', () => {
  const template = REEL_TEMPLATES[0]!;
  const project = reel([MISSING_PHOTO, LOCAL], { cover: { type: 'photo', path: BORRADA } }) as unknown as ReelProject;

  it('cuenta fotos y vídeos con la concordancia de cada caso', () => {
    const items = (paths: string[]) =>
      missingItems(
        {
          version: 2,
          texts: [],
          clips: paths.map((p, i) =>
            p.endsWith('.mp4')
              ? { id: `c${i}`, type: 'video' as const, path: p, in: 0, out: 1, volume: 1 }
              : { id: `c${i}`, type: 'photo' as const, path: p, seconds: 1 },
          ),
        },
        () => true,
      );
    expect(missingSummary(items(['a.jpg']))).toBe(NOTICE);
    expect(missingSummary(items(['a.jpg', 'b.jpg']))).toBe(
      '2 fotos de este reel se han borrado de la biblioteca. Sustitúyelas para poder montarlo.',
    );
    expect(missingSummary(items(['a.jpg', 'b.mp4']))).toBe(
      '1 foto y 1 vídeo de este reel se han borrado de la biblioteca. Sustitúyelos para poder montarlo.',
    );
    expect(missingSummary([])).toBeNull();
  });

  it('la portada que era la foto borrada pasa a la sustituta (o se quita si es un vídeo)', () => {
    // La portada es la foto que falta y además un clip: solo se cuenta el clip.
    expect(missingItems(project.plan, (p) => p === BORRADA).map((m) => m.kind)).toEqual(['clip']);
    const photo = { id: 'n', kind: 'image', storage_path: path('plato.jpg'), file_name: 'plato.jpg', mime_type: 'image/jpeg', duration_ms: null };
    expect(replaceClipAndCover(project, 'c1', photo, template).plan.cover).toEqual({
      type: 'photo',
      path: path('plato.jpg'),
    });
    const video = { id: 'v', kind: 'video', storage_path: path('cocina.mp4'), file_name: 'cocina.mp4', mime_type: 'video/mp4', duration_ms: 6000 };
    expect(replaceClipAndCover(project, 'c1', video, template).plan.cover).toBeUndefined();
  });
});
