import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CopyPlus,
  Crop,
  Eraser,
  Group,
  ImagePlus,
  Minus,
  PencilLine,
  Plus,
  Replace,
  SlidersHorizontal,
  Trash2,
  Ungroup,
  Unlock,
  type LucideIcon,
} from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { MenuContent, MoreMenu, type MoreMenuItem } from '@/components/ui';
import { cn } from '@/lib/utils';
import { HEX_COLOR, isEmptyFrame, type Layer, type ShapeLayer, type TextLayer } from '../document';
import type { EditorAction, LayerPatch } from './history';
import { FALLBACK_FONTS, layerLabel } from './layers';

// Barra de acciones del elemento elegido. Flota sobre el lienzo, junto a lo que
// se ha tocado (la coloca el lienzo, `KonvaCanvas`), y ofrece solo lo propio de
// ese elemento: para una foto, sustituirla, editarla, recortarla o quitarle el
// fondo; para un texto, tipografía, tamaño, color y alineación; para una forma,
// su color. Duplicar y borrar, siempre; lo demás, en «⋯». Es la misma en el
// móvil, con botones de 40 px para el dedo.

export interface ToolbarBrandStyle {
  palette: { hex: string; name: string }[];
  fonts: string[];
}

export interface SelectionToolbarProps {
  /** Capas elegidas (una o varias), en el orden del documento. */
  layers: Layer[];
  brandStyle: ToolbarBrandStyle;
  dispatch: (action: EditorAction) => void;
  /** Poner la foto de un marco vacío o sustituir la de una foto (abre «elegir foto»). */
  onPickPhoto: (id: string) => void;
  /** Abre «Editar foto» con la foto elegida; sin ella (foto no editable), no hay botón. */
  onEditPhoto?: () => void;
  onCropPhoto?: () => void;
  onRemoveBackground?: () => void;
  /** Escribir en el texto elegido, sobre el lienzo. */
  onEditText: (id: string) => void;
  /** Lo que no cabe en la barra (ver `selectionMenu.ts`). */
  menu: MoreMenuItem[];
}

const TOOL =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg hover:bg-subtle ' +
  'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ' +
  'touch-manipulation max-lg:h-10 max-lg:min-w-[2.5rem]';

function Tool({
  icon: Icon,
  label,
  showLabel = false,
  wideOnly = false,
  danger = false,
  testId,
  onClick,
  disabled,
  title,
}: {
  icon: LucideIcon;
  /** Nombre de la acción: es el texto del botón (si `showLabel`) o su nombre accesible y su ayuda. */
  label: string;
  /** El texto se ve en pantallas anchas (en las estrechas queda solo el icono); con `always`, siempre. */
  showLabel?: boolean | 'always';
  /** En pantallas estrechas no cabe: se esconde (la acción sigue en «⋯» o en el panel «Diseño»). */
  wideOnly?: boolean;
  danger?: boolean;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        TOOL,
        danger && 'text-danger',
        !showLabel && 'w-9 px-0 max-lg:w-10',
        showLabel === true && 'max-sm:w-10 max-sm:px-0',
        wideOnly && 'max-sm:hidden',
      )}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {showLabel && <span className={cn(showLabel !== 'always' && 'max-sm:sr-only')}>{label}</span>}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />;

/** Color: los de la marca primero y, al final, cualquier otro con el selector del sistema. */
function ColorTool({
  value,
  label,
  palette,
  onChange,
  onCommit,
  testId,
}: {
  value: string;
  label: string;
  palette: { hex: string; name: string }[];
  onChange: (hex: string) => void;
  onCommit: () => void;
  testId: string;
}) {
  const free = useRef<HTMLInputElement>(null);
  return (
    <>
      <Dropdown.Root modal={false}>
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className={cn(TOOL, 'w-9 px-0 max-lg:w-10')}
            aria-label={label}
            title={label}
            data-testid={testId}
          >
            <span
              className="h-5 w-5 rounded-full border border-border ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: value }}
              aria-hidden
            />
          </button>
        </Dropdown.Trigger>
        <MenuContent>
          <Dropdown.Label className="px-2.5 py-1.5 text-xs font-medium text-muted">
            {palette.length > 0 ? 'Colores de la marca' : 'La marca aún no tiene colores'}
          </Dropdown.Label>
          <div className="flex max-w-[15rem] flex-wrap gap-1.5 px-2.5 pb-2">
            {palette.map((color) => (
              <Dropdown.Item
                key={color.hex + color.name}
                aria-label={`${color.name || 'Color de la marca'} ${color.hex}`}
                title={color.name || color.hex}
                onSelect={() => {
                  onChange(color.hex.toUpperCase());
                  onCommit();
                }}
                className={cn(
                  'h-8 w-8 cursor-pointer rounded-full border border-border outline-none ring-primary ring-offset-2 ring-offset-surface data-[highlighted]:ring-2',
                  color.hex.toUpperCase() === value.toUpperCase() && 'ring-2',
                )}
                style={{ backgroundColor: color.hex }}
                data-testid={`${testId}-swatch`}
              />
            ))}
          </div>
          <Dropdown.Item
            onSelect={() => free.current?.click()}
            className="flex min-h-[2.5rem] cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-subtle"
          >
            Otro color…
          </Dropdown.Item>
        </MenuContent>
      </Dropdown.Root>
      <input
        ref={free}
        type="color"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        value={HEX_COLOR.test(value) ? value.toLowerCase() : '#000000'}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        onBlur={onCommit}
      />
    </>
  );
}

