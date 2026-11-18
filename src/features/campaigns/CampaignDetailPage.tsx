import { Check, ChevronLeft, ExternalLink, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  Notice,
  Skeleton,
  Spinner,
  Textarea,
} from '@/components/ui';
import { contentPaths, networkLabel, targetLabel } from '@/features/content/labels';
import { STATUS_LABEL, STATUS_TONE } from '@/features/content/status';
import { useAssetsByIds } from '@/features/library/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { REQUEST_STATUS_LABEL, requestPaths } from '@/features/requests/labels';
import type { CampaignRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { formatDateTime } from '@/lib/utils';
import { useCampaign, useCampaignContents, useCampaignMutations, useCampaignPlan, useCampaignRequest } from './api';
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, campaignPaths } from './labels';
import { campaignPlanSchema, shortDay, validatePlan, type CampaignPiece, type CampaignPlan } from './plan';

export function CampaignDetailPage() {
  const { campaignId = '' } = useParams();
  const { brand } = useBrand();
  const campaign = useCampaign(brand.id, campaignId);
  if (campaign.isPending) return <Spinner />;
  if (campaign.isError) return <ErrorState error={campaign.error} onRetry={() => void campaign.refetch()} />;
  return <CampaignDetail campaign={campaign.data} />;
}

const SOURCE_LABEL = { ai: 'Propuesto por la IA', agency: 'Preparado por la agencia' } as const;

