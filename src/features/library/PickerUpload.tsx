// «Subir» y «Crear con IA» dentro de un selector de la biblioteca (el material de un
// reel, «Añadir», «Sustituir», «Poner foto»…), y soltar archivos del escritorio sobre
// todo el selector. La subida es la de la biblioteca (`UploadPanel`: cola de uno en
// uno, progreso por archivo, duplicados y errores con «Reintentar»); la imagen con IA
// es el diálogo de siempre (`GenerateImageDialog`, con su coste antes de lanzar). Lo
// nuevo llega a `onAdded` en cuanto está en la biblioteca, para elegirlo en el acto.
import { Sparkles, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { GenerateImageDialog } from '@/features/ai/GenerateImageDialog';
import type { ImageAspectRatio } from '@/features/ai/imageApi';
import { useAiImageAvailable } from '@/features/ai/useAiImage';
import { useBrand, useOrg } from '@/features/orgs/context';
import type { MediaAssetRow } from '@/lib/database.types';
import { translateError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { UploadPanel, type IncomingFiles } from './UploadPanel';

export interface PickerUploadProps {
  /** Tipos de archivo que se ofrecen al elegir (el soltar descarta lo demás y lo dice). */
  accept: string[];
  /** Cómo se llama lo que se sube, para los textos: «fotos», «fotos o vídeos». */
  noun?: string;
  /** Recibe cada archivo nuevo (subido o creado con IA) en cuanto está en la biblioteca. */
  onAdded: (asset: MediaAssetRow) => void;
  /** Con proporción, «Crear con IA» (si la marca tiene imagen con IA y quien mira puede usarla). */
  aiRatio?: ImageAspectRatio;
  /** La rejilla del selector: todo el bloque admite soltar archivos. */
  children: ReactNode;
  className?: string;
}

const matches = (file: File, accept: readonly string[]) =>
  accept.some((type) => (type.endsWith('/*') ? file.type.startsWith(type.slice(0, -1)) : file.type === type));

export function PickerUpload({ accept, noun = 'fotos', onAdded, aiRatio, children, className }: PickerUploadProps) {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const canUpload = can('edit');
  const aiAvailable = useAiImageAvailable();
  const input = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<IncomingFiles | null>(null);
  const [dragging, setDragging] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const add = (files: File[]) => {
    const fit = files.filter((f) => matches(f, accept));
    if (fit.length < files.length) {
      toast.error(
        fit.length === 0
          ? `Aquí solo se pueden subir ${noun}.`
          : `${files.length - fit.length} de los archivos no son ${noun}: no se suben.`,
      );
    }
    if (fit.length > 0) setIncoming({ key: Date.now() + Math.random(), files: fit, folder: '' });
  };
  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  // La imagen creada con IA ya está en la biblioteca: se lee su fila para entregarla entera.
  const generated = async (id: string) => {
    setAiOpen(false);
    try {
      const rows = unwrap(await supabase.from('media_assets').select('*').eq('id', id).limit(1));
      if (rows[0]) onAdded(rows[0]);
    } catch (error) {
      toast.error(translateError(error));
    }
  };

  if (!canUpload) return <div className={className}>{children}</div>;
  return (
    <div
      className={cn('relative space-y-2', className)}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDragging(false);
        add(Array.from(event.dataTransfer.files));
      }}
      data-testid="picker-dropzone"
      data-dragging={dragging || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()} data-testid="picker-upload">
          <Upload className="h-4 w-4" aria-hidden />
          Subir
        </Button>
        {aiRatio && aiAvailable && (
          <Button variant="secondary" size="sm" onClick={() => setAiOpen(true)} data-testid="picker-ai">
            <Sparkles className="h-4 w-4" aria-hidden />
            Crear con IA
          </Button>
        )}
        <span className="min-w-0 text-xs text-muted">O suelta aquí {noun} desde el ordenador.</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={accept.join(',')}
          className="sr-only"
          aria-label={`Subir ${noun}`}
          data-testid="picker-upload-input"
          onChange={(event) => {
            if (event.target.files) add(Array.from(event.target.files));
            event.target.value = '';
          }}
        />
      </div>
      <UploadPanel
        organizationId={org.id}
        brandId={brand.id}
        incoming={incoming}
        onUploaded={onAdded}
        listOnly
      />
      {children}
      {dragging && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary-soft/90 text-sm font-medium text-primary"
          aria-hidden
        >
          Suelta para subir a la biblioteca
        </div>
      )}
      {aiRatio && aiAvailable && (
        <GenerateImageDialog
          brandId={brand.id}
          open={aiOpen}
          onOpenChange={setAiOpen}
          canvasRatio={aiRatio}
          description="Describe la imagen. Al terminar se guarda en la biblioteca y queda elegida aquí."
          onGenerated={(image) => void generated(image.id)}
        />
      )}
    </div>
  );
}
