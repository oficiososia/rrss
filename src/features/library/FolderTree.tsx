import { ChevronRight, Folder, FolderOpen, Images, Inbox } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Select } from '@/components/ui';
import { cn } from '@/lib/utils';
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
   * «Exportaciones» (las imágenes que guarda el editor al descargar o programar): va aparte, al
   * final, y no cuenta en «Toda la biblioteca».
   */
  exportsNode?: FolderNode | null;
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

/** Barra lateral de carpetas (escritorio): árbol con contadores; admite soltar archivos encima. */
export function FolderTree(props: FolderTreeProps) {
  const { tree, total, unfiled, selected, onSelect, canDrop, onDropAssets, onDropFiles, exportsNode } = props;
  // Plegadas a mano; por defecto todo está desplegado.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const common = { canDrop, onDropAssets, onDropFiles };

  const renderNode = (node: FolderNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = !collapsed.has(node.path);
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
          onToggle={() => toggle(node.path)}
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
        {exportsNode && (
          <li role="none" className="mt-2 border-t border-border pt-2" data-testid="library-exports-group">
            <p className="px-2 pb-1 text-xs text-muted" aria-hidden>
              Aparte: lo que exporta el editor
            </p>
            <ul role="group" aria-label="Aparte" className="space-y-0.5">
              {renderNode(exportsNode)}
            </ul>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** Selector de carpeta para pantallas estrechas (en lugar de la barra lateral). */
export function FolderSelect({
  tree,
  total,
  unfiled,
  selected,
  onSelect,
  exportsNode,
}: Pick<FolderTreeProps, 'tree' | 'total' | 'unfiled' | 'selected' | 'onSelect' | 'exportsNode'>) {
  return (
    <Select
      aria-label="Filtrar por carpeta"
      value={selected === null ? '__all' : selected === '' ? '__none' : selected}
      onChange={(e) => {
        const v = e.target.value;
        onSelect(v === '__all' ? null : v === '__none' ? '' : v);
      }}
      data-testid="library-folder-select"
    >
      <option value="__all">{`Toda la biblioteca (${total})`}</option>
      {unfiled > 0 && tree.length > 0 && <option value="__none">{`Sin carpeta (${unfiled})`}</option>}
      {flattenTree(tree).map((node) => (
        <option key={node.path} value={node.path}>
          {`${' '.repeat(node.depth)}${node.name} (${node.total})`}
        </option>
      ))}
      {exportsNode && (
        <optgroup label="Aparte: lo que exporta el editor">
          {flattenTree([exportsNode]).map((node) => (
            <option key={node.path} value={node.path}>
              {`${' '.repeat(node.depth)}${node.name} (${node.total})`}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
