import { ChevronRight, Folder, FolderOpen, Images, Inbox, Sparkles } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Select } from '@/components/ui';
import { cn } from '@/lib/utils';
import { MADE_HERE_LABEL } from './filters';
import { flattenTree, type FolderNode } from './folders';

/** Tipo con el que se arrastran archivos de la rejilla hacia una carpeta. */
export const DRAG_ASSETS = 'application/x-rrss-assets';

export interface FolderTreeProps {
  tree: FolderNode[];
  /** Todos los archivos de la marca. */
  total: number;
  /** Los que no están en ninguna carpeta. */
  unfiled: number;
  /** `null` = toda la biblioteca; `''` = sin carpeta. */
  selected: string | null;
  onSelect: (folder: string | null) => void;
  /** Quien edita puede soltar archivos (de la rejilla o del ordenador) sobre una carpeta. */
  canDrop: boolean;
  onDropAssets: (folder: string, ids: string[]) => void;
  onDropFiles: (folder: string, files: File[]) => void;
  /**
   * «Hechas aquí»: las carpetas que llena la aplicación (Ediciones, Exportaciones, IA, Reels,
   * Informes). Van al final, plegadas en un grupo; las exportaciones no cuentan en «Toda la biblioteca».
   */
  madeHere?: FolderNode[];
}

const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files');
const isAssetDrag = (event: DragEvent) => event.dataTransfer.types.includes(DRAG_ASSETS);

/** Destino de soltado: resalta mientras se pasa por encima y avisa de qué se soltó. */
function useDropTarget(
  enabled: boolean,
  folder: string,
  onDropAssets: FolderTreeProps['onDropAssets'],
  onDropFiles: FolderTreeProps['onDropFiles'],
) {
  const [over, setOver] = useState(false);
  if (!enabled) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (!isAssetDrag(event) && !isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = isAssetDrag(event) ? 'move' : 'copy';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        setOver(false);
        if (isAssetDrag(event)) {
          event.preventDefault();
          event.stopPropagation();
          try {
            const ids = JSON.parse(event.dataTransfer.getData(DRAG_ASSETS)) as unknown;
            if (Array.isArray(ids)) onDropAssets(folder, ids.filter((id): id is string => typeof id === 'string'));
          } catch {
            // Un arrastre que no es nuestro: se ignora.
          }
        } else if (isFileDrag(event)) {
          event.preventDefault();
          event.stopPropagation();
          onDropFiles(folder, Array.from(event.dataTransfer.files));
        }
      },
    },
  };
}

