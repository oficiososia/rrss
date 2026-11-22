import type { Dispatch, Ref } from 'react';
import {
  ANCHORS_X,
  ANCHORS_Y,
  ASPECT_RATIOS,
  type AspectRatio,
  type Canvas,
  type Layer,
  type ShapeLayer,
  type TextLayer,
} from '../../document';
import type { EditorAction, LayerPatch } from '../history';
import { FALLBACK_FONTS, layerLabel } from '../layers';
import { CheckInput, ColorInput, Labeled, NumberInput, Section, SelectInput } from './controls';
import { LayerActions } from './LayerActions';
import {
  anchorSummary,
  nameSummary,
  opacitySummary,
  positionSummary,
  shapeExtrasSummary,
  textSpacingSummary,
} from './panelSummary';
import { PhotoPanel, type PhotoToolsContext } from './PhotoPanel';
import { ShadowFields } from './ShadowFields';
import { TextEffectsFields } from './TextEffectsFields';

export interface BrandStyle {
  palette: { hex: string; name: string }[];
  fonts: string[];
}

interface PropertiesPanelProps {
  layer: Layer | null;
  canvas: Canvas;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
  brandStyle: BrandStyle;
  /** Proporciones que admite la red; null si no se sabe. */
  allowedRatios: AspectRatio[] | null;
  textRef: Ref<HTMLTextAreaElement>;
  /** Abre «Editar foto» con la imagen de la capa (solo si es de la biblioteca y se puede editar). */
  onEditPhoto?: () => void;
  /** La capa vuelve a la foto original (si la de ahora es una edición); se deshace con Ctrl+Z. */
  onRestoreOriginal?: () => void;
  /** Lo que necesitan las ediciones de foto que crean una foto nueva (quitar el fondo…). */
  photoTools?: PhotoToolsContext;
}

const ANCHOR_X_LABEL: Record<(typeof ANCHORS_X)[number], string> = {
  left: 'Borde izquierdo',
  center: 'Centro',
  right: 'Borde derecho',
  stretch: 'Se estira',
};
const ANCHOR_Y_LABEL: Record<(typeof ANCHORS_Y)[number], string> = {
  top: 'Borde superior',
  center: 'Centro',
  bottom: 'Borde inferior',
  stretch: 'Se estira',
};

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

