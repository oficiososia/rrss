import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCatalogWith } from '../../../../agency/catalogo/construir';
import { NEUTRAL_THEME } from '../../../../agency/catalogo/index';
import { fake } from '@/test/fakeSupabase';
import { BRAND_ID, ORG_ID } from '@/test/fixtures';
import { validateDocumentFromAnyVersion, type ContentDocument } from '../document';
import type { BrandTemplate } from './api';
import { useTemplatePreviews } from './useTemplatePreviews';

// Miniaturas de las plantillas (selector de plantillas y Marca → Plantillas): antes pintaban el
// primer logotipo del kit aunque no se viera sobre su fondo. Ahora usan la regla del editor: aquí,
// sin poder medir los logotipos (jsdom no carga imágenes), por el nombre del archivo.

const DARK = '33333333-3333-4333-8333-333333333333';
const LIGHT = '44444444-4444-4444-8444-444444444444';

function tapaDelDia(): ContentDocument {
  const built = buildCatalogWith('restaurante', { ...NEUTRAL_THEME, logo: DARK }, [
    'corte-ritmico',
    'fundido-suave',
    'pase-lateral',
  ]);
  const template = built.stories!.templates.find((t) => t.key === 'rest-historia-tapa-del-dia')!;
  const parsed = validateDocumentFromAnyVersion(template.document);
  if (!parsed.ok) throw new Error('no válida');
  return parsed.document;
}

const logo = (id: string, name: string) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/${name}`,
  thumb_path: null,
  file_name: name,
  mime_type: 'image/png',
  tags: [],
  created_at: '2026-11-18T09:00:00Z',
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const template: BrandTemplate = {
  id: 'plantilla-1',
  key: 'rest-historia-tapa-del-dia',
  name: 'Tapa del día',
  network: 'instagram',
  format: 'story',
  document: tapaDelDia(),
  analysis: null,
  source: 'manual',
};

const logoInFallback = (layers: ReturnType<ReturnType<typeof useTemplatePreviews>['fallbackOf']>['layers']) =>
  layers.find((l) => l.type === 'logo') as { assetId: string } | undefined;

describe('miniaturas de plantillas con el logotipo que se ve', () => {
  beforeEach(() => {
    fake.reset();
    fake.tables.media_assets = [logo(DARK, 'logo.png'), logo(LIGHT, 'logo-blanco.png')];
  });

  it('sobre la cabecera oscura de «Tapa del día» pinta la variante clara del kit', async () => {
    fake.tables.brand_profiles = [
      { id: 'p', brand_id: BRAND_ID, status: 'active', data: { visual: { logoAssetIds: [DARK, LIGHT] } } },
    ];
    const { result } = renderHook(() => useTemplatePreviews(BRAND_ID, [template]), { wrapper });
    await waitFor(() => expect(logoInFallback(result.current.fallbackOf(template).layers)?.assetId).toBe(LIGHT));
  });

  it('con un solo logotipo en el kit (o sin perfil) se queda el de la plantilla', async () => {
    fake.tables.brand_profiles = [
      { id: 'p', brand_id: BRAND_ID, status: 'active', data: { visual: { logoAssetIds: [DARK] } } },
    ];
    const { result } = renderHook(() => useTemplatePreviews(BRAND_ID, [template]), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(logoInFallback(result.current.fallbackOf(template).layers)?.assetId).toBe(DARK);
  });
});
