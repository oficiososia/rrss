import { Archive, CheckSquare, Eraser, FilterX, Lightbulb, Plus, Search, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
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
import { publishedInfoOf } from '@/features/social/publishedState';
import { RepublishDialog } from '@/features/social/RepublishDialog';
import { ScheduleDialog } from '@/features/social/ScheduleDialog';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useContentMutations } from './api';
import { CreateContentDialog } from './CreateContentDialog';
import { contentPaths } from './labels';
import { ContentCard, ContentRow, type PieceActions } from './lista/ContentCard';
import { FeaturedTemplates } from './lista/FeaturedTemplates';
import { FORMAT_CARDS } from './lista/formats';
import { CONTENT_TABS, tabOf, type ContentTab } from './lista/stage';
import { useContentBoard, type BoardItem } from './lista/useContentBoard';
import { useContentThumbs } from './lista/useContentThumbs';
import { useStartPiece } from './useStartPiece';

const PAGE = 24;

/** En el móvil, lista; en lo demás, miniaturas. Sin elegirlo: no hay botón para cambiarlo. */
const NARROW = '(max-width: 639px)';
function useNarrow(): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(NARROW);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return narrow;
}

/** Fichas del filtro de formato, en plural (como se buscan). */
const FORMAT_CHIPS: { format: string; label: string }[] = [
  { format: '', label: 'Todo' },
  ...['reel', 'post', 'carousel', 'story'].map((format) => ({
    format,
    label: { reel: 'Reels', post: 'Publicaciones', carousel: 'Carruseles', story: 'Historias' }[format]!,
  })),
].filter((chip) => !chip.format || FORMAT_CARDS.some((card) => card.format === chip.format));

