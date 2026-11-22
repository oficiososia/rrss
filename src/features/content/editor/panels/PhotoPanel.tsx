import { Crop, FlipHorizontal2, FlipVertical2, RotateCw, SlidersHorizontal, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Notice } from '@/components/ui';
import { useSaveEdit } from '@/features/photo-edit/api';
import { canRemoveBackground, describeRemovalError } from '@/features/photo-edit/cutout/remover';
import { runQuickEdit, type QuickEdit } from '@/features/photo-edit/quickEdit';
import { translateError } from '@/lib/errors';
import type { MediaAssetRow } from '@/lib/database.types';
import {
  IMAGE_FILTERS,
  isNeutralAdjust,
  MAX_IMAGE_BLUR,
  MAX_STRAIGHTEN,
  type ImageAdjust,
  type ImageBackdrop,
  type ImageFilter,
  type ImageLayer,
} from '../../document';
import type { LayerPatch } from '../history';
import { FILTER_LABEL } from '../imageEffects/filters';
import { flipPhoto, RESET_EDITS, straightenPatch, turnQuarter } from '../imageEffects/imageEdit';
import { ColorInput, NumberInput, RangeInput, SelectInput, Section } from './controls';
import { adjustSummary, backdropSummary, blurSummary, focusSummary, geometrySummary } from './panelSummary';
import { CropDialog } from './CropDialog';
import { ShadowFields } from './ShadowFields';

const NEUTRAL: ImageAdjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 };

const SLIDERS: { key: Exclude<keyof ImageAdjust, 'filter'>; label: string; min: number }[] = [
  { key: 'brightness', label: 'Brillo', min: -100 },
  { key: 'contrast', label: 'Contraste', min: -100 },
  { key: 'saturation', label: 'Saturación', min: -100 },
  { key: 'temperature', label: 'Temperatura (fría ↔ cálida)', min: -100 },
  { key: 'sharpness', label: 'Nitidez', min: 0 },
];

type BackdropKind = 'none' | ImageBackdrop['kind'];

export interface PhotoToolsContext {
  /** El recurso de la biblioteca de la capa y su dirección, si ya se conocen. */
  row: MediaAssetRow | null;
  url: string | undefined;
  /** La capa pasa a usar un recurso nuevo (se deshace con Ctrl+Z). `fit` es cómo encaja. */
  onUseResult: (row: MediaAssetRow, fit: 'cover' | 'contain') => void;
  /** Abre «Cambiar el fondo con IA» (solo si el servidor tiene IA para ello; si no, no hay botón). */
  onAiBackground?: () => void;
}

/**
 * Ediciones sencillas de una foto del diseño: luz y color, girar y recortar,
 * fondo y sombra. Todo se guarda en la capa (la foto original no se toca) y se
 * deshace con Ctrl+Z; solo «Quitar fondo» y «Desenfocar el fondo» crean una foto
 * nueva en la biblioteca.
 */
