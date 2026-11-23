// Calidad de los reels en la aplicación: material sin repetir y por calidad,
// estilos por papel, puntos de interés y máscaras guardados, cierre con la marca,
// textos que no se pisan y aviso «Sin música».
import { describe, expect, it } from 'vitest';
import { emptyProfile } from '@/features/brand/profile';
import { finalizeProject } from './editor/project';
import {
  brandOutro,
  brandReelKit,
  contrastRatio,
  rankReelAssets,
  reelAssetScore,
  reelAudioNotice,
  roleTextStyle,
  savedFocalPoints,
  separateTexts,
  strongestFirst,
  subjectMasks,
  uniqueAssets,
  type RankableAsset,
} from './quality';
import { buildReelFromTemplate, validateReelTemplate } from './reelTemplate';
import { REEL_TEMPLATES } from './templates';

const asset = (id: string, patch: Partial<RankableAsset & { created_at: string }> = {}) => ({
  id,
  kind: 'image',
  storage_path: `org/marca/media/${id}.jpg`,
  file_name: `${id}.jpg`,
  mime_type: 'image/jpeg',
  duration_ms: null,
  created_at: '2026-11-20T10:00:00Z',
  ...patch,
});

describe('material del reel', () => {
  it('no repite archivos y deja primero lo mejor: resolución, nitidez y que sea una toma', () => {
    const nitida = asset('nitida', { width: 3024, height: 4032, bytes: 3_200_000 });
    const movida = asset('movida', { width: 3024, height: 4032, bytes: 380_000 });
    const pequena = asset('pequena', { width: 400, height: 300, bytes: 40_000 });
    const sinFondo = asset('sin-fondo', {
      file_name: 'Sin fondo · chuleton.png',
      mime_type: 'image/png',
      width: 3024,
      height: 4032,
      bytes: 9_000_000,
    });
    const ranked = rankReelAssets([pequena, sinFondo, movida, nitida, nitida]);
    expect(ranked.map((a) => a.id)).toEqual(['nitida', 'movida', 'pequena', 'sin-fondo']);
    expect(reelAssetScore(nitida)).toBeGreaterThan(reelAssetScore(movida));
    expect(uniqueAssets([nitida, movida, nitida]).map((a) => a.id)).toEqual(['nitida', 'movida']);
    // El gancho: la mejor de las elegidas abre el reel; el resto mantiene su orden.
    expect(strongestFirst([pequena, movida, nitida]).map((a) => a.id)).toEqual(['nitida', 'pequena', 'movida']);
  });

  it('lee el punto de interés de los recortes guardados y la máscara de «Quitar el fondo»', () => {
    const foto = 'org/marca/media/chuleton.jpg';
    const library = [
      asset('recorte', {
        folder: 'Recortes',
        provenance: { kind: 'media.image.process', focal_point: { x: 0.31, y: 0.62 }, sources: [{ path: foto }] },
      }),
      asset('mascara', {
        storage_path: 'org/marca/ediciones/sin-fondo.png',
        provenance: { kind: 'media.cutout', sources: [{ path: foto }] },
      }),
      asset('raro', { provenance: { kind: 'media.image.process', focal_point: { x: 3, y: 0 }, sources: [{ path: 'x' }] } }),
    ];
    expect(savedFocalPoints(library).get(foto)).toEqual({ x: 0.31, y: 0.62 });
    expect(savedFocalPoints(library).has('x')).toBe(false);
    expect(subjectMasks(library).get(foto)).toBe('org/marca/ediciones/sin-fondo.png');
  });
});

