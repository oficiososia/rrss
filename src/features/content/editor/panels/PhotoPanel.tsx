import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui';
import {
  IMAGE_FILTERS,
  isNeutralAdjust,
  MAX_IMAGE_BLUR,
  type ImageAdjust,
  type ImageBackdrop,
  type ImageFilter,
  type ImageLayer,
} from '../../document';
import type { LayerPatch } from '../history';
import { FILTER_LABEL } from '../imageEffects/filters';
import { RESET_EDITS } from '../imageEffects/imageEdit';
import { ColorInput, NumberInput, RangeInput, SelectInput, Section } from './controls';
import { backdropSummary, blurSummary } from './panelSummary';
import { ShadowFields } from './ShadowFields';

const NEUTRAL: ImageAdjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 };

type BackdropKind = 'none' | ImageBackdrop['kind'];

/**
 * Ajustes de una foto del diseño que no están en la barra flotante ni en
 * «Editar foto»: filtro, cómo encaja en su caja, qué se pone detrás, sombra y
 * desenfoque. Se abre desde «⋯ → Ajustes…». Todo se guarda en la capa (la foto
 * original no se toca) y se deshace con Ctrl+Z. Luz y color, girar, recortar y
 * quitar o cambiar el fondo están en «Editar foto» y en la barra: aquí no se
 * repiten.
 */
export function PhotoPanel({
  layer,
  readOnly,
  palette,
  update,
  checkpoint,
}: {
  layer: ImageLayer;
  readOnly: boolean;
  palette: { hex: string; name: string }[];
  update: (patch: LayerPatch, field?: string) => void;
  checkpoint: () => void;
}) {
  const adjust = layer.adjust ?? NEUTRAL;
  const backdropKind: BackdropKind = layer.backdrop?.kind ?? 'none';
  // Piezas de antes: luz y color, giro o volteo guardados en la capa. Ya no se cambian aquí (están en
  // «Editar foto»), pero se pueden quitar.
  const lightEdited = Boolean(layer.adjust) && !isNeutralAdjust({ ...layer.adjust!, filter: undefined });
  const turned = Boolean(layer.turn || layer.flipX || layer.flipY || layer.straighten);

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

  return (
    <div className="space-y-3" data-testid="photo-panel">
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

      {!readOnly && (lightEdited || turned) && (
        <div className="flex flex-wrap gap-1.5" data-testid="photo-legacy-edits">
          {lightEdited && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update({ adjust: adjust.filter ? { ...NEUTRAL, filter: adjust.filter } : undefined })}
              data-testid="photo-adjust-reset"
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              Quitar los ajustes de luz y color
            </Button>
          )}
          {turned && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update({ ...RESET_EDITS, crop: layer.crop, adjust: layer.adjust })}
              data-testid="photo-geometry-reset"
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              Quitar giro y volteo
            </Button>
          )}
        </div>
      )}

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

      <Section id="photo.backdrop" title="Fondo y sombra" summary={backdropSummary(layer)}>
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
          label="Sombra bajo la foto"
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
    </div>
  );
}
