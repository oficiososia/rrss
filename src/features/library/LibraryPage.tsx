import {
  ArrowDownAZ,
  CheckSquare,
  Clapperboard,
  Clock,
  Download,
  EyeOff,
  FilterX,
  Flame,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
  FolderInput,
  FolderPen,
  FolderPlus,
  FolderX,
  HardDrive,
  Images,
  Search,
  Tag,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import { usageWarning } from './usageText';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  type MoreMenuItem,
} from '@/components/ui';
import { mediaWorkerEnabled } from '@/config/app';
import { useDriveConnections } from '@/features/drive/api';
import { DriveImportDialog } from '@/features/drive/DriveImportDialog';
import { useBrand, useOrg } from '@/features/orgs/context';
import { useFeature } from '@/features/platform/integrations/useFeature';
import { useWorkspaceMode } from '@/layout/workspace';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { previewPath, useAssetFacets, useAssetsByIds, useSignedUrls } from './api';
import { AssetGrid, GRID_BATCH } from './AssetGrid';
import { AssetPanel } from './AssetPanel';
import {
  downloadUrls,
  useAllAssets,
  useAssetUsage,
  useEmptyFolders,
  useLibraryMutations,
} from './catalog';
import {
  applyFilters,
  EXPORTS_FOLDER,
  GENERATED_FOLDERS,
  isExport,
  KIND_TABS,
  MADE_HERE_LABEL,
  countByFolder,
  EMPTY_FILTERS,
  idsBetween,
  SORT_LABEL,
  type ChipId,
  type KindTab,
  type SortKey,
} from './filters';
import { FolderNameDialog, MoveDialog, TagDialog } from './LibraryDialogs';
import { FolderSelect, FolderTree } from './FolderTree';
import {
  breadcrumbs,
  buildFolderTree,
  flattenTree,
  isInside,
  joinFolder,
  folderParent,
  renameProblem,
  renamedPath,
  type FolderNode,
} from './folders';
import { UploadPanel, type IncomingFiles } from './UploadPanel';

const TILE_KEY = 'rrss.library.tile';
const TILE_MIN = 96;
const TILE_MAX = 280;
const TILE_DEFAULT = 160;
const TILE_STEP = 40;
const NO_USAGE: ReadonlyMap<string, number> = new Map();