export function PropertiesPanel({
  layer,
  canvas,
  readOnly,
  dispatch,
  brandStyle,
  allowedRatios,
  textRef,
  onEditPhoto,
  onRestoreOriginal,
  photoTools,
}: PropertiesPanelProps) {
  const checkpoint = () => dispatch({ type: 'checkpoint' });

  if (!layer) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Lienzo</h3>
        <SelectInput<AspectRatio>
          label="Proporción"
          value={canvas.aspectRatio}
          disabled={readOnly}
          onChange={(ratio) => dispatch({ type: 'setRatio', ratio })}
          options={ASPECT_RATIOS.map((ratio) => ({
            value: ratio,
            label: allowedRatios && !allowedRatios.includes(ratio) ? `${ratio} (la red no la admite)` : ratio,
          }))}
        />
        <p className="text-xs text-muted">
          Al cambiarla, las capas se recolocan según su anclaje. Revisa el resultado; se puede deshacer.
        </p>
        <ColorInput
          label="Fondo"
          value={canvas.backgroundColor}
          palette={brandStyle.palette}
          disabled={readOnly}
          onChange={(color) => dispatch({ type: 'setBackground', color, key: 'background' })}
          onCommit={checkpoint}
        />
        <p className="text-xs text-muted">Elige una capa en el lienzo o en «Capas» para cambiarla.</p>
      </div>
    );
  }

  const id = layer.id;
  const update = (patch: LayerPatch, field?: string) =>
    dispatch({ type: 'update', id, patch, ...(field ? { key: `${field}:${id}` } : {}) });
  const geometryLocked = readOnly || layer.locked;

  return (
    <div className="space-y-3" data-testid="properties-panel">
      <LayerActions layer={layer} readOnly={readOnly} dispatch={dispatch} />

      {layer.type === 'text' && (
        <TextFields
          layer={layer}
          readOnly={readOnly}
          update={update}
          brandStyle={brandStyle}
          textRef={textRef}
          checkpoint={checkpoint}
        />
      )}
      {layer.type === 'shape' && (
        <ShapeFields
          layer={layer}
          readOnly={readOnly}
          update={update}
          brandStyle={brandStyle}
          checkpoint={checkpoint}
        />
      )}
      {layer.type === 'image' && (
        <PhotoPanel
          layer={layer}
          readOnly={readOnly}
          palette={brandStyle.palette}
          update={update}
          checkpoint={checkpoint}
          tools={photoTools ?? { row: null, url: undefined, onUseResult: () => undefined }}
          onEditPhoto={onEditPhoto}
          onRestoreOriginal={onRestoreOriginal}
        />
      )}

      <Section id="common.opacity" title="Transparencia y visibilidad" summary={opacitySummary(layer)}>
        <NumberInput
          label="Opacidad (%)"
          value={layer.opacity * 100}
          min={0}
          max={100}
          disabled={readOnly}
          onChange={(v) => update({ opacity: v / 100 }, 'opacity')}
          onCommit={checkpoint}
        />
        <div className="flex flex-wrap gap-4">
          <CheckInput
            label="Visible"
            checked={layer.visible}
            disabled={readOnly}
            onChange={(visible) => update({ visible })}
          />
          <CheckInput
            label="Bloqueada"
            checked={layer.locked}
            disabled={readOnly}
            onChange={(locked) => update({ locked })}
          />
        </div>
      </Section>

      {/* Lo técnico, al final y plegado. */}
      <Section id="tech.position" title="Posición exacta y tamaño" summary={positionSummary(layer)}>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="X"
            value={layer.x}
            disabled={geometryLocked}
            onChange={(x) => update({ x }, 'x')}
            onCommit={checkpoint}
          />
          <NumberInput
            label="Y"
            value={layer.y}
            disabled={geometryLocked}
            onChange={(y) => update({ y }, 'y')}
            onCommit={checkpoint}
          />
          <NumberInput
            label="Ancho"
            value={layer.width}
            min={1}
            disabled={geometryLocked}
            onChange={(width) => update({ width }, 'width')}
            onCommit={checkpoint}
          />
          <NumberInput
            label="Alto"
            value={layer.height}
            min={1}
            disabled={geometryLocked}
            onChange={(height) => update({ height }, 'height')}
            onCommit={checkpoint}
          />
          <NumberInput
            label="Giro (grados)"
            value={layer.rotation}
            min={-180}
            max={180}
            disabled={geometryLocked}
            onChange={(rotation) => update({ rotation }, 'rotation')}
            onCommit={checkpoint}
          />
        </div>
      </Section>

      <Section id="tech.anchor" title="Al cambiar de proporción" summary={anchorSummary(layer)}>
        <div className="grid grid-cols-2 gap-3">
          <SelectInput
            label="Horizontal: conserva"
            value={layer.anchor.x}
            disabled={readOnly}
            onChange={(x) => update({ anchor: { ...layer.anchor, x } })}
            options={ANCHORS_X.map((value) => ({ value, label: ANCHOR_X_LABEL[value] }))}
          />
          <SelectInput
            label="Vertical: conserva"
            value={layer.anchor.y}
            disabled={readOnly}
            onChange={(y) => update({ anchor: { ...layer.anchor, y } })}
            options={ANCHORS_Y.map((value) => ({ value, label: ANCHOR_Y_LABEL[value] }))}
          />
        </div>
      </Section>

      {!readOnly && (
        <Section id="tech.name" title="Nombre de la capa" summary={nameSummary(layer)}>
          <Labeled label="Nombre en la lista de capas">
            {(inputId) => (
              <input
                id={inputId}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                value={layer.name}
                maxLength={120}
                placeholder={layerLabel({ ...layer, name: '' })}
                onChange={(e) => update({ name: e.target.value }, 'name')}
                onBlur={checkpoint}
              />
            )}
          </Labeled>
        </Section>
      )}
    </div>
  );
}

