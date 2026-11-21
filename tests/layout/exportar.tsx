import { contentDocumentSchema, pageView, type ContentDocument } from '@/features/content/document';
import { renderDocument } from '@/features/content/editor/canvas/exporter';
import { describeDocument } from '@/features/content/editor/canvas/nodes';
import { Scene } from '@/features/content/editor/canvas/scene';

// Banco de pruebas: dibuja una escena en el lienzo del editor (Scene) y la exporta con el
// exportador real (renderDocument), y compara los píxeles. Lo usa exportar-pixeles.spec.ts.

const SIDE = 600;
const ID = {
  foto: '11111111-1111-4111-8111-111111111111',
  fotoB: '22222222-2222-4222-8222-222222222222',
};

/** Una «foto» sintética: degradado, franjas y figuras (con detalle en las cuatro esquinas, para ver giros y recortes). */
function makePhoto(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, '#d9482b');
  g.addColorStop(0.5, '#e8c547');
  g.addColorStop(1, '#2b7bd9');
  c.fillStyle = g;
  c.fillRect(0, 0, width, height);
  c.fillStyle = '#111827';
  c.fillRect(0, 0, width * 0.25, height * 0.2);
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(width * 0.72, height * 0.65, height * 0.22, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#16a34a';
  c.fillRect(width * 0.05, height * 0.7, width * 0.3, height * 0.25);
  return canvas.toDataURL('image/png');
}

const base = {
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  anchor: { x: 'center', y: 'center' },
} as const;

type Box = [number, number, number, number];

const image = (id: string, assetId: string, box: Box, extra: object = {}) => ({
  ...base,
  id,
  type: 'image',
  name: '',
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
  source: { kind: 'asset', assetId },
  ...extra,
});

const text = (id: string, value: string, box: Box, extra: object = {}) => ({
  ...base,
  id,
  type: 'text',
  name: '',
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
  text: value,
  fontFamily: 'Arial',
  fontSize: 44,
  fontWeight: 700,
  italic: false,
  color: '#111827',
  align: 'center',
  lineHeight: 1.2,
  ...extra,
});

const rect = (id: string, box: Box, fill: string, extra: object = {}) => ({
  ...base,
  id,
  type: 'shape',
  name: '',
  x: box[0],
  y: box[1],
  width: box[2],
  height: box[3],
  shape: 'rectangle',
  fill,
  stroke: null,
  cornerRadius: 0,
  ...extra,
});

const SCENES: Record<string, unknown[]> = {
  basica: [
    rect('f', [0, 0, SIDE, SIDE], '#F3E9D2'),
    image('i', ID.foto, [40, 40, 520, 340]),
    text('t', 'Chuletón de vaca madurada', [40, 420, 520, 120]),
  ],
  ediciones: [
    rect('f', [0, 0, SIDE, SIDE], '#F3E9D2'),
    // Filtro, luz y color
    image('a', ID.foto, [20, 20, 180, 120], {
      adjust: { brightness: 20, contrast: 15, saturation: -30, temperature: 25, sharpness: 0, filter: 'sepia' },
    }),
    // Recorte + giro + volteo + enderezado
    image('b', ID.foto, [220, 20, 160, 160], {
      crop: { x: 0.1, y: 0.1, width: 0.6, height: 0.7 },
      turn: 90,
      flipX: true,
      straighten: 6,
    }),
    // Fondo en degradado y sombra de la foto
    image('c', ID.fotoB, [400, 20, 180, 140], {
      fit: 'contain',
      backdrop: { kind: 'gradient', from: '#1e3a8a', to: '#f59e0b', angle: 90 },
      shadow: { color: '#000000', blur: 12, offsetX: 6, offsetY: 6, opacity: 0.5 },
    }),
    // Fondo desenfocado con la propia foto
    image('d', ID.fotoB, [20, 200, 200, 130], { fit: 'contain', backdrop: { kind: 'blur', blur: 60 } }),
    // Fondo de color
    image('e', ID.foto, [240, 200, 160, 130], { fit: 'contain', backdrop: { kind: 'color', color: '#064e3b' } }),
    // Texto con contorno, sombra y fondo
    text('t1', 'Plato del día', [20, 360, 340, 70], {
      color: '#FFFFFF',
      outline: { color: '#1F2937', width: 3 },
      shadow: { color: '#000000', blur: 6, offsetX: 3, offsetY: 3, opacity: 0.6 },
    }),
    text('t2', 'Solo hoy', [380, 360, 200, 70], {
      fontSize: 36,
      color: '#FFFFFF',
      background: { color: '#B91C1C', opacity: 1, padding: 12, radius: 10 },
    }),
    // Forma con sombra y una figura
    rect('s', [40, 470, 220, 90], '#2563EB', {
      cornerRadius: 16,
      shadow: { color: '#000000', blur: 10, offsetX: 4, offsetY: 6, opacity: 0.5 },
    }),
    { ...rect('s2', [320, 470, 200, 90], '#F59E0B'), shape: 'star' },
  ],
  falla: [rect('f', [0, 0, SIDE, SIDE], '#F3E9D2'), image('i', ID.foto, [40, 40, 520, 340])],
};