const ALIGN_NEXT: Record<TextLayer['align'], TextLayer['align']> = { left: 'center', center: 'right', right: 'left' };
const ALIGN_NAME: Record<TextLayer['align'], string> = { left: 'izquierda', center: 'centro', right: 'derecha' };
const ALIGN_ICON: Record<TextLayer['align'], LucideIcon> = { left: AlignLeft, center: AlignCenter, right: AlignRight };

function TextTools({
  layer,
  brandStyle,
  update,
  checkpoint,
  onEditText,
}: {
  layer: TextLayer;
  brandStyle: ToolbarBrandStyle;
  update: (patch: LayerPatch, field?: string) => void;
  checkpoint: () => void;
  onEditText: (id: string) => void;
}) {
  const fonts = [...new Set([...brandStyle.fonts, ...FALLBACK_FONTS, layer.fontFamily])];
  const step = layer.fontSize >= 80 ? 8 : 4;
  const AlignIcon = ALIGN_ICON[layer.align];
  return (
    <>
      <Tool icon={PencilLine} label="Escribir" showLabel testId="bar-edit-text" onClick={() => onEditText(layer.id)} />
      <Divider />
      <select
        aria-label="Tipografía"
        title="Tipografía"
        // En el móvil no cabe: la tipografía se cambia en el panel «Diseño» («⋯ → Todas las opciones»).
        className="h-9 max-w-[8.5rem] shrink-0 rounded-md border border-border bg-surface px-1.5 text-sm text-fg max-lg:h-10 max-sm:hidden"
        value={layer.fontFamily}
        onChange={(event) => update({ fontFamily: event.target.value })}
        data-testid="bar-font"
      >
        {fonts.map((font) => (
          <option key={font} value={font}>
            {brandStyle.fonts.includes(font) ? `${font} (marca)` : font}
          </option>
        ))}
      </select>
      <div className="flex shrink-0 items-center" role="group" aria-label="Tamaño de letra">
        <Tool
          icon={Minus}
          label="Letra más pequeña"
          testId="bar-size-down"
          disabled={layer.fontSize <= step}
          onClick={() => update({ fontSize: Math.max(1, Math.round(layer.fontSize - step)) }, 'fontSize')}
        />
        <span className="min-w-[2.25rem] text-center text-sm tabular-nums" data-testid="bar-size" aria-live="polite">
          {Math.round(layer.fontSize)}
        </span>
        <Tool
          icon={Plus}
          label="Letra más grande"
          testId="bar-size-up"
          disabled={layer.fontSize >= 2000}
          onClick={() => update({ fontSize: Math.min(2000, Math.round(layer.fontSize + step)) }, 'fontSize')}
        />
      </div>
      <ColorTool
        value={layer.color}
        label="Color del texto"
        palette={brandStyle.palette}
        onChange={(color) => update({ color }, 'color')}
        onCommit={checkpoint}
        testId="bar-color"
      />
      <Tool
        icon={AlignIcon}
        label={`Alineación: ${ALIGN_NAME[layer.align]}. Pulsa para pasar a ${ALIGN_NAME[ALIGN_NEXT[layer.align]]}`}
        title={`Alineación: ${ALIGN_NAME[layer.align]}`}
        testId="bar-align"
        onClick={() => update({ align: ALIGN_NEXT[layer.align] })}
      />
    </>
  );
}

function ShapeTools({
  layer,
  brandStyle,
  update,
  checkpoint,
}: {
  layer: ShapeLayer;
  brandStyle: ToolbarBrandStyle;
  update: (patch: LayerPatch, field?: string) => void;
  checkpoint: () => void;
}) {
  // La línea (y cualquier forma sin relleno) se colorea por su borde.
  if (layer.fill === null && layer.stroke) {
    const stroke = layer.stroke;
    return (
      <ColorTool
        value={stroke.color}
        label="Color"
        palette={brandStyle.palette}
        onChange={(color) => update({ stroke: { ...stroke, color } }, 'stroke')}
        onCommit={checkpoint}
        testId="bar-color"
      />
    );
  }
  return (
    <ColorTool
      value={layer.fill ?? '#E5E7EB'}
      label="Color"
      palette={brandStyle.palette}
      onChange={(fill) => update({ fill }, 'fill')}
      onCommit={checkpoint}
      testId="bar-color"
    />
  );
}

