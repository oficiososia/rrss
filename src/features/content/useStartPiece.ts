import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { BrandReelTemplate } from '@/features/reels/editor/api';
import { translateError } from '@/lib/errors';
import { useContentMutations } from './api';
import { contentPaths } from './labels';
import { FORMAT_CARDS } from './lista/formats';
import { defaultTitle } from './lista/stage';
import { NETWORKS } from './networks';
import type { BrandTemplate } from './templates/api';

/** Con qué se empieza una pieza nueva. */
export type PieceStart =
  | { kind: 'blank'; format: string }
  | { kind: 'template'; template: BrandTemplate }
  | { kind: 'reel-template'; template: BrandReelTemplate };

/**
 * Crea la pieza y abre su editor. Con plantilla de pieza, su documento es la primera versión; con
 * plantilla de reel, el editor de reels la abre ya elegida (`?plantilla=`).
 */
export function useStartPiece(organizationId: string, brandId: string, onDone?: () => void) {
  const navigate = useNavigate();
  const { create, saveVersion } = useContentMutations(organizationId, brandId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(choice: PieceStart, key: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    const network = choice.kind === 'template' ? choice.template.network : NETWORKS[0]!.id;
    const format =
      choice.kind === 'template' ? choice.template.format : choice.kind === 'reel-template' ? 'reel' : choice.format;
    const label = FORMAT_CARDS.find((card) => card.format === format)?.label ?? 'Pieza';
    try {
      const item = await create.mutateAsync({ title: defaultTitle(label), network, format });
      if (choice.kind === 'template' && choice.template.document) {
        try {
          await saveVersion.mutateAsync({
            contentId: item.id,
            document: choice.template.document,
            note: `Desde la plantilla «${choice.template.name}»`,
          });
        } catch (e) {
          // La pieza existe: se abre sin diseño y la plantilla se puede volver a poner desde el editor.
          toast.error(`Se ha creado, pero no se ha podido aplicar la plantilla. ${translateError(e)}`);
        }
      }
      onDone?.();
      const path = contentPaths(organizationId, brandId).item(item.id);
      navigate(choice.kind === 'reel-template' ? `${path}?plantilla=${encodeURIComponent(choice.template.key)}` : path);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(null);
    }
  }

  return { start, busy, error };
}