function TextFields({
  layer,
  readOnly,
  update,
  brandStyle,
  textRef,
  checkpoint,
}: {
  layer: TextLayer;
  readOnly: boolean;
  update: (patch: LayerPatch, field?: string) => void;
  brandStyle: BrandStyle;
  textRef: Ref<HTMLTextAreaElement>;
  checkpoint: () => void;
}) {
  const fonts = [...new Set([...brandStyle.fonts, ...FALLBACK_FONTS, layer.fontFamily])];
  return (
    <>
      <section className="space-y-3" data-testid="text-main">
        <Labeled label="Texto">
          {(id) => (
            <textarea
              id={id}
              ref={textRef}
              rows={3}
              maxLength={2000}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
              value={layer.text}
              disabled={readOnly}
              onChange={(e) => update({ text: e.target.value }, 'text')}
              onBlur={checkpoint}
              data-testid="layer-text"
            />
          )}
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <SelectInput
            label="Tipografía"
            value={layer.fontFamily}
            disabled={readOnly}
            onChange={(fontFamily) => update({ fontFamily })}
            options={fonts.map((font) => ({
              value: font,
              label: brandStyle.fonts.includes(font) ? `${font} (marca)` : font,
            }))}
          />
          <NumberInput
            label="Tamaño de letra"
            value={layer.fontSize}
            min={1}
            max={2000}
            disabled={readOnly}
            onChange={(fontSize) => update({ fontSize }, 'fontSize')}
            onCommit={checkpoint}
          />
          <SelectInput
            label="Grosor"
            value={String(layer.fontWeight)}
            disabled={readOnly}
            onChange={(w) => update({ fontWeight: Number(w) })}
            options={WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))}
          />
          <SelectInput<'left' | 'center' | 'right'>
            label="Alineación"
            value={layer.align}
            disabled={readOnly}
            onChange={(align) => update({ align })}
            options={[
              { value: 'left', label: 'Izquierda' },
              { value: 'center', label: 'Centro' },
              { value: 'right', label: 'Derecha' },
            ]}
          />
        </div>
        <ColorInput
          label="Color del texto"
          value={layer.color}
          palette={brandStyle.palette}
          disabled={readOnly}
          onChange={(color) => update({ color }, 'color')}
          onCommit={checkpoint}
        />
      </section>

      <Section id="text.spacing" title="Interlineado y cursiva" summary={textSpacingSummary(layer)}>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Interlineado"
            value={layer.lineHeight}
            min={0.5}
            max={4}
            step={0.05}
            disabled={readOnly}
            onChange={(lineHeight) => update({ lineHeight }, 'lineHeight')}
            onCommit={checkpoint}
          />
          <div className="flex items-end pb-2">
            <CheckInput
              label="Cursiva"
              checked={layer.italic}
              disabled={readOnly}
              onChange={(italic) => update({ italic })}
            />
          </div>
        </div>
      </Section>

      <TextEffectsFields
        layer={layer}
        readOnly={readOnly}
        palette={brandStyle.palette}
        update={update}
        checkpoint={checkpoint}
      />
    </>
  );
}

function ShapeFields({
  layer,
  readOnly,
  update,
  brandStyle,
  checkpoint,
}: {
  layer: ShapeLayer;
  readOnly: boolean;
  update: (patch: LayerPatch, field?: string) => void;
  brandStyle: BrandStyle;
  checkpoint: () => void;
}) {
  return (
    <>
      <section className="space-y-3" data-testid="shape-main">
        <CheckInput
          label="Relleno"
          checked={layer.fill !== null}
          disabled={readOnly}
          onChange={(on) => update({ fill: on ? (brandStyle.palette[0]?.hex ?? '#E5E7EB') : null })}
        />
        {layer.fill !== null && (
          <ColorInput
            label="Color de relleno"
            value={layer.fill}
            palette={brandStyle.palette}
            disabled={readOnly}
            onChange={(fill) => update({ fill }, 'fill')}
            onCommit={checkpoint}
          />
        )}
        <CheckInput
          label="Borde"
          checked={layer.stroke !== null}
          disabled={readOnly}
          onChange={(on) => update({ stroke: on ? { color: '#111111', width: 4 } : null })}
        />
        {layer.stroke !== null && (
          <>
            <ColorInput
              label="Color del borde"
              value={layer.stroke.color}
              palette={brandStyle.palette}
              disabled={readOnly}
              onChange={(color) => update({ stroke: { width: layer.stroke?.width ?? 4, color } }, 'stroke')}
              onCommit={checkpoint}
            />
            <NumberInput
              label="Grosor del borde"
              value={layer.stroke.width}
              min={0.5}
              max={1000}
              disabled={readOnly}
              onChange={(width) => update({ stroke: { color: layer.stroke?.color ?? '#111111', width } }, 'stroke')}
              onCommit={checkpoint}
            />
          </>
        )}
      </section>
      <Section id="shape.extras" title="Esquinas y sombra" summary={shapeExtrasSummary(layer)}>
        {layer.shape === 'rectangle' && (
          <NumberInput
            label="Radio de las esquinas"
            value={layer.cornerRadius}
            min={0}
            disabled={readOnly}
            onChange={(cornerRadius) => update({ cornerRadius }, 'cornerRadius')}
            onCommit={checkpoint}
          />
        )}
        <ShadowFields
          shadow={layer.shadow}
          palette={brandStyle.palette}
          readOnly={readOnly}
          onChange={(shadow, field) => update({ shadow }, field)}
          onCommit={checkpoint}
        />
      </Section>
    </>
  );
}