function CampaignDetail({ campaign }: { campaign: CampaignRow }) {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const paths = campaignPaths(org.id, brand.id);
  const mutations = useCampaignMutations(brand.id);
  const plan = useCampaignPlan(brand.id, campaign.id, campaign.current_plan_version);
  const contents = useCampaignContents(brand.id, campaign.id, campaign.status === 'accepted');
  const request = useCampaignRequest(brand.id, campaign.id, campaign.origin === 'agency');
  const canDecide = can('edit') || (campaign.origin === 'agency' && can('approve'));
  const waitingAgency =
    campaign.origin === 'agency' && campaign.status === 'proposed' && request.data?.status !== 'delivered';
  const editable = campaign.status === 'proposed' && canDecide && !waitingAgency;

  const parsed = plan.data ? campaignPlanSchema.safeParse(plan.data.data) : null;
  // Lo que la persona retoca vale para la versión del plan que tenía abierta.
  const [edits, setEdits] = useState<{ planId: string; plan: CampaignPlan } | null>(null);
  const draft: CampaignPlan | null =
    edits && edits.planId === plan.data?.id ? edits.plan : parsed?.success ? parsed.data : null;
  function setDraft(change: (current: CampaignPlan) => CampaignPlan) {
    if (!draft || !plan.data) return;
    setEdits({ planId: plan.data.id, plan: change(draft) });
  }
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const check = draft ? validatePlan(draft, campaign) : null;

  function updatePiece(index: number, patch: Partial<CampaignPiece>) {
    setDraft((current) => ({
      ...current,
      pieces: current.pieces.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  }
  function removePiece(index: number) {
    setDraft((current) => ({ ...current, pieces: current.pieces.filter((_, i) => i !== index) }));
  }

  async function accept() {
    try {
      await mutations.accept.mutateAsync({ campaign, plan: draft });
      setConfirmAccept(false);
      toast.success('Plan aceptado: sus piezas están en Contenidos como borradores');
    } catch (error) {
      setConfirmAccept(false);
      toast.error(translateError(error));
    }
  }

  async function discard() {
    try {
      await mutations.discard.mutateAsync(campaign.id);
      setConfirmDiscard(false);
      toast.success('Campaña descartada');
    } catch (error) {
      setConfirmDiscard(false);
      toast.error(translateError(error));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={paths.list} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Campañas
          </Link>
          <h1 className="text-2xl" data-testid="campaign-title-heading">
            {campaign.title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
              <span data-testid="campaign-status">{CAMPAIGN_STATUS_LABEL[campaign.status]}</span>
            </Badge>
            <span>
              {shortDay(campaign.starts_on)} – {shortDay(campaign.ends_on)}
            </span>
            <span>· {campaign.networks.map(networkLabel).join(', ')}</span>
            <span>· {SOURCE_LABEL[campaign.origin]}</span>
          </p>
        </div>
        {canDecide && (campaign.status === 'proposed' || campaign.status === 'requested') && (
          <div className="flex flex-wrap gap-2">
            {editable && draft && (
              <Button
                onClick={() => setConfirmAccept(true)}
                disabled={!check?.ok}
                title={check && !check.ok ? 'Revisa las piezas marcadas' : undefined}
                data-testid="campaign-accept"
              >
                <Check className="h-4 w-4" aria-hidden />
                Aceptar y crear {draft.pieces.length} borradores
              </Button>
            )}
            <Button variant="ghost" onClick={() => setConfirmDiscard(true)} data-testid="campaign-discard">
              <XCircle className="h-4 w-4" aria-hidden />
              Descartar
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader title="Lo que se pidió" />
        <CardBody>
          <p className="whitespace-pre-wrap text-sm" data-testid="campaign-instruction-text">
            {campaign.instruction}
          </p>
        </CardBody>
      </Card>

      {campaign.origin === 'agency' && request.data && (
        <Notice tone={waitingAgency || campaign.status === 'requested' ? 'warning' : 'info'}>
          <span data-testid="campaign-agency-notice">
            {campaign.status === 'requested'
              ? 'La agencia está preparando el plan. Lo verás aquí en cuanto lo entregue.'
              : waitingAgency
                ? 'Has pedido cambios a la agencia: el plan se podrá aceptar cuando entregue la versión nueva.'
                : `Encargo a la agencia: ${REQUEST_STATUS_LABEL[request.data.status]}.`}{' '}
            <Link className="underline" to={requestPaths(org.id, brand.id).item(request.data.id)}>
              Ver el encargo{campaign.status === 'proposed' && !waitingAgency ? ' (para pedir cambios)' : ''}
            </Link>
          </span>
        </Notice>
      )}

      {campaign.status === 'accepted' && (
        <Card data-testid="campaign-pieces">
          <CardHeader
            title="Piezas creadas"
            description="Son borradores: ábrelos en el editor, revísalos y pásalos a revisión o aprobación como cualquier otra pieza."
          />
          <CardBody>
            {contents.isPending ? (
              <Skeleton className="h-24" />
            ) : contents.isError ? (
              <ErrorState error={contents.error} onRetry={() => void contents.refetch()} />
            ) : (
              <ul className="divide-y divide-border" data-testid="campaign-piece-list">
                {contents.data.map((piece) => (
                  <li key={piece.content_id} className="flex items-center gap-3 py-2" data-testid="campaign-piece-row">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{piece.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {targetLabel(piece.network, piece.format)}
                      </span>
                    </span>
                    {piece.status && (
                      <Badge tone={STATUS_TONE[piece.status]}>
                        <span data-testid="campaign-piece-status">{STATUS_LABEL[piece.status]}</span>
                      </Badge>
                    )}
                    <Link
                      to={contentPaths(org.id, brand.id).item(piece.content_id)}
                      aria-label={`Abrir ${piece.title}`}
                    >
                      <Button variant="secondary" size="sm">
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        Abrir
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {campaign.current_plan_version > 0 &&
        (plan.isPending ? (
          <Skeleton className="h-48" />
        ) : plan.isError ? (
          <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />
        ) : !draft ? (
          <Notice tone="warning">Este plan no tiene el formato esperado y no se puede mostrar.</Notice>
        ) : (
          <PlanView
            brandId={brand.id}
            plan={draft}
            version={campaign.current_plan_version}
            createdAt={plan.data.created_at}
            editable={editable}
            issues={check && !check.ok ? check.issues : []}
            onChange={updatePiece}
            onRemove={removePiece}
          />
        ))}

      <ConfirmDialog
        open={confirmAccept}
        onOpenChange={setConfirmAccept}
        title="¿Aceptar el plan?"
        description={`Se crearán ${draft?.pieces.length ?? 0} piezas como borradores en Contenidos. No se aprueba, no se programa y no se publica nada.`}
        confirmLabel="Aceptar y crear borradores"
        destructive={false}
        loading={mutations.accept.isPending}
        onConfirm={() => void accept()}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="¿Descartar la campaña?"
        description={
          campaign.origin === 'agency'
            ? 'No se creará ninguna pieza y el encargo a la agencia quedará cancelado.'
            : 'No se creará ninguna pieza. El plan se conserva para consultarlo.'
        }
        confirmLabel="Descartar"
        loading={mutations.discard.isPending}
        onConfirm={() => void discard()}
      />
    </div>
  );
}

function ReasonList({
  title,
  items,
  empty,
  testId,
}: {
  title: string;
  items: string[];
  empty: string;
  testId: string;
}) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}

function PlanView({
  brandId,
  plan,
  version,
  createdAt,
  editable,
  issues,
  onChange,
  onRemove,
}: {
  brandId: string;
  plan: CampaignPlan;
  version: number;
  createdAt: string;
  editable: boolean;
  issues: { path: string; message: string }[];
  onChange: (index: number, patch: Partial<CampaignPiece>) => void;
  onRemove: (index: number) => void;
}) {
  const assetIds = [...new Set(plan.pieces.flatMap((p) => p.assetIds))];
  const assets = useAssetsByIds(brandId, assetIds);
  const names = new Map((assets.data ?? []).map((a) => [a.id, a.file_name]));
  const issuesOf = (index: number) => issues.filter((i) => i.path.startsWith(`pieces.${index}.`));

  return (
    <>
      <Card data-testid="campaign-plan">
        <CardHeader title="Plan" description={`Versión ${version} · ${formatDateTime(createdAt)}`} />
        <CardBody className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Objetivo</h3>
            <p className="text-sm" data-testid="campaign-objective">
              {plan.objective}
            </p>
            {plan.summary && <p className="mt-1 text-sm text-muted">{plan.summary}</p>}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <ReasonList
              title="Lo observado"
              items={plan.reasoning.observed}
              empty="Nada anotado."
              testId="reason-observed"
            />
            <ReasonList
              title="Respaldado por datos"
              items={plan.reasoning.dataBacked}
              empty={plan.reasoning.dataNote || 'Nada respaldado por datos.'}
              testId="reason-data"
            />
            <ReasonList
              title="Hipótesis"
              items={plan.reasoning.hypotheses}
              empty="Ninguna."
              testId="reason-hypotheses"
            />
          </div>
        </CardBody>
      </Card>

      <section className="space-y-3" aria-label="Piezas del plan">
        <h2 className="text-lg font-semibold">
          {plan.pieces.length} {plan.pieces.length === 1 ? 'pieza' : 'piezas'}
        </h2>
        {plan.pieces.length === 0 && (
          <Notice tone="warning">
            Has quitado todas las piezas: no hay nada que aceptar. Descarta la campaña o vuelve a abrirla.
          </Notice>
        )}
        <ol className="space-y-3" data-testid="campaign-plan-pieces">
          {plan.pieces.map((piece, index) => (
            <li key={index} data-testid="campaign-plan-piece">
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-semibold">{shortDay(piece.date)}</span> ·{' '}
                      {targetLabel(piece.network, piece.format)}
                    </div>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemove(index)}
                        data-testid="campaign-piece-remove"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        Quitar
                      </Button>
                    )}
                  </div>
                  {editable ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                        <Field label="Fecha">
                          {(props) => (
                            <Input
                              {...props}
                              type="date"
                              value={piece.date}
                              onChange={(e) => onChange(index, { date: e.target.value })}
                            />
                          )}
                        </Field>
                        <Field label="Idea">
                          {(props) => (
                            <Input
                              {...props}
                              maxLength={300}
                              value={piece.idea}
                              onChange={(e) => onChange(index, { idea: e.target.value })}
                              data-testid="campaign-piece-idea"
                            />
                          )}
                        </Field>
                      </div>
                      <Field label="Texto (borrador)">
                        {(props) => (
                          <Textarea
                            {...props}
                            rows={3}
                            maxLength={5000}
                            value={piece.caption}
                            onChange={(e) => onChange(index, { caption: e.target.value })}
                            data-testid="campaign-piece-caption"
                          />
                        )}
                      </Field>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">{piece.idea}</p>
                      <p className="whitespace-pre-wrap text-sm" data-testid="campaign-piece-caption-text">
                        {piece.caption}
                      </p>
                    </>
                  )}
                  {piece.hashtags.length > 0 && (
                    <p className="text-sm text-muted">{piece.hashtags.map((tag) => `#${tag}`).join(' ')}</p>
                  )}
                  {piece.assetIds.length > 0 && (
                    <p className="text-xs text-muted">
                      Recursos sugeridos:{' '}
                      {piece.assetIds.map((id) => names.get(id) ?? 'recurso de la biblioteca').join(', ')}
                    </p>
                  )}
                  {piece.why && (
                    <p className="text-xs text-muted">
                      <span className="font-medium">Por qué: </span>
                      {piece.why}
                    </p>
                  )}
                  {issuesOf(index).map((issue) => (
                    <p key={issue.path} role="alert" className="text-xs font-medium text-danger">
                      {issue.message}
                    </p>
                  ))}
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