describe('estilos por papel', () => {
  it('titular grande, rótulo en caja y llamada en el color de la marca, siempre legibles', () => {
    const headline = roleTextStyle('headline');
    expect(headline.sizeRatio).toBeGreaterThanOrEqual(0.085);
    expect(headline.outline).not.toBeNull();
    const label = roleTextStyle('label', { dark: '#1A3355' });
    expect(label.sizeRatio).toBeGreaterThanOrEqual(0.056);
    expect(label.box).toMatchObject({ color: '#1A3355' });
    const cta = roleTextStyle('cta', { accent: '#C9A14A' });
    expect(cta.box).toMatchObject({ color: '#C9A14A', opacity: 1 });
    expect(contrastRatio(cta.color, '#C9A14A')).toBeGreaterThanOrEqual(4.5);
    // Zona segura de abajo: 400 px de 1920.
    expect(cta.marginRatio).toBeGreaterThanOrEqual(400 / 1920);
  });

  it('dos textos nunca a la vez en la misma franja: se cambian de franja o se encadenan', () => {
    const t = (id: string, start: number, end: number, position: 'top' | 'center' | 'bottom') => ({
      id,
      start,
      end,
      position,
    });
    const out = separateTexts([t('a', 2, 6, 'center'), t('b', 2, 6, 'center'), t('c', 0, 2, 'center')]);
    const clash = out.some((x, i) =>
      out.some((y, j) => i < j && x.position === y.position && Math.min(x.end, y.end) - Math.max(x.start, y.start) > 0.02),
    );
    expect(clash).toBe(false);
    expect(out.find((x) => x.id === 'b')!.position).not.toBe('center');
  });
});