function documentFor(name: string): ContentDocument {
  return contentDocumentSchema.parse({
    schemaVersion: 5,
    canvas: { aspectRatio: '1:1', width: SIDE, height: SIDE, backgroundColor: '#FFFFFF' },
    pages: [{ id: 'p1', layers: SCENES[name] }],
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pixels(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
}

async function decode(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return canvas;
}

const api = window as unknown as Record<string, unknown>;

api.compareScene = async (name: string, format: 'png' | 'jpeg', exportName = name) => {
  const doc = documentFor(name);
  const lookup = new Map<string, string>([
    [ID.foto, makePhoto(900, 600)],
    [ID.fotoB, makePhoto(500, 700)],
  ]);
  const page = pageView(doc, 0);
  const host = document.getElementById('stage') as HTMLDivElement;
  const scene = new Scene(host, { onSelect() {}, onSelectMany() {}, onChange() {}, onEditText() {} });
  scene.render({
    nodes: describeDocument(page, lookup, false),
    canvas: doc.canvas,
    selectedIds: [],
    editingId: null,
    safeZone: null,
    readOnly: false,
    scale: 1,
  });
  // Las imágenes del editor llegan después: se espera a que el dibujo se estabilice.
  let last = '';
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const now = scene.snapshot(1).toDataURL();
    if (now === last && i > 3) break;
    last = now;
  }
  const editor = scene.snapshot(1);
  const rendered = await renderDocument(pageView(documentFor(exportName), 0), lookup, {
    format,
    quality: 1,
    pixelRatio: 1,
  });
  const exported = await decode(rendered.blob);
  scene.destroy();

  const a = pixels(editor);
  const b = pixels(exported);
  let sum = 0;
  let bad = 0;
  let ink = 0;
  const total = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < total; i += 4) {
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(a.data[i + k]! - b.data[i + k]!);
      sum += d;
      if (d > worst) worst = d;
    }
    if (worst > 40) bad++;
    if (Math.abs(b.data[i]! - 255) + Math.abs(b.data[i + 1]! - 255) + Math.abs(b.data[i + 2]! - 255) > 30) ink++;
  }
  const count = total / 4;
  return {
    width: editor.width,
    height: editor.height,
    exportedWidth: exported.width,
    exportedHeight: exported.height,
    meanDiff: sum / (count * 3),
    badShare: bad / count,
    inkShare: ink / count,
    mime: rendered.blob.type,
  };
};

api.exportError = async (name: string) => {
  const doc = documentFor(name);
  const lookup = new Map<string, string>([[ID.foto, 'data:image/png;base64,AAAA']]);
  try {
    await renderDocument(pageView(doc, 0), lookup, { format: 'png', quality: 1, pixelRatio: 1 });
    return null;
  } catch (error) {
    return { name: (error as Error).name, code: (error as { code?: string }).code, message: (error as Error).message };
  }
};
api.ready = true;
