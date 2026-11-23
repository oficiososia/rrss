import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, UploadCloud, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@/config/app';
import { translateError } from '@/lib/errors';
import { sha256Hex, validateFile } from '@/lib/files';
import { cn, formatBytes } from '@/lib/utils';
import type { MediaAssetRow } from '@/lib/database.types';
import { assetKeys, findDuplicate, uploadAsset } from './api';

type Status = 'queued' | 'hashing' | 'duplicate' | 'uploading' | 'done' | 'error' | 'skipped';

interface Item {
  id: string;
  file: File;
  status: Status;
  message?: string;
  sha256?: string;
  /** Carpeta a la que va (la que se estaba viendo al añadirlo). */
  folder: string;
  /** Porcentaje real de bytes subidos (solo mientras se sube). */
  progress?: number;
}

const STATUS_TEXT: Record<Status, string> = {
  queued: 'En cola',
  hashing: 'Comprobando duplicados…',
  duplicate: 'Ya está en la biblioteca',
  uploading: 'Subiendo…',
  done: 'Subido',
  error: 'Error',
  skipped: 'Omitido',
};

/** Archivos soltados sobre la página o sobre una carpeta, para añadirlos a la cola. */
export interface IncomingFiles {
  /** Cambia con cada tanda: así la misma lista soltada dos veces se sube dos veces. */
  key: number;
  files: File[];
  folder: string;
}

interface UploadPanelProps {
  organizationId: string;
  brandId: string;
  /** Carpeta a la que van los archivos que se elijan con el botón o se suelten aquí. */
  folder?: string;
  incoming?: IncomingFiles | null;
  /**
   * En un selector (editor de reels o de piezas): se llama con cada archivo ya subido para elegirlo en el
   * acto. Un archivo idéntico a otro de la biblioteca no se sube otra vez: se elige el que ya estaba.
   */
  onUploaded?: (asset: MediaAssetRow) => void;
  /** Sin el recuadro de «Arrastra aquí»: solo la lista con el progreso (quien lo usa pone el botón y el soltar). */
  listOnly?: boolean;
}

