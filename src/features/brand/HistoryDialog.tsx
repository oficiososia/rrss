import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Dialog, ErrorState, Spinner } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';
import { fetchProfileVersion, useProfileVersions, type ProfileVersion } from './api';
import {
  AudienceSection,
  BusinessSection,
  ChannelsSection,
  ContextSection,
  VisualSection,
  VoiceSection,
} from './editor/sections';
import { parseProfile, type BrandProfileData } from './profile';

interface HistoryDialogProps {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore: boolean;
  restoring: boolean;
  onRestore: (version: number, data: BrandProfileData) => void;
}

const noop = () => {};

function VersionView({
  version,
  canRestore,
  restoring,
  onRestore,
  onBack,
}: {
  version: ProfileVersion;
  canRestore: boolean;
  restoring: boolean;
  onRestore: HistoryDialogProps['onRestore'];
  onBack: () => void;
}) {
  const row = useQuery({
    queryKey: ['brand-profile-version', version.id],
    queryFn: () => fetchProfileVersion(version.id),
    staleTime: Infinity,
  });
  const data = row.data ? parseProfile(row.data.data) : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Todas las versiones
        </Button>
        {canRestore && version.status !== 'active' && data && (
          <Button
            size="sm"
            loading={restoring}
            onClick={() => onRestore(version.version, data)}
            data-testid="history-restore"
          >
            Restaurar esta versión
          </Button>
        )}
      </div>
      {row.isPending ? (
        <Spinner />
      ) : row.isError || !data ? (
        <ErrorState error={row.error} onRetry={() => void row.refetch()} />
      ) : (
        <div className="space-y-8">
          {[BusinessSection, AudienceSection, VoiceSection, VisualSection, ChannelsSection, ContextSection].map(
            (Section, i) => (
              <Section key={i} value={data} onChange={noop} disabled />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function HistoryDialog({ brandId, open, onOpenChange, canRestore, restoring, onRestore }: HistoryDialogProps) {
  const versions = useProfileVersions(brandId, open);
  const [viewing, setViewing] = useState<ProfileVersion | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setViewing(null);
        onOpenChange(next);
      }}
      title={viewing ? `Versión ${viewing.version}` : 'Historial del perfil'}
      description={
        viewing
          ? `${viewing.author} · ${formatDateTime(viewing.created_at)}`
          : 'Cada guardado crea una versión. Restaurar una antigua crea otra versión nueva con esos datos; nada se pierde.'
      }
      size="lg"
    >
      {viewing ? (
        <VersionView
          version={viewing}
          canRestore={canRestore}
          restoring={restoring}
          onRestore={onRestore}
          onBack={() => setViewing(null)}
        />
      ) : versions.isPending ? (
        <Spinner />
      ) : versions.isError ? (
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      ) : versions.data.length === 0 ? (
        <p className="py-6 text-sm text-muted">Todavía no se ha guardado ninguna versión.</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="history-list">
          {versions.data.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Versión {version.version} {version.status === 'active' && <Badge tone="success">Vigente</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {version.author} · {formatDateTime(version.created_at)}
                </p>
                {version.change_note && (
                  <p className="mt-0.5 break-words text-sm text-muted">«{version.change_note}»</p>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setViewing(version)}>
                Ver
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
