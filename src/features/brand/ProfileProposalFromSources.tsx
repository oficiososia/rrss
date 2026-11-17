import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardBody, CardHeader } from '@/components/ui';
import { STORAGE_BUCKET } from '@/config/app';
import type { ProfileSourceText } from '@/features/ai/api';
import { ProfileProposalDialog } from '@/features/ai/ProfileProposalDialog';
import { PROPOSAL_MAX_SOURCES } from '@/features/ai/profileProposal';
import type { KnowledgeSourceRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useSources } from './api';
import type { BrandProfileData } from './profile';

// Proponer el perfil con IA a partir de las fuentes. Hoy el producto no extrae
// el texto de PDF, documentos ni webs: solo las fuentes de texto plano (.txt)
// guardan ya su contenido tal cual, así que son las únicas que se envían. Si la
// marca no tiene ninguna, este bloque no aparece (lo que no funciona no sale en
// la interfaz).

/** Fuentes cuyo contenido ya es texto legible: archivos de texto plano subidos a la biblioteca de fuentes. */
function textSources(sources: readonly KnowledgeSourceRow[]): KnowledgeSourceRow[] {
  return sources.filter((s) => s.kind === 'text' && s.storage_path !== null);
}

async function readSourceText(source: KnowledgeSourceRow): Promise<ProfileSourceText> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(source.storage_path!);
  if (error || !data) throw error ?? new Error(`No se ha podido leer «${source.title}».`);
  return { title: source.title, text: await data.text() };
}

export function ProfileProposalFromSources({
  brandId,
  currentProfile,
  onAccept,
  blockedReason,
}: {
  brandId: string;
  currentProfile: BrandProfileData | null;
  /** Si no se puede proponer ahora (por ejemplo, hay cambios sin guardar), el motivo. */
  blockedReason?: string;
  onAccept: (profile: BrandProfileData, acceptedFields: string[]) => void;
}) {
  const sources = useSources(brandId);
  const usable = textSources(sources.data ?? []);
  const [loaded, setLoaded] = useState<ProfileSourceText[] | null>(null);
  const [reading, setReading] = useState(false);

  if (usable.length === 0) return null;

  async function open() {
    setReading(true);
    try {
      setLoaded(await Promise.all(usable.slice(0, PROPOSAL_MAX_SOURCES).map(readSourceText)));
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setReading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Proponer el perfil con IA"
        description={`La IA lee las fuentes de texto (${usable.length}) y propone un perfil; tú eliges qué aceptar y se guarda como versión nueva. Los PDF, documentos y webs todavía no se leen.`}
        action={
          <Button
            variant="secondary"
            onClick={() => void open()}
            loading={reading}
            disabled={Boolean(blockedReason)}
            title={blockedReason}
            data-testid="profile-ai-propose"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Proponer
          </Button>
        }
      />
      {(blockedReason || usable.length > PROPOSAL_MAX_SOURCES) && (
        <CardBody>
          <p className="text-sm text-muted">
            {blockedReason ?? `Se envían las ${PROPOSAL_MAX_SOURCES} más recientes.`}
          </p>
        </CardBody>
      )}
      <ProfileProposalDialog
        brandId={brandId}
        sources={loaded ?? []}
        open={loaded !== null}
        onOpenChange={(value) => !value && setLoaded(null)}
        currentProfile={currentProfile}
        onAccept={(profile, info) => onAccept(profile, info.acceptedFields)}
      />
    </Card>
  );
}