export function UploadPanel({
  organizationId,
  brandId,
  folder = '',
  incoming,
  onUploaded,
  listOnly = false,
}: UploadPanelProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const upload = useCallback(
    async (item: Item, sha256: string) => {
      patch(item.id, { status: 'uploading', message: undefined, progress: 0 });
      try {
        const row = await uploadAsset({
          organizationId,
          brandId,
          file: item.file,
          sha256,
          folder: item.folder,
          onProgress: (progress) => patch(item.id, { progress }),
        });
        patch(item.id, { status: 'done' });
        onUploaded?.(row);
        await queryClient.invalidateQueries({ queryKey: assetKeys.all(brandId) });
      } catch (error) {
        patch(item.id, { status: 'error', message: translateError(error) });
      }
    },
    [organizationId, brandId, patch, queryClient, onUploaded],
  );

  const process = useCallback(
    async (item: Item) => {
      const invalid = validateFile(item.file);
      if (invalid) return patch(item.id, { status: 'error', message: invalid });
      patch(item.id, { status: 'hashing' });
      try {
        const sha256 = await sha256Hex(item.file);
        const duplicate = await findDuplicate(brandId, sha256);
        if (duplicate && onUploaded) {
          // En un selector no se duplica: se elige el que ya estaba.
          patch(item.id, { status: 'done', message: `Ya estaba en la biblioteca como «${duplicate.file_name}»: elegido.` });
          return onUploaded(duplicate);
        }
        if (duplicate) {
          return patch(item.id, { status: 'duplicate', sha256, message: `Es idéntico a «${duplicate.file_name}».` });
        }
        await upload(item, sha256);
      } catch (error) {
        patch(item.id, { status: 'error', message: translateError(error) });
      }
    },
    [brandId, patch, upload, onUploaded],
  );

  const addFiles = useCallback(
    async (files: FileList | File[], target: string) => {
      const added: Item[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: 'queued',
        folder: target,
      }));
      if (added.length === 0) return;
      setItems((current) => [...added, ...current]);
      // De uno en uno: evita saturar la conexión y mantiene el orden.
      for (const item of added) await process(item);
    },
    [process],
  );

  // Lo soltado sobre la página o sobre una carpeta llega desde fuera.
  const lastIncoming = useRef<number | null>(null);
  useEffect(() => {
    if (!incoming || lastIncoming.current === incoming.key) return;
    lastIncoming.current = incoming.key;
    void addFiles(incoming.files, incoming.folder);
  }, [incoming, addFiles]);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    void addFiles(event.dataTransfer.files, folder);
  }

  const busy = items.some((i) => i.status === 'queued' || i.status === 'hashing' || i.status === 'uploading');
  const finished = items.filter((i) => i.status === 'done' || i.status === 'skipped' || i.status === 'error');

  return (
    <div className="space-y-3">
      {!listOnly && (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="library-dropzone"
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-border bg-surface',
        )}
      >
        <UploadCloud className="h-7 w-7 text-muted" aria-hidden />
        <p className="text-sm font-medium">Arrastra aquí tus archivos</p>
        <p className="text-xs text-muted">
          Imágenes, vídeos, audio y documentos, hasta {formatBytes(MAX_FILE_BYTES)} cada uno.
          {folder ? ` Irán a «${folder}».` : ''}
        </p>
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          Elegir archivos
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_MIME_TYPES.join(',')}
          className="sr-only"
          aria-label="Elegir archivos para subir"
          data-testid="library-file-input"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files, folder);
            e.target.value = '';
          }}
        />
      </div>
      )}

      {items.length > 0 && (
        <div className="rounded-xl border border-border bg-surface" data-testid="library-upload-list">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-medium" role="status">
              {busy ? 'Subiendo archivos…' : 'Subida terminada'}
            </p>
            {finished.length > 0 && !busy && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setItems((current) => current.filter((i) => i.status === 'duplicate'))}
              >
                Limpiar lista
              </Button>
            )}
          </div>
          <ul className="max-h-40 divide-y sm:max-h-56 divide-border overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                data-testid={`upload-item-${item.status}`}
              >
                <span className="shrink-0">
                  {item.status === 'done' ? (
                    <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                  ) : item.status === 'error' || item.status === 'duplicate' ? (
                    <AlertTriangle
                      className={cn('h-4 w-4', item.status === 'error' ? 'text-danger' : 'text-warning')}
                      aria-hidden
                    />
                  ) : item.status === 'skipped' ? (
                    <X className="h-4 w-4 text-muted" aria-hidden />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.file.name}</p>
                  <p className={cn('text-xs', item.status === 'error' ? 'text-danger' : 'text-muted')}>
                    {STATUS_TEXT[item.status]}
                    {item.status === 'uploading' && ` ${item.progress ?? 0} %`} · {formatBytes(item.file.size)}
                    {item.message && ` · ${item.message}`}
                  </p>
                  {item.status === 'uploading' && (
                    <div
                      role="progressbar"
                      aria-label={`Progreso de ${item.file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={item.progress ?? 0}
                      data-testid="upload-progress"
                      className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-subtle"
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${item.progress ?? 0}%` }}
                      />
                    </div>
                  )}
                </div>
                {item.status === 'error' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void process(item)}
                    data-testid="upload-retry"
                    aria-label={`Reintentar ${item.file.name}`}
                  >
                    Reintentar
                  </Button>
                )}
                {item.status === 'duplicate' && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => patch(item.id, { status: 'skipped', message: undefined })}
                    >
                      Omitir
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => item.sha256 && void upload(item, item.sha256)}
                      data-testid="upload-anyway"
                    >
                      Subir igualmente
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