export function ContentListPage() {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const canEdit = can('edit');
  const paths = contentPaths(org.id, brand.id);
  const mutations = useContentMutations(org.id, brand.id);
  const narrow = useNarrow();

  const [creating, setCreating] = useState(false);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [republishing, setRepublishing] = useState<BoardItem | null>(null);
  const [archived, setArchived] = useState(false);
  const [tabChoice, setTabChoice] = useState<ContentTab | null>(null);
  const [search, setSearch] = useState('');
  const [format, setFormat] = useState('');
  const [campaign, setCampaign] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [confirm, setConfirm] = useState<'selected' | 'empty' | null>(null);
  const [busy, setBusy] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const starter = useStartPiece(org.id, brand.id);

  const board = useContentBoard(brand.id, archived);
  const campaigns = useCampaigns(brand.id);

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
    const result: Record<ContentTab, number> = { active: 0, scheduled: 0, published: 0 };
    for (const item of matching) result[tabOf(item.stage)] += 1;
    return result;
  }, [matching]);

  // Sin elegir pestaña, la primera que tenga algo: así no se abre en una vacía habiendo piezas en otra.
  const tab: ContentTab | 'all' = archived
    ? 'all'
    : (tabChoice ?? CONTENT_TABS.find((t) => counts[t.id] > 0)?.id ?? 'active');
  const inTab = useMemo(
    () => (tab === 'all' ? matching : matching.filter((i) => tabOf(i.stage) === tab)),
    [matching, tab],
  );
  const shown = useMemo(() => inTab.slice(0, limit), [inTab, limit]);
  const thumbs = useContentThumbs(brand.id, shown);
  const empties = useMemo(() => board.items.filter((i) => i.empty), [board.items]);
  const chosen = useMemo(() => board.items.filter((i) => selected.has(i.id)), [board.items, selected]);

  const clearFilters = () => {
    setFormat('');
    setCampaign('');
    setSearch('');
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const pickTab = (next: string) => {
    setTabChoice(next as ContentTab);
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
    stopSelecting();
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
    onRepublish: (item) => setRepublishing(item),
    onRestore: (item) =>
      void mutations.archive.mutateAsync({ contentId: item.id, archived: false }).then(
        () => toast.success('Recuperada'),
        (e) => toast.error(translateError(e)),
      ),
    onSelect: archived
      ? undefined
      : (item) => {
          setSelecting(true);
          setSelected(new Set([item.id]));
        },
  };
  // «Programar» solo a lo aprobado y sin fecha.
  const actionsFor = (item: BoardItem): PieceActions => ({ ...actions, canSchedule: canEdit && item.stage === 'ready' });

  const empty = !board.isPending && !board.isError && board.items.length === 0;

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
            ? 'Lo archivado se puede recuperar desde aquí.'
            : canEdit
              ? 'Empieza con una idea o una plantilla.'
              : 'Aquí saldrá lo que prepare el equipo.'
        }
        action={
          !archived &&
          canEdit && (
            // «＋ Crear» ya está en el menú; aquí solo en la pantalla vacía, donde ayuda.
            <Button onClick={() => setCreating(true)} data-testid="content-empty-new">
              <Plus className="h-4 w-4" aria-hidden />
              Nueva idea
            </Button>
          )
        }
      />
      {!archived && canEdit && (
        <FeaturedTemplates brandId={brand.id} onPick={(template) => void starter.start({ kind: 'template', template }, template.id)} />
      )}
      {starter.error && (
        <p role="alert" className="px-4 pb-4 text-center text-sm text-danger">
          {starter.error}
        </p>
      )}
    </Card>
  ) : inTab.length === 0 ? (
    <Card>
      <EmptyState
        icon={filtering ? Search : Lightbulb}
        title={filtering ? 'Nada coincide con los filtros' : 'No hay nada en esta pestaña'}
        description={filtering ? undefined : CONTENT_TABS.find((t) => t.id === tab)?.hint}
        action={
          filtering ? (
            <Button variant="secondary" onClick={clearFilters} data-testid="content-clear-filters">
              <FilterX className="h-4 w-4" aria-hidden />
              Quitar filtros
            </Button>
          ) : null
        }
      />
    </Card>
  ) : (
    <>
      {narrow ? (
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
              selecting={selecting}
            />
          ))}
        </ul>
      ) : (
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
              selecting={selecting}
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
        // Crear va en «＋ Crear» del menú (una sola puerta); lo secundario, aquí en «⋯».
        more={[
          canEdit && !archived && !selecting && board.items.length > 0
            ? {
                id: 'select',
                label: 'Elegir varias',
                icon: CheckSquare,
                onSelect: () => setSelecting(true),
                testId: 'content-select-many',
              }
            : null,
          archived
            ? null
            : {
                id: 'archived',
                label: 'Ver las archivadas',
                icon: Archive,
                onSelect: () => {
                  setArchived(true);
                  stopSelecting();
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

      {!empty && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[11rem] flex-1 basis-48">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                type="search"
                aria-label="Buscar por nombre"
                placeholder="Buscar"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="content-search"
              />
            </div>
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
          </div>
          {/* Formato: fichas de un toque. En el móvil se deslizan de lado, sin empujar la página. */}
          <div
            role="group"
            aria-label="Formato"
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
            data-testid="content-format-filter"
          >
            {FORMAT_CHIPS.map((chip) => (
              <button
                key={chip.format || 'all'}
                type="button"
                aria-pressed={format === chip.format}
                onClick={() => setFormat(chip.format)}
                className={cn(
                  'min-h-10 shrink-0 rounded-full border px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                  format === chip.format
                    ? 'border-primary bg-primary-soft font-medium text-primary'
                    : 'border-border text-muted hover:border-primary/50',
                )}
                data-testid={`content-format-${chip.format || 'all'}`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {archived ? (
        <ActionNotice
          tone="info"
          icon={Archive}
          className="mb-4"
          title="Estás viendo las archivadas"
          action={
            <Button size="sm" variant="secondary" onClick={() => setArchived(false)} data-testid="content-back-live">
              Volver
            </Button>
          }
          data-testid="content-archived-notice"
        />
      ) : (
        !empty &&
        !board.isPending &&
        !board.isError && (
          <Tabs value={tab} onValueChange={pickTab} className="mb-4">
            <TabsList label="En qué punto están">
              {CONTENT_TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="flex items-center gap-1.5">
                  <span data-testid={`content-tab-${t.id}`}>{t.label}</span>
                  <span
                    className="rounded-full bg-subtle px-1.5 text-xs tabular-nums text-muted"
                    data-testid={`content-count-${t.id}`}
                  >
                    {counts[t.id]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={tab} className="hidden" />
          </Tabs>
        )
      )}

      {canEdit && selecting && (
        <div
          className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft px-3 py-2 shadow-pop"
          role="region"
          aria-label="Piezas elegidas"
          data-testid="content-selection"
        >
          <span className="flex-1 text-sm font-medium">
            {chosen.length === 0 ? 'Toca las piezas' : chosen.length === 1 ? '1 elegida' : `${chosen.length} elegidas`}
          </span>
          {chosen.length < inTab.length && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(inTab.map((i) => i.id)))}>
              Todas ({inTab.length})
            </Button>
          )}
          <Button
            size="sm"
            disabled={chosen.length === 0}
            onClick={() => setConfirm('selected')}
            data-testid="content-archive-selected"
          >
            <Archive className="h-4 w-4" aria-hidden />
            Archivar
          </Button>
          <Button size="sm" variant="ghost" onClick={stopSelecting} aria-label="Dejar de elegir" data-testid="content-selection-done">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}

      {body}

      {canEdit && <CreateContentDialog organizationId={org.id} brandId={brand.id} open={creating} onOpenChange={setCreating} />}
      {scheduling && (
        <ScheduleDialog
          brandId={brand.id}
          open
          onOpenChange={(open) => !open && setScheduling(null)}
          initialContentId={scheduling}
        />
      )}
      {republishing && publishedInfoOf(republishing.publication) && (
        <RepublishDialog
          orgId={org.id}
          brandId={brand.id}
          contentId={republishing.id}
          title={republishing.title}
          published={publishedInfoOf(republishing.publication)!}
          open
          onOpenChange={(open) => !open && setRepublishing(null)}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'empty' ? `Archivar ${empties.length} piezas vacías` : `Archivar ${chosen.length} piezas`}
        description="No se borra nada: pasan a «Ver las archivadas» y se pueden recuperar."
        confirmLabel="Archivar"
        destructive={false}
        loading={busy}
        onConfirm={() => void archiveMany(confirm === 'empty' ? empties : chosen)}
      />
    </>
  );
}
