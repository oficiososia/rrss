// Logotipo legible en el editor de piezas (ver logoContrast.ts):
//  - Al abrir una pieza, los logotipos que puso la plantilla (el primero del kit de la marca) se
//    cambian por la variante del kit que se ve sobre su fondo: la clara sobre fondo oscuro y al revés.
//  - Al aplicar una plantilla desde el editor, lo mismo con sus logotipos (`adopt`).
//  - Lo que elige quien edita (otro logotipo del kit, uno puesto a mano después) no se toca.
// Cada capa se mira una sola vez por sesión: si se deshace el cambio (Ctrl+Z), no vuelve.
// Si ninguna variante contrasta, el editor avisa: «El logotipo apenas se ve sobre este fondo».
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { toast } from 'sonner';
import { Notice } from '@/components/ui';
import { useAssetsByIds, useSignedUrls } from '@/features/library/api';
import { loadCorsImage } from '@/lib/corsImage';
import { allLayers } from '../document/pages';
import type { ContentDocument } from '../document/schema';
import type { EditorAction } from './history';
import { faintLogos, fixLogoContrast, measureLogoLuminance, type LogoTones } from './logoContrast';

/** Luminancia de cada logotipo (el archivo original: la miniatura puede no tener transparencia). */
function useLogoTones(brandId: string, ids: string[]): LogoTones {
  const assets = useAssetsByIds(brandId, ids);
  const paths = useMemo(() => (assets.data ?? []).map((a) => a.storage_path).sort(), [assets.data]);
  const signed = useSignedUrls(paths);
  const [tones, setTones] = useState<Map<string, number | null>>(() => new Map());
  const asked = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    for (const asset of assets.data ?? []) {
      const url = signed.data?.get(asset.storage_path);
      if (!url || asked.current.has(asset.id)) continue;
      asked.current.add(asset.id);
      loadCorsImage(url)
        .then(
          (image) => measureLogoLuminance(image),
          () => null,
        )
        .then((tone) => {
          if (alive.current) setTones((current) => new Map(current).set(asset.id, tone));
        });
    }
  }, [assets.data, signed.data]);

  // Un logotipo que ya no está en la biblioteca no se puede medir.
  return useMemo(() => {
    if (!assets.data) return tones;
    const found = new Set(assets.data.map((a) => a.id));
    const all = new Map(tones);
    for (const id of ids) if (!found.has(id)) all.set(id, null);
    return all;
  }, [tones, assets.data, ids]);
}

export function useLogoContrast({
  brandId,
  document,
  logoIds,
  profileReady,
  readOnly,
  dispatch,
}: {
  brandId: string;
  document: ContentDocument;
  /** Logotipos del kit de la marca, en su orden (el primero es el que ponen las plantillas). */
  logoIds: readonly string[];
  /** Ya se sabe qué logotipos tiene la marca (el perfil ha llegado, aunque no tenga). */
  profileReady: boolean;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
}) {
  // Capas que hay al abrir la pieza: si llevan el primer logotipo del kit, lo puso la plantilla.
  const [atOpen] = useState(
    () =>
      new Set(
        allLayers(document)
          .filter((l) => l.type === 'logo')
          .map((l) => l.id),
      ),
  );
  // Logotipos de una plantilla aplicada desde el editor (cualquiera del kit).
  const adopted = useRef(new Set<string>());
  const handled = useRef(new Set<string>());

  const documentLogoIds = allLayers(document).flatMap((layer) => (layer.type === 'logo' ? [layer.assetId] : []));
  const idsKey = [...new Set([...logoIds, ...documentLogoIds])].sort().join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);
  const tones = useLogoTones(brandId, ids);

  useEffect(() => {
    if (readOnly || !profileReady || logoIds.length < 2) return;
    // Solo cuando se conocen todas las variantes del kit (medidas o imposibles de medir).
    if (logoIds.some((id) => !tones.has(id))) return;
    const candidates = new Set<string>();
    for (const layer of allLayers(document)) {
      if (layer.type !== 'logo' || handled.current.has(layer.id) || !tones.has(layer.assetId)) continue;
      const fromTemplate =
        (atOpen.has(layer.id) && layer.assetId === logoIds[0]) ||
        (adopted.current.has(layer.id) && logoIds.includes(layer.assetId));
      if (!fromTemplate) continue;
      handled.current.add(layer.id);
      candidates.add(layer.id);
    }
    if (candidates.size === 0) return;
    const result = fixLogoContrast(document, candidates, logoIds, tones);
    if (result.swapped.length === 0) return;
    dispatch({ type: 'replace', document: result.document });
    toast.message('Hemos puesto la versión del logotipo que se ve sobre su fondo. Con Ctrl+Z vuelves a la de antes.', {
      id: 'logo-contrast',
    });
  }, [document, logoIds, tones, profileReady, readOnly, atOpen, dispatch]);

  const adopt = useCallback((next: ContentDocument) => {
    for (const layer of allLayers(next)) if (layer.type === 'logo') adopted.current.add(layer.id);
    // Una plantilla nueva sustituye a la anterior: sus capas se miran de nuevo aunque repitan identificador.
    for (const id of adopted.current) handled.current.delete(id);
  }, []);

  const faint = useMemo(() => faintLogos(document, tones), [document, tones]);
  return { faint, adopt };
}

/** Aviso de la cabecera del editor: algún logotipo apenas se ve y no hay otra variante que se vea mejor. */
export function LogoContrastNotice({ faint }: { faint: ReturnType<typeof faintLogos> }) {
  if (faint.length === 0) return null;
  const dark = faint.every((item) => item.logoIsDark);
  const light = faint.every((item) => !item.logoIsDark);
  const hint = dark
    ? 'Sube una versión clara del logotipo en Marca → Identidad visual, o aclara el fondo que tiene detrás.'
    : light
      ? 'Sube una versión oscura del logotipo en Marca → Identidad visual, o oscurece el fondo que tiene detrás.'
      : 'Sube otra versión del logotipo en Marca → Identidad visual, o cambia el fondo que tiene detrás.';
  return (
    <div role="status" data-testid="editor-logo-contrast">
      <Notice tone="warning">El logotipo apenas se ve sobre este fondo. {hint}</Notice>
    </div>
  );
}