function Row({
  label,
  count,
  active,
  depth = 0,
  icon,
  expandable,
  expanded,
  onToggle,
  onSelect,
  folder,
  testId,
  ...drop
}: {
  label: string;
  count: number;
  active: boolean;
  depth?: number;
  icon: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  /** Ruta a la que se suelta (`null`: la fila no recibe archivos). */
  folder: string | null;
  testId: string;
} & Pick<FolderTreeProps, 'canDrop' | 'onDropAssets' | 'onDropFiles'>) {
  const target = useDropTarget(drop.canDrop && folder !== null, folder ?? '', drop.onDropAssets, drop.onDropFiles);
  return (
    <div
      className={cn(
        'group flex min-h-[2.25rem] items-center rounded-lg text-sm transition-colors',
        active ? 'bg-primary-soft font-semibold text-primary' : 'hover:bg-subtle',
        target.over && 'ring-2 ring-primary',
      )}
      style={{ paddingLeft: `${depth * 0.875}rem` }}
      {...target.handlers}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${expanded ? 'Plegar' : 'Desplegar'} ${label}`}
          className="flex h-8 w-6 shrink-0 items-center justify-center text-muted hover:text-fg"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} aria-hidden />
        </button>
      ) : (
        <span className="w-6 shrink-0" aria-hidden />
      )}
      <button
        type="button"
        role="treeitem"
        aria-selected={active}
        aria-expanded={expandable ? expanded : undefined}
        onClick={onSelect}
        data-testid={testId}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="shrink-0 text-muted" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted">{count}</span>
      </button>
    </div>
  );
}

/** ¿Está `path` dentro de `ancestor` (o es ella)? */
const within = (path: string | null, ancestor: string) =>
  path !== null && (path === ancestor || path.startsWith(`${ancestor} / `));

/**
 * Barra lateral de carpetas (escritorio): las de primer nivel, plegadas (sus subcarpetas se ven al
 * entrar o al desplegarlas), y al final «Hechas aquí» con lo que guarda la aplicación (Ediciones,
 * Exportaciones, IA…). Admite soltar archivos encima.
 */
export function FolderTree(props: FolderTreeProps) {
  const { tree, total, unfiled, selected, onSelect, canDrop, onDropAssets, onDropFiles, madeHere = [] } = props;
  // Desplegadas a mano; por defecto todo plegado salvo el camino hasta la carpeta elegida.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [madeHereOpen, setMadeHereOpen] = useState(false);
  const toggle = (path: string, open: boolean) =>
    setOpened((current) => {
      const next = new Set(current);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
  const common = { canDrop, onDropAssets, onDropFiles };
  const madeHereTotal = madeHere.reduce((sum, n) => sum + n.total, 0);
  const inMadeHere = madeHere.some((n) => within(selected, n.path));

  const renderNode = (node: FolderNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = opened.has(node.path) || (within(selected, node.path) && selected !== node.path) || selected === node.path;
    const active = selected === node.path;
    return (
      <li key={node.path} role="none">
        <Row
          {...common}
          label={node.name}
          count={node.total}
          active={active}
          depth={node.depth}
          icon={active ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
          expandable={hasChildren}
          expanded={isOpen}
          onToggle={() => toggle(node.path, isOpen)}
          onSelect={() => onSelect(node.path)}
          folder={node.path}
          testId={`library-folder-${node.path}`}
        />
        {hasChildren && isOpen && (
          <ul role="group" className="space-y-0.5">
            {node.children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav aria-label="Carpetas" className="flex min-h-0 flex-col" data-testid="library-folders">
      <ul role="tree" aria-label="Carpetas de la biblioteca" className="min-h-0 space-y-0.5 overflow-y-auto pr-1">
        <li role="none">
          <Row
            {...common}
            label="Toda la biblioteca"
            count={total}
            active={selected === null}
            icon={<Images className="h-4 w-4" />}
            onSelect={() => onSelect(null)}
            folder={null}
            testId="library-folder-all"
          />
        </li>
        {unfiled > 0 && tree.length > 0 && (
          <li role="none">
            <Row
              {...common}
              label="Sin carpeta"
              count={unfiled}
              active={selected === ''}
              icon={<Inbox className="h-4 w-4" />}
              onSelect={() => onSelect('')}
              folder=""
              testId="library-folder-none"
            />
          </li>
        )}
        {tree.map(renderNode)}
        {madeHere.length > 0 && (
          <li role="none" className="mt-2 border-t border-border pt-2" data-testid="library-made-here">
            <button
              type="button"
              role="treeitem"
              aria-expanded={madeHereOpen || inMadeHere}
              aria-selected={false}
              onClick={() => setMadeHereOpen((v) => !v)}
              className="flex min-h-[2.25rem] w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              data-testid="library-made-here-toggle"
            >
              <ChevronRight
                className={cn('ml-1.5 h-3.5 w-3.5 text-muted transition-transform', (madeHereOpen || inMadeHere) && 'rotate-90')}
                aria-hidden
              />
              <Sparkles className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{MADE_HERE_LABEL}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">{madeHereTotal}</span>
            </button>
            {(madeHereOpen || inMadeHere) && (
              <ul role="group" aria-label={MADE_HERE_LABEL} className="space-y-0.5 pl-3.5">
                {madeHere.map(renderNode)}
              </ul>
            )}
          </li>
        )}
      </ul>
    </nav>
  );
}

/** Selector «Carpeta» para pantallas estrechas (en lugar de la barra lateral). */
export function FolderSelect({
  tree,
  total,
  unfiled,
  selected,
  onSelect,
  madeHere = [],
}: Pick<FolderTreeProps, 'tree' | 'total' | 'unfiled' | 'selected' | 'onSelect' | 'madeHere'>) {
  const option = (node: FolderNode) => (
    <option key={node.path} value={node.path}>
      {`${' '.repeat(node.depth)}${node.name} (${node.total})`}
    </option>
  );
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="shrink-0 text-muted">Carpeta</span>
      <Select
        aria-label="Carpeta"
        value={selected === null ? '__all' : selected === '' ? '__none' : selected}
        onChange={(e) => {
          const v = e.target.value;
          onSelect(v === '__all' ? null : v === '__none' ? '' : v);
        }}
        data-testid="library-folder-select"
      >
        <option value="__all">{`Toda la biblioteca (${total})`}</option>
        {unfiled > 0 && tree.length > 0 && <option value="__none">{`Sin carpeta (${unfiled})`}</option>}
        {flattenTree(tree).map(option)}
        {madeHere.length > 0 && <optgroup label={MADE_HERE_LABEL}>{flattenTree(madeHere).map(option)}</optgroup>}
      </Select>
    </label>
  );
}