function readTile(): number {
  try {
    const value = Number(localStorage.getItem(TILE_KEY));
    return value >= TILE_MIN && value <= TILE_MAX ? value : TILE_DEFAULT;
  } catch {
    return TILE_DEFAULT;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

export function LibraryPage() {
  useWorkspaceMode();
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const canEdit = can('edit');
  const navigate = useNavigate();
  // Google Drive: solo si el entorno lo tiene, el servidor está configurado y la
  // organización tiene una conexión activa.
  const driveConfigured = useFeature('drive');
  const driveConnections = useDriveConnections(org.id, driveConfigured && canEdit);
  const canUseDrive = driveConfigured && canEdit && (driveConnections.data ?? []).some((c) => c.status === 'active');
  const [drivePicking, setDrivePicking] = useState(false);

  // ── Datos ──
  const everything = useAllAssets(brand.id);
  const usageQuery = useAssetUsage(brand.id);
  const facets = useAssetFacets(brand.id);
  const mutations = useLibraryMutations(brand.id);
  const empty = useEmptyFolders(brand.id);
  const all = useMemo(() => everything.data?.rows ?? [], [everything.data]);
  const usageCounts = usageQuery.data?.counts;
  const usageKnown = Boolean(usageQuery.data);

  // ── Filtros ──
  const [folder, setFolder] = useState<string | null>(EMPTY_FILTERS.folder);
  // Simplificación B1: una ficha de tipo (Todo, Fotos, Vídeos, Audios) y, desde «⋯», «solo sin usar».
  const [kind, setKind] = useState<KindTab>('all');
  const [onlyUnused, setOnlyUnused] = useState(false);
  const chips = useMemo<ReadonlySet<ChipId>>(() => {
    const next = new Set<ChipId>();
    if (kind !== 'all') next.add(kind);
    if (onlyUnused) next.add('unused');
    return next;
  }, [kind, onlyUnused]);
  const [choosingTag, setChoosingTag] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [tag, setTag] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('date');
  const deferredSearch = useDeferredValue(search);
  const effectiveChips = useMemo(() => {
    if (usageKnown || !chips.has('unused')) return chips;
    const next = new Set(chips);
    next.delete('unused');
    return next;
  }, [chips, usageKnown]);
  const effectiveSort: SortKey = sort === 'usage' && !usageKnown ? 'date' : sort;
  const filters = useMemo(
    () => ({ folder, chips: effectiveChips, tag, search: deferredSearch, sort: effectiveSort }),
    [folder, effectiveChips, tag, deferredSearch, effectiveSort],
  );
  const rows = useMemo(() => applyFilters(all, filters, usageCounts ?? NO_USAGE), [all, filters, usageCounts]);
  const filtering = Boolean(folder !== null || chips.size || tag || deferredSearch.trim());

  // ── Carpetas ──
  const counts = useMemo(() => countByFolder(all), [all]);
  const fullTree = useMemo(() => buildFolderTree(counts, empty.folders), [counts, empty.folders]);
  // «Hechas aquí» (B3): las carpetas que llena la aplicación van juntas, al final y plegadas.
  // «Exportaciones» además no cuenta en «Toda la biblioteca».
  const tree = useMemo(() => fullTree.filter((n) => !GENERATED_FOLDERS.includes(n.path)), [fullTree]);
  const madeHere = useMemo(() => fullTree.filter((n) => GENERATED_FOLDERS.includes(n.path)), [fullTree]);
  const exportsNode = useMemo(() => fullTree.find((n) => n.path === EXPORTS_FOLDER) ?? null, [fullTree]);
  const libraryTotal = useMemo(() => all.filter((a) => !isExport(a)).length, [all]);
  const flat = useMemo(() => flattenTree(fullTree), [fullTree]);
  const folderPaths = useMemo(() => flat.map((n) => n.path), [flat]);
  const unfiled = counts.get('') ?? 0;
  const currentNode: FolderNode | undefined = folder ? flat.find((n) => n.path === folder) : undefined;
  const uploadFolder = folder ?? '';

  // ── Rejilla: miniaturas por tandas ──
  const [tile, setTile] = useState(readTile);
  // Cuántas miniaturas se pintan: vuelven a las primeras al cambiar de carpeta, filtro u orden.
  const viewKey = `${folder}|${[...chips].join(',')}|${tag}|${deferredSearch}|${sort}`;
  const [shown, setShown] = useState({ key: viewKey, count: GRID_BATCH });
  const visible = shown.key === viewKey ? shown.count : GRID_BATCH;
  const showAtLeast = useCallback(
    (count: number) => setShown((s) => ({ key: viewKey, count: Math.max(s.key === viewKey ? s.count : GRID_BATCH, count) })),
    [viewKey],
  );
  const showMore = useCallback(
    () => setShown((s) => ({ key: viewKey, count: (s.key === viewKey ? s.count : GRID_BATCH) + GRID_BATCH })),
    [viewKey],
  );
  const previewPaths = useMemo(
    () =>
      rows
        .slice(0, visible)
        .filter((a) => a.mime_type.startsWith('image/'))
        .map(previewPath),
    [rows, visible],
  );
  // Miniaturas (las de Drive, la miniatura de Google); la ficha pide el archivo entero.
  const urls = useSignedUrls(previewPaths, { variant: 'thumb' });

  // ── Selección ──
  const [pickedIds, setPickedIds] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const order = useMemo(() => rows.map((a) => a.id), [rows]);
  // Lo que ya no está en la lista (borrado, filtrado) deja de estar elegido.
  const selection = useMemo(() => {
    const present = new Set(order);
    return new Set([...pickedIds].filter((id) => present.has(id)));
  }, [pickedIds, order]);
  const select = useCallback(
    (id: string, mode: 'toggle' | 'range') => {
      const from = anchor.current;
      setPickedIds((current) => {
        const next = new Set(current);
        if (mode === 'range' && from && from !== id) {
          for (const between of idsBetween(order, from, id)) next.add(between);
        } else if (!next.delete(id)) next.add(id);
        return next;
      });
      anchor.current = id;
    },
    [order],
  );
  const clearSelection = useCallback(() => {
    setPickedIds(new Set());
    setSelectMode(false);
    anchor.current = null;
  }, []);

  // ── Ficha ──
  // `?recurso=<id>` abre ese archivo (lo usa «Abrir en la biblioteca» desde Reels).
  const [searchParams, setSearchParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get('recurso'));
  const closePanel = useCallback(() => {
    setOpenId(null);
    setSearchParams((current) => {
      if (!current.has('recurso')) return current;
      const next = new URLSearchParams(current);
      next.delete('recurso');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const inAll = all.some((a) => a.id === openId);
  // Un archivo que aún no está en la lista (p. ej. un recorte recién hecho) se lee aparte.
  const outside = useAssetsByIds(brand.id, openId && !everything.isPending && !inAll ? [openId] : []);
  const opened = all.find((a) => a.id === openId) ?? outside.data?.find((a) => a.id === openId) ?? null;
  const openedUrls = useSignedUrls(useMemo(() => (opened ? [opened.storage_path] : []), [opened]));
  const openedUrl = opened ? (openedUrls.data?.get(opened.storage_path) ?? urls.data?.get(opened.storage_path)) : undefined;
  const openedIndex = openId ? order.indexOf(openId) : -1;
  const goTo = (index: number) => {
    const id = order[index];
    if (!id) return;
    setOpenId(id);
    showAtLeast(index + GRID_BATCH / 2);
  };
  useEffect(() => {
    if (!openId) return;
    document.querySelector('[data-testid="library-grid"] [aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [openId]);

  // Esc quita la selección si no hay ficha abierta.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openId || selection.size === 0 || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, selection.size, clearSelection]);

  // ── Subida ──
  const [uploading, setUploading] = useState(false);
  const [incoming, setIncoming] = useState<IncomingFiles | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const uploadKey = useRef(0);
  const receiveFiles = useCallback(
    (target: string, files: File[]) => {
      if (!canEdit || files.length === 0) return;
      setUploading(true);
      setIncoming({ key: ++uploadKey.current, files, folder: target });
    },
    [canEdit],
  );

  // ── Acciones ──
  const [moving, setMoving] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const chosen = useMemo(() => rows.filter((a) => selection.has(a.id)), [rows, selection]);

  const moveTo = (ids: string[], target: string) => {
    if (ids.length === 0) return;
    mutations.move.mutate(
      { ids, folder: target },
      {
        onSuccess: () => {
          toast.success(`${plural(ids.length, 'archivo movido', 'archivos movidos')} a ${target ? `«${target}»` : 'ninguna carpeta'}`);
          if (target) empty.save(empty.folders.filter((f) => f !== target));
          setMoving(false);
          clearSelection();
        },
        onError: (e) => toast.error(translateError(e)),
      },
    );
  };

  const download = async () => {
    if (chosen.length > 20) {
      toast.error('Para descargar, elige 20 archivos o menos de una vez.');
      return;
    }
    try {
      const links = await downloadUrls(chosen);
      if (links.length === 0) throw new Error('No se han podido preparar las descargas.');
      links.forEach((href, i) =>
        window.setTimeout(() => {
          const a = document.createElement('a');
          a.href = href;
          a.rel = 'noreferrer';
          a.download = '';
          document.body.append(a);
          a.click();
          a.remove();
        }, i * 350),
      );
      if (links.length < chosen.length) toast.warning(`Se han preparado ${links.length} de ${chosen.length}.`);
    } catch (e) {
      toast.error(translateError(e));
    }
  };

  const usedInChosen = chosen.filter((a) => (usageCounts?.get(a.id) ?? 0) > 0).length;
  // Qué piezas se quedan con un hueco (las tres primeras y «y N más»).
  const chosenUsage = useMemo(
    () => usageWarning(chosen.flatMap((a) => usageQuery.data?.byAsset.get(a.id) ?? []), chosen.length),
    [chosen, usageQuery.data],
  );

  const createFolder = (name: string) => {
    const path = joinFolder(folder ?? '', name);
    if (!empty.folders.includes(path) && !counts.has(path)) empty.save([...empty.folders, path]);
    setCreatingFolder(false);
    setFolder(path);
    clearSelection();
  };

  const renameFolder = (cleaned: string) => {
    if (!folder) return;
    const to = joinFolder(folderParent(folder), cleaned);
    const affected = [...new Set([...counts.keys(), ...empty.folders])].filter((p) => isInside(p, folder));
    const renames = affected.map((from) => ({ from, to: renamedPath(from, folder, to) }));
    mutations.renameFolder.mutate(
      renames.filter((r) => (counts.get(r.from) ?? 0) > 0),
      {
        onSuccess: () => {
          empty.save(empty.folders.map((f) => renamedPath(f, folder, to)));
          setRenamingFolder(false);
          setFolder(to);
          toast.success('Carpeta renombrada');
        },
        onError: (e) => toast.error(translateError(e)),
      },
    );
  };

  const removeEmptyFolder = () => {
    if (!folder || (currentNode?.total ?? 0) > 0) return;
    empty.save(empty.folders.filter((f) => !isInside(f, folder)));
    setFolder(folderParent(folder) || null);
    toast.success('Carpeta eliminada');
  };

  const folderMenu: MoreMenuItem[] = canEdit
    ? [
        { id: 'new', label: folder ? 'Nueva carpeta dentro de esta' : 'Nueva carpeta', icon: FolderPlus, onSelect: () => setCreatingFolder(true), testId: 'folder-new' },
        folder
          ? { id: 'rename', label: 'Renombrar esta carpeta', icon: FolderPen, onSelect: () => setRenamingFolder(true), testId: 'folder-rename' }
          : null,
        folder
          ? {
              id: 'delete',
              label: 'Eliminar esta carpeta',
              icon: FolderX,
              destructive: true,
              disabled: (currentNode?.total ?? 0) > 0,
              hint: (currentNode?.total ?? 0) > 0 ? 'Solo se pueden eliminar carpetas vacías: mueve antes sus archivos.' : undefined,
              onSelect: removeEmptyFolder,
              testId: 'folder-delete',
            }
          : null,
      ]
    : [];

  const crumbs = folder ? breadcrumbs(folder) : [];
  const resetFilters = () => {
    setFolder(null);
    setKind('all');
    setOnlyUnused(false);
    setTag('');
    setSearch('');
  };
  const saveTile = (value: number) => {
    const next = Math.min(TILE_MAX, Math.max(TILE_MIN, value));
    setTile(next);
    try {
      localStorage.setItem(TILE_KEY, String(next));
    } catch {
      // Sin almacenamiento, el tamaño vale solo para esta visita.
    }
  };
  const pickFolder = (next: string | null) => {
    setFolder(next);
    clearSelection();
  };

  const onPageDragOver = (event: DragEvent) => {
    if (!canEdit || !hasFiles(event)) return;
    event.preventDefault();
    setFileDrag(true);
  };
  const onPageDrop = (event: DragEvent) => {
    if (!canEdit || !hasFiles(event)) return;
    event.preventDefault();
    setFileDrag(false);
    receiveFiles(uploadFolder, Array.from(event.dataTransfer.files));
  };

  const sortItem = (key: SortKey, icon: LucideIcon): MoreMenuItem =>
    key === 'usage' && !usageKnown
      ? null
      : {
          id: `sort-${key}`,
          label: `${effectiveSort === key ? '✓ ' : ''}Ordenar: ${SORT_LABEL[key].toLowerCase()}`,
          icon,
          onSelect: () => setSort(key),
          testId: `library-sort-${key}`,
        };
  const headerMore: MoreMenuItem[] = [
    sortItem('date', Clock),
    sortItem('name', ArrowDownAZ),
    sortItem('usage', Flame),
    null,
    facets.data?.tags.length
      ? {
          id: 'tag',
          label: tag ? `Etiqueta: ${tag}` : 'Filtrar por etiqueta…',
          icon: Tag,
          onSelect: () => setChoosingTag(true),
          testId: 'library-tag-filter',
        }
      : null,
    usageKnown
      ? {
          id: 'unused',
          label: onlyUnused ? 'Ver también las que se usan' : 'Solo las que no se usan',
          icon: EyeOff,
          onSelect: () => setOnlyUnused((v) => !v),
          testId: 'library-unused',
        }
      : null,
    tile < TILE_MAX
      ? { id: 'bigger', label: 'Miniaturas más grandes', icon: ZoomIn, onSelect: () => saveTile(tile + TILE_STEP), testId: 'library-tile-bigger' }
      : null,
    tile > TILE_MIN
      ? { id: 'smaller', label: 'Miniaturas más pequeñas', icon: ZoomOut, onSelect: () => saveTile(tile - TILE_STEP), testId: 'library-tile-smaller' }
      : null,
    null,
    canEdit && !selectMode
      ? { id: 'select', label: 'Elegir varias', icon: CheckSquare, onSelect: () => setSelectMode(true), testId: 'library-select-mode' }
      : null,
    null,
    ...folderMenu,
    null,
    canEdit && canUseDrive
      ? { id: 'drive', label: 'Traer de Google Drive', icon: HardDrive, onSelect: () => setDrivePicking(true), testId: 'library-drive' }
      : null,
    canEdit && mediaWorkerEnabled()
      ? { id: 'reels', label: 'Montar un reel', icon: Clapperboard, onSelect: () => navigate('reels'), testId: 'library-reels' }
      : null,
  ];

  const selecting = selection.size > 0;
  const stopSelecting = clearSelection;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-3"
      onDragOver={onPageDragOver}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setFileDrag(false);
      }}
      onDrop={onPageDrop}
    >
      <PageHeader
        compact
        title="Biblioteca"
        meta={
          <span role="status" data-testid="library-count">
            {everything.isPending
              ? 'Cargando…'
              : filtering
                ? `${plural(rows.length, 'archivo', 'archivos')} de ${libraryTotal}`
                : plural(libraryTotal, 'archivo', 'archivos')}
          </span>
        }
        action={
          canEdit && (
            <Button onClick={() => setUploading((v) => !v)} aria-expanded={uploading} data-testid="library-upload-toggle">
              <Upload className="h-4 w-4" aria-hidden />
              {uploading ? 'Ocultar subida' : 'Subir archivos'}
            </Button>
          )
        }
        more={headerMore}
        moreTestId="library-more"
      />

      {canEdit && uploading && (
        <div className="max-h-[45dvh] shrink-0 overflow-y-auto">
          <UploadPanel organizationId={org.id} brandId={brand.id} folder={uploadFolder} incoming={incoming} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Escritorio: árbol de carpetas */}
        <aside className="hidden w-60 shrink-0 flex-col gap-2 lg:flex" aria-label="Carpetas">
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreatingFolder(true)}
              className="justify-start"
              data-testid="library-new-folder"
            >
              <FolderPlus className="h-4 w-4" aria-hidden />
              Nueva carpeta
            </Button>
          )}
          <FolderTree
            tree={tree}
            total={libraryTotal}
            unfiled={unfiled}
            madeHere={madeHere}
            selected={folder}
            onSelect={pickFolder}
            canDrop={canEdit}
            onDropAssets={(target, ids) => moveTo(ids, target)}
            onDropFiles={receiveFiles}
          />
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2" aria-label="Archivos">
          {/* Móvil: selector de carpeta */}
          <div className="lg:hidden">
            <FolderSelect
              tree={tree}
              total={libraryTotal}
              unfiled={unfiled}
              selected={folder}
              onSelect={pickFolder}
              madeHere={madeHere}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[11rem] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                type="search"
                aria-label="Buscar por nombre, etiqueta o carpeta"
                placeholder="Buscar por nombre, etiqueta o carpeta"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="library-search"
              />
            </div>
          </div>

          {selecting ? (
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl bg-primary-soft px-3 py-1.5"
              role="toolbar"
              aria-label="Acciones para lo elegido"
              data-testid="library-selection-bar"
            >
              <p className="mr-auto text-sm font-medium text-primary" role="status">
                {plural(selection.size, 'elegido', 'elegidos')}
              </p>
              <Button size="sm" variant="secondary" onClick={() => setMoving(true)} data-testid="bulk-move">
                <FolderInput className="h-4 w-4" aria-hidden />
                Mover a…
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setTagging(true)} data-testid="bulk-tag">
                <Tag className="h-4 w-4" aria-hidden />
                Etiquetar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void download()} data-testid="bulk-download">
                <Download className="h-4 w-4" aria-hidden />
                Descargar
              </Button>
              <Button size="sm" variant="secondary" className="text-danger" onClick={() => setDeleting(true)} data-testid="bulk-delete">
                <Trash2 className="h-4 w-4" aria-hidden />
                Eliminar
              </Button>
              <Button size="icon" variant="ghost" onClick={stopSelecting} aria-label="Quitar la selección" title="Quitar la selección (Esc)">
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1.5" role="group" aria-label="Tipo de archivo" data-testid="library-chips">
                {KIND_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={kind === tab.id}
                    onClick={() => setKind(tab.id)}
                    data-testid={`library-kind-${tab.id}`}
                    className={cn(
                      'min-h-[2.25rem] shrink-0 rounded-full border px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                      kind === tab.id
                        ? 'border-primary bg-primary-soft font-medium text-primary'
                        : 'border-border bg-surface hover:bg-subtle',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {(tag || onlyUnused) && (
                <button
                  type="button"
                  onClick={() => {
                    setTag('');
                    setOnlyUnused(false);
                  }}
                  className="inline-flex min-h-[2.25rem] items-center gap-1 rounded-full bg-primary-soft px-3 text-sm text-primary"
                  data-testid="library-extra-filters"
                >
                  {[tag && `Etiqueta: ${tag}`, onlyUnused && 'Sin usar'].filter(Boolean).join(' · ')}
                  <X className="h-3.5 w-3.5" aria-label="Quitar" />
                </button>
              )}
              {selectMode && !selecting && (
                <span className="flex items-center gap-2 text-sm text-muted" data-testid="library-select-hint">
                  Toca las que quieras
                  <Button size="sm" variant="ghost" onClick={stopSelecting}>
                    Cancelar
                  </Button>
                </span>
              )}
            </div>
          )}

          {folder !== null && (
            <div className="flex items-center justify-between gap-2" data-testid="library-breadcrumbs">
              <nav aria-label="Dónde estás" className="min-w-0 truncate text-sm">
                <ol className="flex min-w-0 items-center gap-1 text-muted">
                  <li>
                    <button
                      type="button"
                      onClick={() => pickFolder(null)}
                      className={cn('rounded px-1 hover:underline', folder === null && 'font-semibold text-fg')}
                      aria-current={folder === null ? 'page' : undefined}
                    >
                      Toda la biblioteca
                    </button>
                  </li>
                  {folder === '' && (
                    <li className="flex items-center gap-1">
                      <span aria-hidden>›</span>
                      <span className="font-semibold text-fg" aria-current="page">
                        Sin carpeta
                      </span>
                    </li>
                  )}
                  {crumbs.map((crumb, i) => (
                    <li key={crumb.path} className="flex min-w-0 items-center gap-1">
                      <span aria-hidden>›</span>
                      <button
                        type="button"
                        onClick={() => pickFolder(crumb.path)}
                        aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                        className={cn('truncate rounded px-1 hover:underline', i === crumbs.length - 1 && 'font-semibold text-fg')}
                      >
                        {crumb.name}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
          )}

          {folder === null && exportsNode && (
            <p className="text-xs text-muted" data-testid="library-exports-hint">
              Las imágenes que exporta el editor no salen aquí ni al elegir fotos: están en «{MADE_HERE_LABEL}»,{' '}
              <button
                type="button"
                className="font-medium text-primary underline"
                onClick={() => pickFolder(EXPORTS_FOLDER)}
                data-testid="library-exports-open"
              >
                {EXPORTS_FOLDER} ({exportsNode.total})
              </button>
              .
            </p>
          )}

          {everything.data?.truncated && (
            <Notice tone="warning">
              Hay más de 5.000 archivos y aquí se ven los más recientes. Usa las carpetas y la búsqueda para llegar a los demás.
            </Notice>
          )}
          {usageQuery.isError && (
            <p className="text-xs text-muted" data-testid="library-usage-missing">
              No se ha podido saber en qué piezas se usa cada archivo; por eso no se puede ver «Solo las que no se usan» ni ordenar por uso.
            </p>
          )}

          <div className="relative flex min-h-0 flex-1 gap-4">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-2 pr-1" data-testid="library-scroll">
              {everything.isPending ? (
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${tile}px, 100%), 1fr))` }}
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <Skeleton key={i} className="aspect-square" />
                  ))}
                </div>
              ) : everything.isError ? (
                <Card>
                  <ErrorState error={everything.error} onRetry={() => void everything.refetch()} />
                </Card>
              ) : rows.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={Images}
                    title={filtering ? 'Nada coincide con los filtros' : 'La biblioteca está vacía'}
                    description={
                      filtering
                        ? 'Prueba con otra búsqueda o quita algún filtro.'
                        : canEdit
                          ? 'Sube las fotos, vídeos y logotipos de la marca, o suéltalos aquí, para tenerlos siempre a mano.'
                          : 'Todavía no se ha subido ningún archivo.'
                    }
                    action={
                      filtering ? (
                        <Button variant="secondary" onClick={resetFilters} data-testid="library-clear-filters">
                          <FilterX className="h-4 w-4" aria-hidden />
                          Quitar filtros
                        </Button>
                      ) : (
                        canEdit &&
                        !uploading && (
                          <Button onClick={() => setUploading(true)} data-testid="library-empty-upload">
                            <Upload className="h-4 w-4" aria-hidden />
                            Subir archivos
                          </Button>
                        )
                      )
                    }
                  />
                </Card>
              ) : (
                <AssetGrid
                  assets={rows}
                  urls={urls.data}
                  tile={tile}
                  selection={selection}
                  openId={openId}
                  canSelect={canEdit}
                  showChecks={selectMode || selecting}
                  onLongPress={(id: string) => {
                    setSelectMode(true);
                    select(id, 'toggle');
                  }}
                  canDrag={canEdit}
                  onOpen={setOpenId}
                  onSelect={select}
                  visible={visible}
                  onShowMore={showMore}
                />
              )}
            </div>

            {opened && (
              <AssetPanel
                key={opened.id}
                asset={opened}
                url={openedUrl}
                canEdit={canEdit}
                usage={usageQuery.data ? (usageQuery.data.byAsset.get(opened.id) ?? []) : undefined}
                folders={folderPaths}
                position={openedIndex >= 0 ? { index: openedIndex, total: order.length } : undefined}
                onPrev={openedIndex > 0 ? () => goTo(openedIndex - 1) : undefined}
                onNext={openedIndex >= 0 && openedIndex < order.length - 1 ? () => goTo(openedIndex + 1) : undefined}
                onClose={closePanel}
                onOpenAsset={setOpenId}
              />
            )}
          </div>
        </section>
      </div>

      {fileDrag && canEdit && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary-soft/80"
          data-testid="library-drop-overlay"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <UploadCloud className="h-5 w-5" aria-hidden />
            {uploadFolder ? `Suelta para subir a «${uploadFolder}»` : 'Suelta para subir a la biblioteca'}
          </p>
        </div>
      )}

      {canUseDrive && <DriveImportDialog brandId={brand.id} open={drivePicking} onOpenChange={setDrivePicking} />}

      {moving && (
        <MoveDialog
          open
          onOpenChange={setMoving}
          count={chosen.length}
          tree={tree}
          busy={mutations.move.isPending}
          onMove={(target) => moveTo(chosen.map((a) => a.id), target)}
        />
      )}
      {tagging && (
        <TagDialog
          open
          onOpenChange={setTagging}
          count={chosen.length}
          suggestions={facets.data?.tags ?? []}
          busy={mutations.addTags.isPending}
          onTag={(tags) =>
            mutations.addTags.mutate(
              { assets: chosen, tags },
              {
                onSuccess: () => {
                  toast.success(`Etiquetas añadidas a ${plural(chosen.length, 'archivo', 'archivos')}`);
                  setTagging(false);
                },
                onError: (e) => toast.error(translateError(e)),
              },
            )
          }
        />
      )}
      {choosingTag && (
        <Dialog
          open
          onOpenChange={setChoosingTag}
          title="Filtrar por etiqueta"
          footer={
            <Button variant="secondary" onClick={() => setChoosingTag(false)}>
              Hecho
            </Button>
          }
        >
          <Select
            aria-label="Etiqueta"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setChoosingTag(false);
            }}
            data-testid="library-tag-select"
          >
            <option value="">Todas las etiquetas</option>
            {facets.data?.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Dialog>
      )}
      {creatingFolder && (
        <FolderNameDialog
          open
          onOpenChange={setCreatingFolder}
          title="Nueva carpeta"
          description={folder ? `Se crea dentro de «${folder}».` : undefined}
          initial=""
          confirmLabel="Crear carpeta"
          problem={(name) => (flat.some((n) => n.path === joinFolder(folder ?? '', name)) ? 'Ya existe una carpeta con ese nombre.' : null)}
          busy={false}
          onConfirm={createFolder}
        />
      )}
      {renamingFolder && folder && (
        <FolderNameDialog
          open
          onOpenChange={setRenamingFolder}
          title="Renombrar carpeta"
          description="Las carpetas de dentro y sus archivos van con ella."
          initial={currentNode?.name ?? ''}
          confirmLabel="Renombrar"
          problem={(name) => renameProblem(folder, joinFolder(folderParent(folder), name), folderPaths)}
          busy={mutations.renameFolder.isPending}
          onConfirm={renameFolder}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`¿Eliminar ${plural(chosen.length, 'archivo', 'archivos')}?`}
        description={`Se borrarán de la biblioteca de forma definitiva. No se puede deshacer.${
          usedInChosen > 0
            ? ` ${plural(usedInChosen, 'está', 'están')} en alguna pieza. ${chosenUsage ?? ''}`
            : ''
        }`}
        confirmLabel="Eliminar"
        loading={mutations.removeMany.isPending}
        onConfirm={() =>
          mutations.removeMany.mutateAsync(chosen).then(
            (n) => {
              toast.success(`${plural(n, 'archivo eliminado', 'archivos eliminados')}`);
              setDeleting(false);
              clearSelection();
              if (openId && chosen.some((a) => a.id === openId)) closePanel();
            },
            (e: unknown) => {
              setDeleting(false);
              toast.error(translateError(e));
            },
          )
        }
      />
    </div>
  );
}