describe('plantilla de reel con material repetido', () => {
  it('la misma foto no ocupa dos planos: con menos fotos distintas, menos planos', () => {
    const parsed = validateReelTemplate({
      kind: 'rrss.reel-template',
      schemaVersion: 1,
      purpose: 'Prueba',
      whenToUse: 'Prueba',
      material: '3 fotos',
      style: { id: 'corte-ritmico' },
      slots: [
        { id: 'a', label: 'A', seconds: 2 },
        { id: 'b', label: 'B', seconds: 2 },
        { id: 'c', label: 'C', seconds: 2 },
      ],
      texts: [
        { id: 'g', role: 'hook', text: 'Vaca madurada 60 días', from: 'a', position: 'center' },
        { id: 'h', role: 'detail', text: 'A la brasa', from: 'a', position: 'center' },
        { id: 'r', role: 'cta', text: 'Reserva tu mesa', from: 'c', position: 'bottom' },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const style = REEL_TEMPLATES.find((t) => t.id === 'corte-ritmico')!;
    const foto = asset('chuleton');
    const otra = asset('pulpo');
    const project = buildReelFromTemplate(parsed.template, [foto, foto, otra, foto], style, {
      colors: { accent: '#C9A14A' },
      focalPoints: new Map([[otra.storage_path, { x: 0.3, y: 0.6 }]]),
    });
    const paths = project.plan.clips.map((c) => c.path);
    expect(paths).toEqual([foto.storage_path, otra.storage_path]);
    expect(project.plan.clips[1]).toMatchObject({ focalPoint: { x: 0.3, y: 0.6 } });
    // Los dos textos del primer plano no se pisan; la llamada va en la caja del color de la marca.
    const [a, b] = project.plan.texts;
    expect(a!.position === b!.position && Math.min(a!.end, b!.end) > Math.max(a!.start, b!.start)).toBe(false);
    const cta = project.plan.texts.find((x) => x.text === 'Reserva tu mesa')!;
    expect(cta.style.box).toMatchObject({ color: '#C9A14A' });
    expect(() => finalizeProject(project)).not.toThrow();
  });
});

describe('cierre con la marca y sonido', () => {
  it('toma del perfil el acento, el usuario de Instagram, la dirección y la llamada', () => {
    const profile = emptyProfile();
    profile.visual.colors = [
      { name: 'Dorado', hex: '#c9a14a', role: 'acento' },
      { name: 'Negro', hex: '#111111', role: 'fondo' },
    ];
    profile.channels = [{ platform: 'Instagram', handle: 'restaurante', url: '' }];
    profile.business.locations = ['Calle Mayor 1, Pueblo'];
    profile.voice.callsToAction = ['Reserva tu mesa'];
    const kit = brandReelKit(profile, 'org/marca/logos/logo.png');
    expect(kit).toMatchObject({
      colors: { accent: '#C9A14A', dark: '#111111' },
      handle: '@restaurante',
      address: 'Calle Mayor 1, Pueblo',
      logoPath: 'org/marca/logos/logo.png',
      cta: 'Reserva tu mesa',
    });
    expect(brandOutro(kit)).toEqual({
      seconds: 2,
      cta: 'Reserva tu mesa',
      handle: '@restaurante',
      address: 'Calle Mayor 1, Pueblo',
      logoPath: 'org/marca/logos/logo.png',
      accent: '#C9A14A',
      accentText: '#141414',
    });
    // Sin llamada no hay cierre; sin nada más, solo la llamada.
    expect(brandOutro(brandReelKit(emptyProfile()))).toBeNull();
    expect(brandOutro(brandReelKit(emptyProfile()), 'Ven a vernos')).toEqual({ seconds: 2, cta: 'Ven a vernos' });
  });

  it('avisa «Sin música» cuando el plan no la trae', () => {
    const photo = { type: 'photo' };
    expect(reelAudioNotice({ clips: [photo] })).toEqual({
      kind: 'none',
      notice: 'Sin música: el vídeo saldrá sin sonido.',
    });
    expect(reelAudioNotice({ clips: [photo, { type: 'video', volume: 0.6 }] }).kind).toBe('clips');
    expect(reelAudioNotice({ clips: [photo], music: { path: 'x' } })).toEqual({ kind: 'music', notice: null });
  });
});

describe('cada plano cuenta algo y el ritmo sale de la plantilla', () => {
  it('saca el rótulo del nombre del archivo solo si dice algo', async () => {
    const { assetCaption, orderForSlots } = await import('./quality');
    expect(assetCaption('Alcachofa a la parrilla con oreja, guanciale y queso Idiazábal.webp')).toBe(
      'Alcachofa a la parrilla con oreja',
    );
    expect(assetCaption('carne-plato.png')).toBe('Carne plato');
    expect(assetCaption('IMG_0379.MOV')).toBeNull();
    expect(assetCaption('PXL_20261105_123456.jpg')).toBeNull();
    expect(assetCaption('Sin fondo · chuleton.png')).toBeNull();
    // Los vídeos van a los planos de ambiente; las fotos, a los de detalle.
    const v = { kind: 'video', n: 'v' };
    const f1 = { kind: 'image', n: 'f1' };
    const f2 = { kind: 'image', n: 'f2' };
    expect(orderForSlots([{ kind: 'photo' }, { shot: 'wide' }, { kind: 'any' }], [f1, f2, v]).map((a) => a.n)).toEqual([
      'f1',
      'v',
      'f2',
    ]);
  });

  it('con rótulos y cortes al pulso, cada plano lleva su texto y dura pulsos enteros', async () => {
    const { slotSecondsOnBeat } = await import('./reelTemplate');
    const parsed = validateReelTemplate({
      kind: 'rrss.reel-template',
      schemaVersion: 1,
      purpose: 'Prueba',
      whenToUse: 'Prueba',
      material: '3 fotos',
      style: { id: 'corte-ritmico' },
      slots: [
        { id: 'a', label: 'A', seconds: 1 },
        { id: 'b', label: 'B', seconds: 1.4 },
        { id: 'c', label: 'C', seconds: 1.4 },
      ],
      texts: [{ id: 'g', role: 'hook', text: 'Lo que sale de la cocina', from: 'a', position: 'center' }],
      music: { suggestion: 'Instrumental', bpm: { min: 110, max: 130 }, cutsOnBeat: true },
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const style = REEL_TEMPLATES.find((t) => t.id === 'corte-ritmico')!;
    const beat = 60 / 120;
    expect(slotSecondsOnBeat(1.4, parsed.template)).toBe(1.5);
    const project = buildReelFromTemplate(
      parsed.template,
      [asset('a', { file_name: 'Pan gallego.jpg' }), asset('b', { file_name: 'Jamón 100% bellota.jpg' }), asset('c', { file_name: 'IMG_0001.jpg' })],
      style,
      { captions: true, beatSync: true },
    );
    expect(project.plan.clips.map((c) => (c.type === 'photo' ? c.seconds / beat : 0))).toEqual([2, 3, 3]);
    // El plano 2 lleva el nombre del plato; el 3 (archivo de cámara) no se inventa nada.
    expect(project.plan.texts.map((t) => t.text)).toEqual(['Lo que sale de la cocina', 'Jamón 100% bellota']);
    expect(project.plan.texts[1]).toMatchObject({ position: 'bottom', animation: { in: 'rise', out: 'fade' } });
    // Sin pedirlo, como antes (el editor todavía no lo pide).
    const plain = buildReelFromTemplate(parsed.template, [asset('a'), asset('b'), asset('c')], style);
    expect(plain.plan.texts).toHaveLength(1);
    expect(plain.plan.clips[1]).toMatchObject({ seconds: 1.4 });
  });
});
