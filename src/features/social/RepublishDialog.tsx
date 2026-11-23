import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, Button } from '@/components/ui';
import { useContentMutations } from '@/features/content/api';
import { contentPaths, networkLabel } from '@/features/content/labels';
import { translateError } from '@/lib/errors';
import { publishedText, type PublishedInfo } from './publishedState';
import { useBrandZone } from './useBrandZone';

/**
 * «Publicar otra vez» una pieza que ya salió. Una pieza se publica una sola vez (la base de
 * datos solo admite una publicación viva por pieza), así que lo que se hace es una COPIA: la
 * copia nace como borrador, se abre en el editor y desde allí se aprueba y se publica. Antes
 * se avisa de que en la red saldrá repetida.
 */
export function RepublishDialog({
  orgId,
  brandId,
  contentId,
  title,
  published,
  open,
  onOpenChange,
}: {
  orgId: string;
  brandId: string;
  contentId: string;
  title: string;
  published: PublishedInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const zone = useBrandZone();
  const navigate = useNavigate();
  const mutations = useContentMutations(orgId, brandId);
  const network = networkLabel(published.network);

  const run = () =>
    void mutations.duplicate.mutateAsync(contentId).then(
      (copy) => {
        toast.success('Copia creada: apruébala y publícala desde el editor');
        onOpenChange(false);
        navigate(contentPaths(orgId, brandId).item(copy.id));
      },
      (e) => toast.error(translateError(e)),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Publicar otra vez"
      description={`«${title}» · ${publishedText(published, zone, true)}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={mutations.duplicate.isPending}>
            No, dejarla así
          </Button>
          <Button onClick={run} loading={mutations.duplicate.isPending} data-testid="republish-confirm">
            Hacer una copia para publicarla
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-sm" data-testid="republish-dialog">
        <p className="font-medium text-warning" data-testid="republish-warning">
          Ya está publicada en {network}. Si la publicas otra vez, saldrá repetida.
        </p>
        <p className="text-muted">
          Se crea una copia de la pieza (en borrador). La original se queda como está, con su enlace. La copia se
          aprueba y se publica o programa como cualquier otra.
        </p>
      </div>
    </Dialog>
  );
}
