import { CheckCircle2, ExternalLink, FileText, Repeat } from 'lucide-react';
import { useState } from 'react';
import { Button, LinkButton } from '@/components/ui';
import { contentPaths, networkLabel } from '@/features/content/labels';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { cn } from '@/lib/utils';
import { publishedText, type PublishedInfo } from './publishedState';
import { RepublishDialog } from './RepublishDialog';
import { useBrandZone } from './useBrandZone';

/** «Ver en Instagram»: el enlace a la publicación en la red (se abre aparte). */
export function NetworkLink({
  info,
  className,
  testId = 'published-link',
  size = 'sm',
}: {
  info: Pick<PublishedInfo, 'url' | 'network'>;
  className?: string;
  testId?: string;
  size?: 'sm' | 'md';
}) {
  if (!info.url) return null;
  return (
    <a
      href={info.url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(buttonClasses('secondary', size), className)}
      data-testid={testId}
    >
      <ExternalLink className="h-4 w-4" aria-hidden />
      Ver en {networkLabel(info.network)}
    </a>
  );
}

/**
 * Una pieza ya publicada, fuera del editor: «Publicada el … a las …», el enlace a Instagram,
 * «Abrir la pieza» y, a propósito y con aviso, «Publicar otra vez». En lugar de programar o
 * publicar: lo publicado no vuelve a salir sin querer.
 */
export function PublishedNotice({
  orgId,
  brandId,
  contentId,
  title,
  info,
  canRepublish,
  showOpen = true,
  testId = 'published-notice',
}: {
  orgId: string;
  brandId: string;
  contentId: string;
  title: string;
  info: PublishedInfo;
  /** Quien puede editar la marca puede hacer una copia para publicarla otra vez. */
  canRepublish: boolean;
  /** «Abrir la pieza» (no hace falta dentro del propio editor). */
  showOpen?: boolean;
  testId?: string;
}) {
  const zone = useBrandZone();
  const [again, setAgain] = useState(false);
  return (
    <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3" data-testid={testId}>
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
        <span data-testid={`${testId}-text`}>{publishedText(info, zone, true)}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <NetworkLink info={info} testId={`${testId}-link`} />
        {showOpen && (
          <LinkButton
            to={contentPaths(orgId, brandId).item(contentId)}
            variant="secondary"
            data-testid={`${testId}-open`}
          >
            <FileText className="h-4 w-4" aria-hidden />
            Abrir la pieza
          </LinkButton>
        )}
        {canRepublish && (
          <Button size="sm" variant="ghost" onClick={() => setAgain(true)} data-testid={`${testId}-again`}>
            <Repeat className="h-4 w-4" aria-hidden />
            Publicar otra vez…
          </Button>
        )}
      </div>
      {canRepublish && again && (
        <RepublishDialog
          orgId={orgId}
          brandId={brandId}
          contentId={contentId}
          title={title}
          published={info}
          open
          onOpenChange={setAgain}
        />
      )}
    </div>
  );
}