export function SelectionToolbar({
  layers,
  brandStyle,
  dispatch,
  onPickPhoto,
  onEditPhoto,
  onCropPhoto,
  onRemoveBackground,
  onEditText,
  menu,
}: SelectionToolbarProps) {
  if (layers.length === 0) return null;
  const single = layers.length === 1 ? layers[0]! : null;
  const allLocked = layers.every((layer) => layer.locked);
  const checkpoint = () => dispatch({ type: 'checkpoint' });
  const update = (patch: LayerPatch, field?: string) =>
    single && dispatch({ type: 'update', id: single.id, patch, ...(field ? { key: `${field}:${single.id}` } : {}) });
  const name = single ? layerLabel(single) : `${layers.length} capas`;

  let tools: ReactNode = null;
  if (allLocked) {
    tools = (
      <Tool
        icon={Unlock}
        label="Desbloquear"
        showLabel
        testId="bar-unlock"
        onClick={() =>
          dispatch({ type: 'updateMany', changes: layers.map((l) => ({ id: l.id, patch: { locked: false } })) })
        }
      />
    );
  } else if (!single) {
    const grouped = layers.some((layer) => layer.groupId);
    tools = (
      <>
        <Tool icon={Group} label="Agrupar" showLabel testId="bar-group" onClick={() => dispatch({ type: 'group' })} />
        {grouped && (
          <Tool
            icon={Ungroup}
            label="Desagrupar"
            showLabel
            testId="bar-ungroup"
            onClick={() => dispatch({ type: 'ungroup' })}
          />
        )}
      </>
    );
  } else if (isEmptyFrame(single)) {
    tools = (
      <Tool
        icon={ImagePlus}
        label="Poner foto"
        showLabel="always"
        testId="bar-place-photo"
        onClick={() => onPickPhoto(single.id)}
      />
    );
  } else if (single.type === 'image') {
    tools = (
      <>
        <Tool
          icon={Replace}
          label="Sustituir"
          // En el móvil, solo el icono: con el texto, «⋯» ya no cabía a la vista.
          showLabel
          title="Sustituir la foto (se conservan el marco y los efectos)"
          testId="bar-replace-photo"
          onClick={() => onPickPhoto(single.id)}
        />
        {onEditPhoto && (
          <Tool icon={SlidersHorizontal} label="Editar foto" showLabel testId="bar-edit-photo" onClick={onEditPhoto} />
        )}
        {onCropPhoto && <Tool icon={Crop} label="Recortar" testId="bar-crop" onClick={onCropPhoto} />}
        {onRemoveBackground && (
          <Tool icon={Eraser} label="Quitar fondo" testId="bar-cutout" onClick={onRemoveBackground} />
        )}
      </>
    );
  } else if (single.type === 'text') {
    tools = (
      <TextTools
        layer={single}
        brandStyle={brandStyle}
        update={update}
        checkpoint={checkpoint}
        onEditText={onEditText}
      />
    );
  } else if (single.type === 'shape') {
    tools = <ShapeTools layer={single} brandStyle={brandStyle} update={update} checkpoint={checkpoint} />;
  }

  return (
    <div
      role="toolbar"
      // «rápidas»: el panel «Diseño» tiene su propia barra «Acciones de …» y no deben llamarse igual.
      aria-label={`Acciones rápidas de ${name}`}
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-surface p-1 shadow-pop [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      // Un clic en la barra no es un clic en el margen del lienzo (que quitaría la selección).
      onPointerDown={(event) => event.stopPropagation()}
      data-testid="selection-toolbar"
    >
      {tools}
      {tools && !allLocked && <Divider />}
      {!allLocked && (
        <>
          <Tool
            icon={CopyPlus}
            label="Duplicar"
            title="Duplicar (Ctrl+D)"
            // Con un texto elegido la barra va llena: en el móvil, duplicar queda en «⋯».
            wideOnly={single?.type === 'text'}
            testId="bar-duplicate"
            onClick={() => dispatch({ type: 'duplicateSelection' })}
          />
          <Tool
            icon={Trash2}
            label="Borrar"
            title="Borrar (Supr)"
            danger
            testId="bar-delete"
            onClick={() => dispatch({ type: 'removeSelection' })}
          />
        </>
      )}
      <MoreMenu items={menu} label="Más acciones" testId="bar-more" size="sm" />
    </div>
  );
}
