import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Notice } from '@/components/ui';
import { buildCatalogWith } from '../../../agency/catalogo/construir.ts';
import { CATALOG_SETS, NEUTRAL_THEME, themeFromProfile } from '../../../agency/catalogo/index.ts';
import { templateKeys } from '@/features/content/templates/api';
import { REEL_TEMPLATES } from '@/features/reels/templates';
import { reelTemplateKeys } from '@/features/reels/editor/api';
import type { Json } from '@/lib/database.types';
import { translateError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useActiveProfile } from './api';
import { parseProfile } from './profile';

// «Cargar plantillas del catálogo» (Marca → Identidad visual → Plantillas): lo mismo
// que hace `cargar-catalogo --cargar` de la herramienta de la agencia, pero desde la
// aplicación y con el permiso de quien edita la marca. El catálogo va empaquetado en
// este trozo (que solo se descarga al abrir el diálogo); los guarda
// `deliver_design_templates` y `deliver_reel_templates`, que ya exigen editar la marca.

export function CatalogDialog({
  brandId,
  open,
  onOpenChange,
}: {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const profile = useActiveProfile(brandId);
  const [setId, setSetId] = useState<string>(CATALOG_SETS[0]!.id);
  const [loading, setLoading] = useState(false);
  const noProfile = profile.isSuccess && profile.data === null;

  async function load() {
    setLoading(true);
    try {
      const theme = themeFromProfile(profile.data ? parseProfile(profile.data.data) : null);
      const built = buildCatalogWith(
        setId,
        theme,
        REEL_TEMPLATES.map((t) => t.id),
      );
      unwrap(
        await supabase.rpc('deliver_design_templates', {
          p_brand_id: brandId,
          p_templates: built.publications.templates as unknown as Json,
        }),
      );
      // Las historias (9:16), si el juego las trae, en otra entrega: cada una admite 12 como mucho.
      if (built.stories) {
        unwrap(
          await supabase.rpc('deliver_design_templates', {
            p_brand_id: brandId,
            p_templates: built.stories.templates as unknown as Json,
          }),
        );
      }
      unwrap(
        await supabase.rpc('deliver_reel_templates', {
          p_brand_id: brandId,
          p_templates: built.reels.templates as unknown as Json,
          p_source: 'catalog',
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: templateKeys.list(brandId) }),
        queryClient.invalidateQueries({ queryKey: reelTemplateKeys.all(brandId) }),
      ]);
      toast.success(
        `Cargadas ${built.publications.templates.length} plantillas de publicación${
          built.stories ? `, ${built.stories.templates.length} de historia` : ''
        } y ${built.reels.templates.length} de reel`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !loading && onOpenChange(next)}
      title="Cargar plantillas del catálogo"
      description="Elige el tipo de negocio. Se guardan en la marca con sus colores y tipografías; los textos son de muestra y las fotos, marcadores."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={() => void load()} loading={loading} data-testid="catalog-load">
            Cargar plantillas
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2" disabled={loading}>
        <legend className="sr-only">Tipo de negocio</legend>
        {CATALOG_SETS.map((set) => (
          <label
            key={set.id}
            className={cn(
              'flex cursor-pointer gap-3 rounded-xl border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
              setId === set.id ? 'border-primary bg-primary-soft' : 'border-border hover:bg-subtle',
            )}
          >
            <input
              type="radio"
              name="catalog-set"
              value={set.id}
              checked={setId === set.id}
              onChange={() => setSetId(set.id)}
              className="mt-1"
              data-testid={`catalog-set-${set.id}`}
            />
            <span>
              <span className="block text-sm font-medium">{set.name}</span>
              <span className="block text-xs text-muted">
                {set.forWhom} {set.reels(NEUTRAL_THEME).length} de reel y {set.posts(NEUTRAL_THEME).length} de
                publicación o carrusel{set.stories ? `, y ${set.stories(NEUTRAL_THEME).length} de historia` : ''}.
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-3 space-y-2">
        {noProfile && (
          <Notice tone="warning">
            Esta marca todavía no tiene perfil: las plantillas saldrán con colores neutros. Rellena sus colores y
            tipografías y vuelve a cargarlas para ajustarlas.
          </Notice>
        )}
        <p className="text-xs text-muted">
          Volver a cargar el mismo tipo actualiza las mismas plantillas, no las duplica. Las de reel se usan en el
          editor de reels y las de publicación, en «Desde una plantilla».
        </p>
      </div>
    </Dialog>
  );
}