export function PhotoPanel({
  layer,
  readOnly,
  palette,
  update,
  checkpoint,
  tools,
  onEditPhoto,
  onRestoreOriginal,
}: {
  layer: ImageLayer;
  readOnly: boolean;
  palette: { hex: string; name: string }[];
  update: (patch: LayerPatch, field?: string) => void;
  checkpoint: () => void;
  tools: PhotoToolsContext;
  /** Abre «Editar foto» (solo si la foto es de la biblioteca y se puede editar). */
  onEditPhoto?: () => void;
  /** Vuelve a la foto original, si la de ahora es una edición. */
  onRestoreOriginal?: () => void;
}) {
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [blurAmount, setBlurAmount] = useState(50);
  const save = useSaveEdit(tools.row?.brand_id ?? '');
  const adjust = layer.adjust ?? NEUTRAL;
  const edited = !isNeutralAdjust(layer.adjust);
  const geometryEdited = Boolean(layer.turn || layer.flipX || layer.flipY || layer.straighten || layer.crop);
  const backdropKind: BackdropKind = layer.backdrop?.kind ?? 'none';
  const canCut = canRemoveBackground() && tools.row !== null && Boolean(tools.url);

  const setAdjust = (patch: Partial<ImageAdjust>, field = 'adjust') =>
    update({ adjust: { ...adjust, ...patch } }, field);

  const setBackdropKind = (kind: BackdropKind) => {
    if (kind === 'none') return update({ backdrop: undefined });
    const next: ImageBackdrop =
      kind === 'color'
        ? { kind, color: palette[0]?.hex ?? '#FFFFFF' }
        : kind === 'gradient'
          ? { kind, from: palette[0]?.hex ?? '#FFFFFF', to: palette[1]?.hex ?? '#000000', angle: 180 }
          : { kind, blur: 60 };
    // El fondo solo se ve donde la foto no llega: la foto pasa a verse entera.
    update({ backdrop: next, fit: 'contain' });
  };

  async function quick(edit: QuickEdit, working: string) {
    if (!tools.row || !tools.url) return;
    setBusy(working);
    try {
      const row = await runQuickEdit({
        asset: tools.row,
        url: tools.url,
        edit,
        save: (input) => save.mutateAsync(input),
        onProgress: (progress) => {
          if (progress.phase === 'downloading')
            setBusy(
              `Descargando el modelo de recorte (${Math.round(progress.total / 1_000_000)} MB, solo la primera vez)…`,
            );
          else if (progress.phase === 'running') setBusy(working);
        },
      });
      tools.onUseResult(row, edit.kind === 'cutout' ? 'contain' : 'cover');
      toast.success('Hecho. La foto original sigue en la biblioteca y puedes deshacerlo con Ctrl+Z.');
    } catch (error) {
      toast.error(describeRemovalError(error) || translateError(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="photo-panel">
      {!readOnly && layer.source.kind === 'asset' && (onEditPhoto || onRestoreOriginal) && (
        <div className="space-y-1.5">
          {onEditPhoto && (
            <Button variant="primary" size="sm" className="w-full" onClick={onEditPhoto} data-testid="layer-edit-photo">
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Editar foto
            </Button>
          )}
          {onRestoreOriginal && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={onRestoreOriginal}
              data-testid="layer-restore-original"
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              Volver a la foto original
            </Button>
          )}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted" id="photo-filters-title">
          Filtros rápidos
        </p>
        {/* Una sola fila que se desliza: ocupa poco alto, también en la hoja del móvil. */}
        <div
          className="flex snap-x gap-1.5 overflow-x-auto pb-1.5"
          role="group"
          aria-labelledby="photo-filters-title"
          data-testid="photo-filters"
        >
          <Button
            size="sm"
            className="shrink-0 snap-start"
            variant={adjust.filter ? 'secondary' : 'primary'}
            aria-pressed={!adjust.filter}
            disabled={readOnly}
            onClick={() => setAdjust({ filter: undefined })}
          >
            Ninguno
          </Button>
          {IMAGE_FILTERS.map((filter: ImageFilter) => (
            <Button
              key={filter}
              size="sm"
              className="shrink-0 snap-start"
              variant={adjust.filter === filter ? 'primary' : 'secondary'}
              aria-pressed={adjust.filter === filter}
              disabled={readOnly}
              data-testid={`photo-filter-${filter}`}
              onClick={() => setAdjust({ filter })}
            >
              {FILTER_LABEL[filter]}
            </Button>
          ))}
        </div>
      </div>

      <SelectInput<'cover' | 'contain'>
        label="Encaje en el recuadro"
        value={layer.fit}
        disabled={readOnly}
        onChange={(fit) => update({ fit })}
        options={[
          { value: 'cover', label: 'Llenar (recorta los bordes)' },
          { value: 'contain', label: 'Entera (se ve completa)' },
        ]}
      />

      <Section id="photo.light" title="Luz y color" summary={adjustSummary(layer)}>
        {SLIDERS.map((slider) => (
          <RangeInput
            key={slider.key}
            label={slider.label}
            value={adjust[slider.key]}
            min={slider.min}
            max={100}
            disabled={readOnly}
            testId={`photo-${slider.key}`}
            onChange={(value) => setAdjust({ [slider.key]: value })}
            onCommit={checkpoint}
          />
        ))}
        {edited && !readOnly && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ adjust: undefined })}
            data-testid="photo-adjust-reset"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            Quitar los ajustes de luz y color
          </Button>
        )}
      </Section>

      <Section id="photo.geometry" title="Girar y recortar" summary={geometrySummary(layer)}>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={readOnly}
            onClick={() => update(turnQuarter(layer))}
            data-testid="photo-turn"
          >
            <RotateCw className="h-4 w-4" aria-hidden />
            Girar 90°
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={readOnly}
            onClick={() => update(flipPhoto(layer, 'x'))}
            data-testid="photo-flip-x"
          >
            <FlipHorizontal2 className="h-4 w-4" aria-hidden />
            Voltear ↔
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={readOnly}
            onClick={() => update(flipPhoto(layer, 'y'))}
            data-testid="photo-flip-y"
          >
            <FlipVertical2 className="h-4 w-4" aria-hidden />
            Voltear ↕
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={readOnly || !tools.url}
            onClick={() => setCropping(true)}
            data-testid="photo-crop"
          >
            <Crop className="h-4 w-4" aria-hidden />
            Recortar…
          </Button>
        </div>
        <RangeInput
          label="Enderezar (grados)"
          value={layer.straighten ?? 0}
          min={-MAX_STRAIGHTEN}
          max={MAX_STRAIGHTEN}
          step={0.5}
          disabled={readOnly}
          testId="photo-straighten"
          onChange={(degrees) => update(straightenPatch(degrees), 'straighten')}
          onCommit={checkpoint}
        />
        {layer.crop && <p className="text-xs text-muted">La foto está recortada.</p>}
        {geometryEdited && !readOnly && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ ...RESET_EDITS, adjust: layer.adjust })}
            data-testid="photo-geometry-reset"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            Quitar giro, volteo y recorte
          </Button>
        )}
      </Section>

      <Section id="photo.focus" title="Parte de la foto que se ve" summary={focusSummary(layer)}>
        <p className="text-xs text-muted">Con «Llenar», la foto se recorta alrededor de este punto.</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Punto de interés, a lo ancho (%)"
            value={layer.focus.x * 100}
            min={0}
            max={100}
            disabled={readOnly}
            onChange={(v) => update({ focus: { ...layer.focus, x: v / 100 } }, 'focus')}
            onCommit={checkpoint}
          />
          <NumberInput
            label="Punto de interés, a lo alto (%)"
            value={layer.focus.y * 100}
            min={0}
            max={100}
            disabled={readOnly}
            onChange={(v) => update({ focus: { ...layer.focus, y: v / 100 } }, 'focus')}
            onCommit={checkpoint}
          />
        </div>
      </Section>

      <Section id="photo.backdrop" title="Fondo y sombra" summary={backdropSummary(layer)}>
        {(canCut || tools.onAiBackground) && !readOnly && (
          <div className="space-y-2">
            {canCut && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  disabled={busy !== null}
                  onClick={() => quick({ kind: 'cutout' }, 'Quitando el fondo…')}
                  data-testid="photo-cutout"
                >
                  Quitar el fondo
                </Button>
                <RangeInput
                  label="Intensidad del desenfoque"
                  value={blurAmount}
                  min={5}
                  max={100}
                  onChange={setBlurAmount}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  disabled={busy !== null}
                  onClick={() =>
                    quick({ kind: 'blur_background', amount: blurAmount, shadow: true }, 'Desenfocando el fondo…')
                  }
                  data-testid="photo-blur-background"
                >
                  Desenfocar el fondo y dejar el plato nítido
                </Button>
              </>
            )}
            {tools.onAiBackground && (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={tools.onAiBackground}
                data-testid="photo-ai-background"
              >
                Cambiar el fondo con IA…
              </Button>
            )}
            {busy && (
              <Notice tone="info">
                <span data-testid="photo-busy">{busy}</span>
              </Notice>
            )}
            <p className="text-xs text-muted">
              Estas acciones crean una foto nueva en la biblioteca; la original no cambia.
            </p>
          </div>
        )}
        <SelectInput<BackdropKind>
          label="Poner detrás de la foto"
          value={backdropKind}
          disabled={readOnly}
          onChange={setBackdropKind}
          options={[
            { value: 'none', label: 'Nada' },
            { value: 'color', label: 'Un color' },
            { value: 'gradient', label: 'Un degradado' },
            { value: 'blur', label: 'La misma foto desenfocada' },
          ]}
        />
        {layer.backdrop?.kind === 'color' && (
          <ColorInput
            label="Color de fondo"
            value={layer.backdrop.color}
            palette={palette}
            disabled={readOnly}
            onChange={(color) => update({ backdrop: { kind: 'color', color } }, 'backdrop')}
            onCommit={checkpoint}
          />
        )}
        {layer.backdrop?.kind === 'gradient' && (
          <>
            <ColorInput
              label="Color de arriba"
              value={layer.backdrop.from}
              palette={palette}
              disabled={readOnly}
              onChange={(from) =>
                update({ backdrop: { ...layer.backdrop!, kind: 'gradient', from } as ImageBackdrop }, 'backdrop')
              }
              onCommit={checkpoint}
            />
            <ColorInput
              label="Color de abajo"
              value={layer.backdrop.to}
              palette={palette}
              disabled={readOnly}
              onChange={(to) =>
                update({ backdrop: { ...layer.backdrop!, kind: 'gradient', to } as ImageBackdrop }, 'backdrop')
              }
              onCommit={checkpoint}
            />
            <RangeInput
              label="Dirección (grados)"
              value={layer.backdrop.angle}
              min={0}
              max={360}
              disabled={readOnly}
              onChange={(angle) =>
                update({ backdrop: { ...layer.backdrop!, kind: 'gradient', angle } as ImageBackdrop }, 'backdrop')
              }
              onCommit={checkpoint}
            />
          </>
        )}
        {layer.backdrop?.kind === 'blur' && (
          <RangeInput
            label="Desenfoque del fondo"
            value={layer.backdrop.blur}
            min={1}
            max={100}
            disabled={readOnly}
            onChange={(blur) => update({ backdrop: { kind: 'blur', blur } }, 'backdrop')}
            onCommit={checkpoint}
          />
        )}
        {backdropKind !== 'none' && layer.fit === 'cover' && (
          <p className="text-xs text-muted">
            El fondo se ve donde la foto no llega: pon el encaje en «Entera» o usa una foto sin fondo.
          </p>
        )}
        <ShadowFields
          label="Sombra bajo la foto (o el plato)"
          shadow={layer.shadow}
          palette={palette}
          readOnly={readOnly}
          onChange={(shadow, field) => update({ shadow }, field)}
          onCommit={checkpoint}
        />
      </Section>

      <Section id="photo.blur" title="Desenfoque" summary={blurSummary(layer)}>
        <NumberInput
          label="Desenfoque de la foto (%)"
          value={layer.blur ?? 0}
          min={0}
          max={MAX_IMAGE_BLUR}
          disabled={readOnly}
          onChange={(v) => update({ blur: v > 0 ? Math.min(MAX_IMAGE_BLUR, v) : undefined }, 'blur')}
          onCommit={checkpoint}
        />
      </Section>

      {cropping && tools.url && (
        <CropDialog
          layer={layer}
          url={tools.url}
          onClose={() => setCropping(false)}
          onApply={(patch) => {
            update(patch);
            checkpoint();
            setCropping(false);
          }}
        />
      )}
    </div>
  );
}
