import {
  Archive,
  ArchiveRestore,
  Eraser,
  FilterX,
  LayoutGrid,
  Lightbulb,
  List,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ActionNotice,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { useCampaigns } from '@/features/campaigns/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { ScheduleDialog } from '@/features/social/ScheduleDialog';
import { translateError } from '@/lib/errors';
import { readLocal, writeLocal } from '@/lib/localStore';
import { useContentMutations } from './api';
import { CreateContentDialog } from './CreateContentDialog';
import { contentPaths } from './labels';
import { ContentCard, ContentRow, type PieceActions } from './lista/ContentCard';
import { FeaturedTemplates } from './lista/FeaturedTemplates';
import { FORMAT_CARDS } from './lista/formats';
import { STAGES, type ContentStage } from './lista/stage';
import { useContentBoard, type BoardItem } from './lista/useContentBoard';
import { useContentThumbs } from './lista/useContentThumbs';
import type { BrandTemplate } from './templates/api';

const VIEW_KEY = 'rrss.contenidos.vista';
const PAGE = 24;

type ViewMode = 'grid' | 'list';
type Tab = ContentStage | 'all';

export function ContentListPage() {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const canEdit = can('edit');
  const paths = contentPaths(org.id, brand.id);
  const mutations = useContentMutations(org.id, brand.id);

  const [creating, setCreating] = useState(false);
  const [startTemplate, setStartTemplate] = useState<BrandTemplate | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [tabChoice, setTabChoice] = useState<ContentStage | null>(null);
  const [search, setSearch] = useState('');
  const [format, setFormat] = useState('');
  const [campaign, setCampaign] = useState('');
  const [view, setViewState] = useState<ViewMode>(() => (readLocal<string>(VIEW_KEY, 'grid') === 'list' ? 'list' : 'grid'));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [confirm, setConfirm] = useState<'selected' | 'empty' | null>(null);
  const [busy, setBusy] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const board = useContentBoard(brand.id, archived);
  const campaigns = useCampaigns(brand.id);

  const setView = (next: ViewMode) => {
    setViewState(next);
    writeLocal(VIEW_KEY, next);
  };

  const filtering = Boolean(format || campaign || deferredSearch.trim());
  // Lo que cuadra con la búsqueda y los filtros, sea cual sea la pestaña: de ahí salen los contadores.
  const matching = useMemo(() => {
    const text = deferredSearch.trim().toLowerCase();
    return board.items.filter(
      (item) =>
        (!text || item.title.toLowerCase().includes(text)) &&
        (!format || item.format === format) &&
        (!campaign || item.campaignIds.includes(campaign)),
    );
  }, [board.items, deferredSearch, format, campaign]);
  const counts = useMemo(() => {
    const result: Record<ContentStage, number> = { idea: 0, preparing: 0, ready: 0, scheduled: 0, published: 0 };
    for (const item of matching) result[item.stage] += 1;
    return result;
  }, [matching]);

  // Sin elegir pestaña, la primera que tenga algo: así no se abre en una vacía habiendo piezas en otra.
  const tab: Tab = archived ? 'all' : (tabChoice ?? STAGES.find((s) => counts[s.id] > 0)?.id ?? 'idea');
  const inTab = useMemo(() => (tab === 'all' ? matching : matching.filter((i) => i.stage === tab)), [matching, tab]);
  const shown = useMemo(() => inTab.slice(0, limit), [inTab, limit]);
  const thumbs = useContentThumbs(brand.id, shown);
  const empties = useMemo(() => board.items.filter((i) => i.empty), [board.items]);
  const chosen = useMemo(() => board.items.filter((i) => selected.has(i.id)), [board.items, selected]);

  const clearFilters = () => {
    setFormat('');
    setCampaign('');
    setSearch('');
  };
  const pickTab = (next: string) => {
    setTabChoice(next as ContentStage);
    setLimit(PAGE);
    setSelected(new Set());
  };
  const toggle = (item: BoardItem) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });

  async function archiveMany(items: BoardItem[]) {
    setBusy(true);
    const failed: string[] = [];
    for (const item of items) {
      try {
        await mutations.archive.mutateAsync({ contentId: item.id });
      } catch {
        failed.push(item.title);
      }
    }
    setBusy(false);
    setConfirm(null);
    setSelected(new Set());
    const done = items.length - failed.length;
    if (done > 0) toast.success(done === 1 ? 'Archivada' : `${done} archivadas`);
    if (failed.length > 0) toast.error(`No se pudo archivar: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`);
  }

  const actions: PieceActions = {
    canEdit,
    canSchedule: canEdit,
    onSchedule: (item) => setScheduling(item.id),
    onDuplicate: (item) =>
      void mutations.duplicate.mutateAsync(item.id).then(
        () => toast.success('Copia creada'),
        (e) => toast.error(translateError(e)),
      ),
    onArchive: (item) =>
      void mutations.archive.mutateAsync({ contentId: item.id }).then(
        () =>
          toast.success(`«${item.title}» archivada`, {
            action: { label: 'Deshacer', onClick: () => void mutations.archive.mutateAsync({ contentId: item.id, archived: false }) },
          }),
        (e) => toast.error(translateError(e)),
      ),
    onRestore: (item) =>
      void mutations.archive.mutateAsync({ contentId: item.id, archived: false }).then(
        () => toast.success('Recuperada'),
        (e) => toast.error(translateError(e)),
      ),
  };
  // «Programar» solo a lo aprobado y sin fecha.
  const actionsFor = (item: BoardItem): PieceActions => ({ ...actions, canSchedule: canEdit && item.stage === 'ready' });

  const empty = !board.isPending && !board.isError && board.items.length === 0;
  const openNew = (template: BrandTemplate | null = null) => {
    setStartTemplate(template);
    setCreating(true);
  };

  const body = board.isPending ? (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/5]" />
      ))}
    </div>
  ) : board.isError ? (
    <Card>
      <ErrorState error={board.error} onRetry={() => void board.refetch()} />
    </Card>
  ) : empty ? (
    <Card>
      <EmptyState
        icon={archived ? Archive : Lightbulb}
        title={archived ? 'No hay contenidos archivados' : 'Todavía no hay contenidos'}
        description={
          archived
            ? 'Lo que se archiva no se borra: aparece aquí y se puede recuperar.'
            : canEdit
              ? 'Empieza con una idea: elige el formato y diséñala en el editor.'
              : 'Cuando el equipo prepare publicaciones, aparecerán aquí.'
        }
        action={
          !archived &&
          canEdit && (
            <Button onClick={() => openNew()} data-testid="content-empty-new">
              <Plus className="h-4 w-4" aria-hidden />
              Nueva idea
            </Button>
          )
        }
      />
      {!archived && canEdit && <FeaturedTemplates brandId={brand.id} onPick={openNew} />}
    </Card>
  ) : inTab.length === 0 ? (
    <Card>
      <EmptyState
        icon={filtering ? Search : Lightbulb}
        title={filtering ? 'Nada coincide con los filtros' : 'No hay nada en esta pestaña'}
        description={
          filtering
            ? 'Prueba con otra búsqueda o quita algún filtro.'
            : (STAGES.find((s) => s.id === tab)?.hint ?? 'Aquí aparecerán las piezas.')
        }
        action={
          filtering ? (
            <Button variant="secondary" onClick={clearFilters} data-testid="content-clear-filters">
              <FilterX className="h-4 w-4" aria-hidden />
              Quitar filtros
            </Button>
          ) : tab === 'idea' && canEdit ? (
            <Button onClick={() => openNew()}>
              <Plus className="h-4 w-4" aria-hidden />
              Nueva idea
            </Button>
          ) : null
        }
      />
    </Card>
  ) : (
    <>
      {view === 'grid' ? (
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          data-testid="content-list"
          aria-label="Contenidos"
        >
          {shown.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              href={paths.item(item.id)}
              thumb={thumbs.get(item.id)}
              actions={actionsFor(item)}
              selected={selected.has(item.id)}
              onToggle={toggle}
              selectable={canEdit}
            />
          ))}
        </ul>
      ) : (
        <ul
          className="divide-y divide-border rounded-xl border border-border bg-surface"
          data-testid="content-list"
          aria-label="Contenidos"
        >
          {shown.map((item) => (
            <ContentRow
              key={item.id}
              item={item}
              href={paths.item(item.id)}
              thumb={thumbs.get(item.id)}
              actions={actionsFor(item)}
              selected={selected.has(item.id)}
              onToggle={toggle}
              selectable={canEdit}
            />
          ))}
        </ul>
      )}
      {inTab.length > shown.length && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)} data-testid="content-more-pieces">
            Ver más ({inTab.length - shown.length})
          </Button>
        </div>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title="Contenidos"
        action={
          canEdit && (
            <Button onClick={() => openNew()} data-testid="content-new">
              <Plus className="h-4 w-4" aria-hidden />
              Nueva idea
            </Button>
          )
        }
        more={[
          archived
            ? {
                id: 'live',
                label: 'Ver las que están en curso',
                icon: ArchiveRestore,
                onSelect: () => setArchived(false),
                testId: 'content-show-live',
              }
            : {
                id: 'archived',
                label: 'Ver las archivadas',
                icon: Archive,
                onSelect: () => {
                  setArchived(true);
                  setSelected(new Set());
                },
                testId: 'content-show-archived',
              },
          canEdit && !archived && empties.length > 0
            ? {
                id: 'clean',
                label: `Archivar las vacías (${empties.length})`,
                icon: Eraser,
                onSelect: () => setConfirm('empty'),
                testId: 'content-clean-empty',
              }
            : null,
        ]}
        moreTestId="content-more"
        className="!mb-4"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[11rem] flex-1 basis-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            aria-label="Buscar por nombre"
            placeholder="Buscar por nombre"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="content-search"
          />
        </div>
        <Select
          aria-label="Filtrar por formato"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="w-auto min-w-[9rem] flex-1 sm:flex-none"
          data-testid="content-format-filter"
        >
          <option value="">Todos los formatos</option>
          {FORMAT_CARDS.map((f) => (
            <option key={f.format} value={f.format}>
              {f.label}
            </option>
          ))}
        </Select>
        {(campaigns.data ?? []).length > 0 && (
          <Select
            aria-label="Filtrar por campaña"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            className="w-auto min-w-[9rem] flex-1 sm:flex-none"
            data-testid="content-campaign-filter"
          >
            <option value="">Todas las campañas</option>
            {(campaigns.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        )}
        <div role="group" aria-label="Cómo verlas" className="flex overflow-hidden rounded-lg border border-border">
          {(
            [
              ['grid', 'Miniaturas', LayoutGrid],
              ['list', 'Lista', List],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              aria-label={label}
              title={label}
              onClick={() => setView(mode)}
              data-testid={`content-view-${mode}`}
              className={`flex h-10 w-10 items-center justify-center ${view === mode ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-subtle'}`}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      {archived ? (
        <ActionNotice
          tone="info"
          icon={Archive}
          className="mb-4"
          title="Estás viendo las archivadas"
          action={
            <Button size="sm" variant="secondary" onClick={() => setArchived(false)} data-testid="content-back-live">
              Volver a las que están en curso
            </Button>
          }
          data-testid="content-archived-notice"
        />
      ) : (
        !empty &&
        !board.isPending &&
        !board.isError && (
          <Tabs value={tab} onValueChange={pickTab} className="mb-4">
            <TabsList label="Etapa de las piezas">
              {STAGES.map((stage) => (
                <TabsTrigger key={stage.id} value={stage.id} className="flex items-center gap-1.5">
                  <span data-testid={`content-tab-${stage.id}`}>{stage.label}</span>
                  <span
                    className="rounded-full bg-subtle px-1.5 text-xs tabular-nums text-muted"
                    data-testid={`content-count-${stage.id}`}
                  >
                    {counts[stage.id]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={tab} className="hidden" />
          </Tabs>
        )
      )}

      {canEdit && chosen.length > 0 && (
        <div
          className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft px-3 py-2 shadow-pop"
          role="region"
          aria-label="Piezas elegidas"
          data-testid="content-selection"
        >
          <span className="flex-1 text-sm font-medium">{chosen.length === 1 ? '1 elegida' : `${chosen.length} elegidas`}</span>
          <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(inTab.map((i) => i.id)))}>
            Elegir las {inTab.length} de aquí
          </Button>
          {archived ? null : (
            <Button size="sm" onClick={() => setConfirm('selected')} data-testid="content-archive-selected">
              <Archive className="h-4 w-4" aria-hidden />
              Archivar
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Quitar la selección">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}

      {canEdit && !archived && empties.length >= 3 && (
        <p className="mb-3 text-sm text-muted" data-testid="content-empty-hint">
          Hay {empties.length} piezas vacías, sin ningún diseño guardado.{' '}
          <button type="button" className="font-medium text-primary underline" onClick={() => setConfirm('empty')}>
            Archivarlas
          </button>
        </p>
      )}

      {body}

      {canEdit && (
        <CreateContentDialog
          organizationId={org.id}
          brandId={brand.id}
          open={creating}
          onOpenChange={setCreating}
          initialTemplate={startTemplate}
        />
      )}
      {scheduling && (
        <ScheduleDialog
          brandId={brand.id}
          open
          onOpenChange={(open) => !open && setScheduling(null)}
          initialContentId={scheduling}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'empty' ? `Archivar ${empties.length} piezas vacías` : `Archivar ${chosen.length} piezas`}
        description="No se borra nada: pasan a «Ver las archivadas» y se pueden recuperar cuando quieras."
        confirmLabel="Archivar"
        destructive={false}
        loading={busy}
        onConfirm={() => void archiveMany(confirm === 'empty' ? empties : chosen)}
      />
    </>
  );
}
