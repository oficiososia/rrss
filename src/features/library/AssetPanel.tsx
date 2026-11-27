import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  ImagePlus,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { usageWarning } from './usageText';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, Button, ConfirmDialog, Field, Input, Select, Textarea } from '@/components/ui';
import { aiAnimateEnabled, mediaWorkerEnabled } from '@/config/app';
import { StringListInput } from '@/features/brand/editor/inputs';
import { contentPaths } from '@/features/content/labels';
import { canEditPhoto, canEditWithAi } from '@/features/photo-edit/api';
import { PhotoEditScreen } from '@/features/photo-edit/PhotoEditScreen';
import { useBrand, useOrg } from '@/features/orgs/context';
import type { AssetKind, AssetUsageRow, MediaAssetRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { formatBytes, formatDateTime } from '@/lib/utils';
import { AnimateDialog } from './AnimateDialog';
import { useAnimateOptions } from './animateApi';
import { useAssetMutations } from './api';
import { createPostFromAsset } from './catalog';
import { CropPanel } from './CropPanel';
import { canCrop } from './crops';
import { ASSET_KIND_LABEL, ASSET_KINDS, parseRights, rightsExpired, serializeRights, type AssetRights } from './labels';
import { readableName } from './readableName';

export interface AssetPanelProps {
  asset: MediaAssetRow;
  url: string | undefined;
  canEdit: boolean;
  /** Piezas donde se usa; `undefined` si no se ha podido consultar (no se dice nada). */
  usage: AssetUsageRow[] | undefined;
  /** Carpetas que ya existen, para sugerirlas al escribir la de este archivo. */
  folders: string[];
  /** Posición entre los archivos que se están viendo («3 de 270»). */
  position?: { index: number; total: number };
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  /** Abre otra ficha de la biblioteca (los recortes de esta foto). */
  onOpenAsset?: (assetId: string) => void;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

/** ¿Hay encima otra ventana (confirmación, animar, editar foto…)? Entonces las teclas son suyas. */
const modalOpen = () =>
  Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"], [data-testid="photo-edit"]'));

/**
 * Ficha de un archivo como panel lateral: la rejilla sigue a la vista, ← y → pasan al
 * archivo anterior y siguiente. En pantallas estrechas el panel ocupa toda la pantalla.
 */
export function AssetPanel({
  asset,
  url,
  canEdit,
  usage,
  folders,
  position,
  onPrev,
  onNext,
  onClose,
  onOpenAsset,
}: AssetPanelProps) {
  const { org } = useOrg();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const { update, remove } = useAssetMutations(asset.brand_id);
  const [fileName, setFileName] = useState(asset.file_name);
  const [kind, setKind] = useState<AssetKind>(asset.kind);
  const [folder, setFolder] = useState(asset.folder);
  const [tags, setTags] = useState<string[]>(asset.tags);
  const [rights, setRights] = useState<AssetRights>(() => parseRights(asset.rights));
  const [confirming, setConfirming] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [creatingPost, setCreatingPost] = useState(false);
  const titleId = useId();
  const folderListId = useId();
  const panel = useRef<HTMLElement>(null);

  // «Animar con IA…» solo sale si el servidor tiene proveedor, modelo activo, plan y cupo para esta persona.
  const animatable = canEdit && Boolean(url) && aiAnimateEnabled() && canEditWithAi(asset);
  const animateOptions = useAnimateOptions(asset.brand_id, animatable);
  const canAnimate = animatable && animateOptions.data?.available === true;
  const aiVideo = (asset.provenance as { type?: unknown } | null)?.type === 'ai_animation';
  const isImage = asset.mime_type.startsWith('image/');
  const isVideo = asset.mime_type.startsWith('video/');

  const initialRights = useMemo(() => JSON.stringify(serializeRights(parseRights(asset.rights))), [asset.rights]);
  const dirty =
    fileName !== asset.file_name ||
    kind !== asset.kind ||
    folder !== asset.folder ||
    JSON.stringify(tags) !== JSON.stringify(asset.tags) ||
    JSON.stringify(serializeRights(rights)) !== initialRights;

  // En pantallas estrechas el panel tapa la lista: se lleva el foco y, al cerrarlo, se devuelve.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (window.matchMedia?.('(max-width: 1279px)').matches) panel.current?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  // ← y → pasan de un archivo a otro; Esc cierra. No se roban dentro de un campo ni de otra ventana.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTyping(event.target) || modalOpen() || editingPhoto || animating || confirming) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowLeft' && onPrev && !dirty) {
        event.preventDefault();
        onPrev();
      } else if (event.key === 'ArrowRight' && onNext && !dirty) {
        event.preventDefault();
        onNext();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, dirty, editingPhoto, animating, confirming]);

  const setRight = (key: keyof AssetRights, value: string) => setRights((current) => ({ ...current, [key]: value }));
  const details = [
    formatBytes(asset.bytes),
    asset.width && asset.height ? `${asset.width} × ${asset.height} px` : null,
    asset.duration_ms ? formatDuration(asset.duration_ms) : null,
    `subido el ${formatDateTime(asset.created_at)}`,
  ].filter(Boolean);

  function save() {
    update.mutate(
      {
        id: asset.id,
        patch: {
          file_name: fileName.trim() || asset.file_name,
          kind,
          folder: folder.trim(),
          tags: tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
          rights: serializeRights(rights),
        },
      },
      {
        onSuccess: () => toast.success('Cambios guardados'),
        onError: (e) => toast.error(translateError(e)),
      },
    );
  }

  async function startPost() {
    setCreatingPost(true);
    try {
      const id = await createPostFromAsset({ organizationId: org.id, brandId: brand.id, asset });
      navigate(contentPaths(org.id, brand.id).item(id));
    } catch (e) {
      toast.error(translateError(e));
      setCreatingPost(false);
    }
  }

  return (
    <>
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        style={editingPhoto ? { display: 'none' } : undefined}
        data-testid="asset-panel"
        className={
          // Estrecho: hoja a pantalla completa sobre la lista. Ancho (≥1280 px): columna al lado de la rejilla.
          'fixed inset-0 z-40 flex flex-col bg-surface outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[26rem] sm:border-l sm:border-border sm:shadow-pop ' +
          'xl:static xl:z-auto xl:w-[24rem] xl:shrink-0 xl:rounded-xl xl:border xl:shadow-card'
        }
      >
        <div className="flex items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            {/* El título legible (B4); el nombre del archivo, debajo, por si hace falta. */}
            <h2 id={titleId} className="truncate text-base font-semibold" title={asset.file_name}>
              {readableName(asset.file_name)}
            </h2>
            {readableName(asset.file_name) !== asset.file_name && (
              <p className="truncate text-xs text-muted" data-testid="asset-file-name">
                {asset.file_name}
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted">
              {position ? `${position.index + 1} de ${position.total} · ` : ''}
              {details.join(' · ')}
            </p>
          </div>
          {(onPrev || onNext) && (
            <div className="flex shrink-0 items-center">
              <Button
                variant="ghost"
                size="icon"
                onClick={onPrev}
                disabled={!onPrev || dirty}
                aria-label="Archivo anterior"
                aria-keyshortcuts="ArrowLeft"
                title={dirty ? 'Guarda los cambios para pasar a otro archivo' : 'Anterior (←)'}
                data-testid="asset-prev"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onNext}
                disabled={!onNext || dirty}
                aria-label="Archivo siguiente"
                aria-keyshortcuts="ArrowRight"
                title={dirty ? 'Guarda los cambios para pasar a otro archivo' : 'Siguiente (→)'}
                data-testid="asset-next"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Cerrar la ficha"
            title="Cerrar (Esc)"
            data-testid="asset-close"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div className="flex min-h-[8rem] items-center justify-center overflow-hidden rounded-lg bg-subtle">
            {url && isImage ? (
              <img src={url} alt={asset.file_name} className="max-h-[22rem] w-auto max-w-full object-contain" />
            ) : url && isVideo ? (
              <video src={url} controls className="max-h-[22rem] w-full" />
            ) : url && asset.mime_type.startsWith('audio/') ? (
              <audio src={url} controls className="w-full px-4" />
            ) : (
              <p className="px-4 py-6 text-sm text-muted">Sin vista previa para este tipo de archivo.</p>
            )}
          </div>

          {aiVideo && (
            <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="asset-ai-video">
              <Badge tone="warning">Generado con IA</Badge>
              <span className="text-muted">
                Vídeo animado con IA a partir de una foto. No lo presentes como una grabación real.
              </span>
            </p>
          )}

          {canEdit && (
            <div className="flex flex-wrap gap-2" data-testid="asset-actions">
              {url && canEditPhoto(asset) && (
                <Button variant="secondary" onClick={() => setEditingPhoto(true)} data-testid="asset-edit-photo">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                  Editar foto
                </Button>
              )}
              {isImage && (
                <Button
                  variant="secondary"
                  onClick={() => void startPost()}
                  loading={creatingPost}
                  data-testid="asset-use-post"
                >
                  <Send className="h-4 w-4" aria-hidden />
                  Usar en una publicación
                </Button>
              )}
              {mediaWorkerEnabled() && (isImage || isVideo) && (
                <Button
                  variant="secondary"
                  onClick={() => navigate(`reels?con=${asset.id}`)}
                  data-testid="asset-use-reel"
                >
                  <Clapperboard className="h-4 w-4" aria-hidden />
                  Usar en un reel
                </Button>
              )}
              {canAnimate && (
                <Button variant="secondary" onClick={() => setAnimating(true)} data-testid="asset-animate">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Animar con IA…
                </Button>
              )}
            </div>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Abrir el archivo original
            </a>
          )}

          {usage !== undefined && (
            <section aria-labelledby={`${titleId}-uso`} data-testid="asset-usage">
              <h3 id={`${titleId}-uso`} className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                <ImagePlus className="h-4 w-4 text-muted" aria-hidden />
                Dónde se usa
              </h3>
              {usage.length === 0 ? (
                <p className="text-sm text-muted">Todavía no está en ninguna pieza.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {usage.map((piece) => (
                    <li key={piece.content_id} className="flex items-center justify-between gap-2">
                      <Link
                        to={contentPaths(org.id, brand.id).item(piece.content_id)}
                        className="min-w-0 truncate font-medium text-primary hover:underline"
                      >
                        {piece.title}
                      </Link>
                      {piece.archived && <Badge className="shrink-0">Archivada</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {mediaWorkerEnabled() && canCrop(asset) && onOpenAsset && (
            <CropPanel asset={asset} url={url} canEdit={canEdit} onOpenAsset={onOpenAsset} />
          )}

          <div className="grid gap-4">
            <Field label="Nombre">
              {(p) => (
                <Input
                  {...p}
                  maxLength={255}
                  disabled={!canEdit}
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  data-testid="asset-name"
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo">
                {(p) => (
                  <Select {...p} disabled={!canEdit} value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
                    {ASSET_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ASSET_KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Carpeta" optional>
                {(p) => (
                  <>
                    <Input
                      {...p}
                      list={folderListId}
                      maxLength={200}
                      disabled={!canEdit}
                      value={folder}
                      onChange={(e) => setFolder(e.target.value)}
                      placeholder="P. ej. Platos / Mariscos"
                    />
                    <datalist id={folderListId}>
                      {folders.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            </div>
            <StringListInput
              label="Etiquetas"
              values={tags}
              onChange={setTags}
              placeholder="Añade una etiqueta"
              disabled={!canEdit}
              maxLength={50}
              testId="asset-tag-input"
            />
          </div>

          <details className="rounded-lg border border-border">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-medium">
              Derechos de uso {rightsExpired(rights) && <Badge tone="danger">Caducados</Badge>}
            </summary>
            <div className="grid gap-4 border-t border-border p-3">
              <Field label="Licencia" optional>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={200}
                    disabled={!canEdit}
                    value={rights.license}
                    onChange={(e) => setRight('license', e.target.value)}
                    placeholder="Propia, banco de imágenes…"
                  />
                )}
              </Field>
              <Field label="Titular" optional>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={200}
                    disabled={!canEdit}
                    value={rights.owner}
                    onChange={(e) => setRight('owner', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Caduca el" optional>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    disabled={!canEdit}
                    value={rights.expires_on}
                    onChange={(e) => setRight('expires_on', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Notas" optional>
                {(p) => (
                  <Textarea
                    {...p}
                    rows={2}
                    maxLength={1000}
                    disabled={!canEdit}
                    value={rights.notes}
                    onChange={(e) => setRight('notes', e.target.value)}
                    placeholder="Personas que aparecen, permisos, restricciones…"
                  />
                )}
              </Field>
            </div>
          </details>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={() => setConfirming(true)}
              data-testid="asset-delete"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Eliminar
            </Button>
            <Button onClick={save} loading={update.isPending} disabled={!dirty} data-testid="asset-save">
              Guardar
            </Button>
          </div>
        )}
      </aside>

      {canAnimate && (
        <AnimateDialog
          asset={asset}
          open={animating}
          onOpenChange={setAnimating}
          onOpenAsset={
            onOpenAsset
              ? (id) => {
                  setAnimating(false);
                  onOpenAsset(id);
                }
              : undefined
          }
        />
      )}

      {editingPhoto && url && (
        <PhotoEditScreen
          asset={asset}
          url={url}
          onClose={() => setEditingPhoto(false)}
          resultLabel="Abrir"
          onResult={onOpenAsset ? (row) => onOpenAsset(row.id) : undefined}
        />
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Eliminar este archivo?"
        description={
          usage && usageWarning(usage)
            ? `«${asset.file_name}» se borrará de la biblioteca de forma definitiva. No se puede deshacer. ${usageWarning(usage)}`
            : `«${asset.file_name}» se borrará de la biblioteca de forma definitiva. No se puede deshacer.`
        }
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() =>
          // Con la promesa y no con los avisos de `mutate`: al borrar, la rejilla se refresca y esta ficha se
          // desmonta; si eso ocurre antes de que termine la mutación, los avisos de `mutate` no se ejecutan.
          remove.mutateAsync(asset).then(
            () => {
              toast.success('Archivo eliminado');
              onClose();
            },
            (e: unknown) => {
              setConfirming(false);
              toast.error(translateError(e));
            },
          )
        }
      />
    </>
  );
}
