// Capas de imagen y de logotipo que apuntan a un archivo que ya no está en la
// biblioteca (se borró después de ponerlo en la pieza). Sin arreglo, el lienzo las
// pinta como un recuadro gris y la exportación se niega («faltan imágenes»).
//
// Al abrir la pieza se convierten en un marco de foto vacío (documento v6,
// `source: { kind: 'empty' }`, `frame: true`): se ve el hueco con «Poner foto»,
// no sale en la imagen exportada y se rellena como cualquier otro marco. Conservan
// su caja, su nombre y sus efectos. Un paso de deshacer, como cualquier cambio.
import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { Notice } from '@/components/ui';
import { allLayers } from '../document/pages';
import { layerSchema, type ContentDocument, type Layer } from '../document/schema';
import type { EditorAction } from './history';

/** El recurso al que apunta una capa (imagen de la biblioteca o logotipo), o null. */
function assetOf(layer: Layer): string | null {
  if (layer.type === 'image' && layer.source.kind === 'asset') return layer.source.assetId;
  if (layer.type === 'logo') return layer.assetId;
  return null;
}

/** La capa como marco vacío: misma caja y mismos ajustes; un logotipo pasa a ser un marco que encaja entero. */
export function asEmptyFrame(layer: Layer): Layer {
  if (layer.type === 'image') return { ...layer, source: { kind: 'empty' }, frame: true };
  if (layer.type !== 'logo') return layer;
  const base: Partial<Layer> = { ...layer };
  delete (base as { assetId?: string }).assetId;
  return layerSchema.parse({ ...base, type: 'image', source: { kind: 'empty' }, frame: true, fit: 'contain' });
}

/** El documento con las capas cuyo recurso falta convertidas en marcos vacíos, y cuáles han sido. */
export function emptyMissingAssets(
  document: ContentDocument,
  missing: ReadonlySet<string>,
): { document: ContentDocument; layerIds: string[] } {
  const layerIds: string[] = [];
  const pages = document.pages.map((page) => ({
    ...page,
    layers: page.layers.map((layer) => {
      const id = assetOf(layer);
      if (!id || !missing.has(id)) return layer;
      layerIds.push(layer.id);
      return asEmptyFrame(layer);
    }),
  }));
  return { document: layerIds.length > 0 ? { ...document, pages } : document, layerIds };
}

/**
 * Al saber qué recursos existen (`found`, la respuesta de la biblioteca a `assetIds`), convierte en
 * marcos vacíos las capas cuyo recurso falta. Solo mira los recursos que tenía la pieza AL ABRIRLA:
 * lo que entra después (una plantilla, el copiloto) no se toca, para no meter pasos de deshacer
 * por sorpresa. Devuelve cuántas siguen siendo huecos por rellenar (para el aviso). Solo con
 * permiso de edición: en solo lectura no se toca el documento y se avisa.
 */
export function useMissingAssetFrames({
  document,
  assetIds,
  found,
  readOnly,
  dispatch,
}: {
  document: ContentDocument;
  assetIds: readonly string[];
  /** Recursos que ha devuelto la biblioteca para `assetIds`; undefined mientras no se sabe. */
  found: readonly { id: string }[] | undefined;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
}): number {
  const [converted, setConverted] = useState<string[]>([]);
  const handled = useRef(new Set<string>());
  const [atOpen] = useState(() => new Set(assetIds));
  const missing = useMemo(() => {
    if (!found) return new Set<string>();
    const present = new Set(found.map((a) => a.id));
    return new Set(assetIds.filter((id) => atOpen.has(id) && !present.has(id)));
  }, [assetIds, found, atOpen]);

  useEffect(() => {
    if (readOnly || missing.size === 0) return;
    const fresh = new Set([...missing].filter((id) => !handled.current.has(id)));
    if (fresh.size === 0) return;
    fresh.forEach((id) => handled.current.add(id));
    const result = emptyMissingAssets(document, fresh);
    if (result.layerIds.length === 0) return;
    dispatch({ type: 'replace', document: result.document });
    setConverted((current) => [...new Set([...current, ...result.layerIds])]);
  }, [document, missing, readOnly, dispatch]);

  if (readOnly) {
    return allLayers(document).filter((layer) => {
      const id = assetOf(layer);
      return id !== null && missing.has(id);
    }).length;
  }
  // Los que siguen vacíos: al poner foto en el hueco, deja de contar.
  const layers = new Map(allLayers(document).map((l) => [l.id, l]));
  return converted.filter((id) => {
    const layer = layers.get(id);
    return layer?.type === 'image' && layer.source.kind === 'empty';
  }).length;
}

/** Aviso de la cabecera del editor de piezas. */
export function MissingAssetsNotice({ count, readOnly }: { count: number; readOnly: boolean }) {
  if (count === 0) return null;
  const one = count === 1;
  return (
    <div role="alert" data-testid="editor-missing-assets">
      <Notice tone="warning">
        {one ? '1 foto de esta pieza se ha borrado' : `${count} fotos de esta pieza se han borrado`} de la biblioteca.{' '}
        {readOnly
          ? 'Quien edita la pieza puede sustituirlas.'
          : `${one ? 'Su sitio queda como un hueco' : 'Su sitio queda como huecos'}: pulsa «Poner foto» para sustituir${one ? 'la' : 'las'}. Mientras, no salen en la imagen exportada.`}
      </Notice>
    </div>
  );
}
