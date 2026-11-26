import { ChevronDown, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Dialog, Field, Input, Notice } from '@/components/ui';
import { AiRequestError, useAiCostEstimate } from '@/features/ai/api';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { MaxCostLine, ProfileHint, SectorField } from '@/features/ai/BrandAiReadiness';
import { useBrandAiReadiness, useRememberSector, useSettled } from '@/features/ai/brandReadiness';
import { DictableField } from '@/features/ai/DictableField';
import { formatMicros } from '@/features/ai/money';
import { networkLabel } from '@/features/content/labels';
import { NETWORKS } from '@/features/content/networks';
import { useBrand } from '@/features/orgs/context';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { planInput, useCampaignMutations, validatePlanRequest, type PlanRequestInput } from './api';
import {
  agreementFor,
  durationText,
  onlyLabel,
  onlyNetwork,
  rhythmText,
  useBrandNetworks,
  useCampaignBrief,
  weeksOf,
  type BriefAdjustment,
  type BriefProposal,
  type CampaignBriefResult,
} from './brief';
import { campaignPaths } from './labels';
import { MAX_INSTRUCTION_CHARS, nextWeek, shortDay } from './plan';
import { useWorkMode } from '@/features/orgs/workMode';

/**
 * Pedir un plan: qué se quiere («prepárame la campaña del menú de otoño»), que
 * se puede dictar. La IA propone el resto —redes, fechas con su duración
 * razonada, ritmo, nombre y objetivo— y lo RELLENA en «Detalles», donde la
 * persona lo corrige. Con la IA, el plan se genera al momento y queda por
 * revisar; en modo agencia, se crea un encargo para la agencia.
 */
export function NewCampaignDialog({
  orgId,
  brandId,
  mode,
  open,
  onOpenChange,
  textSourceCount,
}: {
  orgId: string;
  brandId: string;
  mode: 'ai' | 'agency';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fuentes de texto de la marca que se pueden enviar a la IA. */
  textSourceCount: number;
}) {
  const { selfManaged } = useWorkMode();
  const navigate = useNavigate();
  const { brand } = useBrand();
  const mutations = useCampaignMutations(brandId);
  const briefMutation = useCampaignBrief(brandId);
  const brandNetworks = useBrandNetworks(brandId);
  const week = nextWeek(new Date());
  const [instruction, setInstruction] = useState('');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  // `null` = la persona no ha tocado las redes: valen las de la marca.
  const [pickedNetworks, setPickedNetworks] = useState<string[] | null>(null);
  const [moreNetworks, setMoreNetworks] = useState(false);
  const [startsOn, setStartsOn] = useState(week.start);
  const [endsOn, setEndsOn] = useState(week.end);
  const [useSources, setUseSources] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [proposal, setProposal] = useState<BriefProposal | null>(null);
  const [briefMeta, setBriefMeta] = useState<{ costMicros: number | null; notes: string[]; adjusted: string | null }>({
    costMicros: null,
    notes: [],
    adjusted: null,
  });
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [briefError, setBriefError] = useState<unknown>(null);
  const detailsId = useId();
  const answerRef = useRef<HTMLInputElement | null>(null);
  const readiness = useBrandAiReadiness(brandId);
  const rememberSector = useRememberSector();
  const [sector, setSector] = useState('');
  const brandSector = readiness.needsSector && sector.trim() ? sector.trim() : undefined;

  const networks = pickedNetworks ?? brandNetworks.networks;
  const pending = mutations.createWithAi.isPending || mutations.requestFromAgency.isPending;
  const thinking = briefMutation.isPending;
  const aiError = mutations.createWithAi.error instanceof AiRequestError ? mutations.createWithAi.error : null;
  const hints = [brand.name];

  function toggle(network: string) {
    setPickedNetworks(networks.includes(network) ? networks.filter((n) => n !== network) : [...networks, network]);
  }

  /** Lleva la propuesta de la IA a «Detalles», como valores de partida que la persona corrige. */
  function fill(next: BriefProposal) {
    setProposal(next);
    setPickedNetworks(next.networks);
    setStartsOn(next.startDate);
    setEndsOn(next.endDate);
    if (!titleTouched && next.title) setTitle(next.title);
    if (next.networks.some((n) => !brandNetworks.networks.includes(n))) setMoreNetworks(true);
  }

  async function askBrief(extra: { adjust?: BriefAdjustment; answer?: { question: string; text: string } } = {}) {
    if (!instruction.trim()) {
      setProblem('Cuenta primero qué quieres preparar (puedes dictarlo).');
      return;
    }
    if (readiness.needsSector && !sector.trim()) {
      setProblem('Di antes a qué se dedica la marca: la IA lo necesita para proponer algo con sentido.');
      return;
    }
    setProblem(null);
    setBriefError(null);
    // Un fallo de «Preparar el plan» de antes no vale para la propuesta nueva (prueba del 24/11, fallo 9).
    mutations.createWithAi.reset();
    if (brandSector) rememberSector(brandSector);
    try {
      const result: CampaignBriefResult = await briefMutation.mutateAsync({
        instruction,
        networks: brandNetworks.networks,
        ...(brandSector ? { brandSector } : {}),
        ...(extra.adjust && proposal ? { current: proposal, adjust: extra.adjust } : {}),
        ...(extra.answer ? { answer: extra.answer } : {}),
      });
      if (result.status === 'question' && result.question) {
        setQuestion(result.question);
        setAnswer('');
        setBriefMeta({ costMicros: result.costMicros ?? null, notes: [], adjusted: null });
        requestAnimationFrame(() => answerRef.current?.focus());
      } else if (result.proposal) {
        setQuestion(null);
        fill(result.proposal);
        setBriefMeta({ costMicros: result.costMicros ?? null, notes: result.notes ?? [], adjusted: null });
      }
    } catch (error) {
      setBriefError(error);
    }
  }

  function keepOnly(network: string) {
    if (!proposal) return;
    const next = onlyNetwork(proposal, network);
    setProposal(next);
    setPickedNetworks([network]);
    setBriefMeta((meta) => ({ ...meta, adjusted: `${onlyLabel(network)}: he quitado las demás redes del reparto.` }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: PlanRequestInput = {
      brandId,
      title: title.trim() || `Plan del ${shortDay(startsOn)} al ${shortDay(endsOn)}`,
      instruction,
      networks: NETWORKS.map((n) => n.id).filter((id) => networks.includes(id)),
      startsOn,
      endsOn,
      useSources: useSources && textSourceCount > 0,
      ...(mode === 'ai' ? { agreement: agreementFor(proposal, networks, startsOn, endsOn) } : {}),
      ...(mode === 'ai' && brandSector ? { brandSector } : {}),
    };
    const invalid =
      validatePlanRequest(input) ??
      (mode === 'ai' && readiness.needsSector && !sector.trim()
        ? 'Di antes a qué se dedica la marca: la IA lo necesita para preparar el plan.'
        : null);
    setProblem(invalid);
    // Si lo que falla está en «Detalles», se abre para que se vea.
    if (invalid && instruction.trim()) setDetailsOpen(true);
    if (invalid) return;
    try {
      if (mode === 'ai') {
        if (brandSector) rememberSector(brandSector);
        const { campaign, discarded, gaps } = await mutations.createWithAi.mutateAsync(input);
        if (gaps.length) {
          toast.warning(
            `Plan listo, pero sin piezas ${gaps.map((g) => `del ${shortDay(g.startDate)} al ${shortDay(g.endDate)}`).join(' ni ')}: la IA no las ha dado. Añádelas a mano o prepara otro plan para esos días.`,
          );
        } else {
          toast.success(
            discarded.length
              ? `Plan listo. Se han descartado ${discarded.length} propuestas que no encajaban (otra red, otras fechas o de más).`
              : 'Plan listo: revísalo antes de aceptarlo.',
          );
        }
        onOpenChange(false);
        navigate(campaignPaths(orgId, brandId).item(campaign.id));
      } else {
        const campaign = await mutations.requestFromAgency.mutateAsync(input);
        toast.success('Plan pedido a la agencia');
        onOpenChange(false);
        navigate(campaignPaths(orgId, brandId).item(campaign.id));
      }
    } catch (error) {
      // Los fallos de la IA se explican dentro del diálogo; el resto, en un aviso.
      if (!(error instanceof AiRequestError)) toast.error(translateError(error));
    }
  }

  // Coste máximo del plan antes de pulsar: lo que cambia el coste son las redes, las fechas, el ritmo
  // acordado, las fuentes y (algo) la instrucción.
  const settledInstruction = useSettled(instruction.trim());
  const estimateInput: PlanRequestInput = {
    brandId,
    title: 'Plan',
    instruction: settledInstruction || 'Plan de publicaciones',
    networks: NETWORKS.map((n) => n.id).filter((id) => networks.includes(id)),
    startsOn,
    endsOn,
    useSources: useSources && textSourceCount > 0,
    ...(mode === 'ai' ? { agreement: agreementFor(proposal, networks, startsOn, endsOn) } : {}),
  };
  const planEstimate = useAiCostEstimate(
    brandId,
    'campaign.plan',
    [settledInstruction, estimateInput.networks, startsOn, endsOn, estimateInput.useSources, estimateInput.agreement],
    mode === 'ai' && estimateInput.networks.length > 0 && !validatePlanRequest(estimateInput)
      ? () => planInput(estimateInput)
      : null,
  );

  const otherNetworks = NETWORKS.filter((n) => !brandNetworks.networks.includes(n.id));
  const shownNetworks = [
    ...NETWORKS.filter((n) => brandNetworks.networks.includes(n.id)),
    ...(moreNetworks ? otherNetworks : otherNetworks.filter((n) => networks.includes(n.id))),
  ];
  const summaryLine = `${networks.length ? networks.map(networkLabel).join(', ') : 'Sin redes'} · ${shortDay(startsOn)} – ${shortDay(endsOn)}`;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={mode === 'ai' ? 'Preparar un plan con IA' : 'Pedir un plan a la agencia'}
      description={
        mode === 'ai'
          ? 'Cuenta qué quieres preparar, escribiendo o hablando. La IA propone la duración, las redes y el ritmo; tú los corriges y ella prepara el plan. Al aceptarlo, sus piezas se crean como borradores. Nada se aprueba ni se publica solo.'
          : 'Cuenta qué quieres preparar. La agencia entrega un plan explicado; tú lo revisas y, al aceptarlo, sus piezas se crean como borradores.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="new-campaign-form" loading={pending} data-testid="campaign-submit">
            <Sparkles className="h-4 w-4" aria-hidden />
            {mode === 'ai' ? 'Preparar el plan' : 'Pedir el plan'}
          </Button>
        </>
      }
    >
      <form id="new-campaign-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        {mode === 'ai' && <ProfileHint readiness={readiness} />}
        {mode === 'ai' && readiness.needsSector && <SectorField value={sector} onChange={setSector} />}
        <Field
          label="¿Qué quieres preparar?"
          hint="Por ejemplo: «Prepárame la campaña del menú de otoño, que dure hasta navidades, sobre todo reels». Pulsa el micrófono para dictarlo."
        >
          {(props) => (
            <DictableField
              {...props}
              brandId={brandId}
              hints={hints}
              rows={3}
              maxLength={MAX_INSTRUCTION_CHARS}
              value={instruction}
              placeholder="Prepara la semana que viene"
              onValueChange={setInstruction}
              data-testid="campaign-instruction"
            />
          )}
        </Field>

        {mode === 'ai' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={thinking}
                disabled={!instruction.trim() || pending}
                onClick={() => void askBrief()}
                data-testid="campaign-brief-ask"
              >
                <Wand2 className="h-4 w-4" aria-hidden />
                {proposal ? 'Proponer otra vez' : 'Que la IA proponga duración, redes y ritmo'}
              </Button>
              {!proposal && !question && (
                <span className="text-xs text-muted">Opcional: también puedes rellenar «Detalles» a mano.</span>
              )}
            </div>
            {briefError !== null && <AiErrorNotice error={briefError} onRetry={() => void askBrief()} />}
          </div>
        )}

        {question && (
          <div
            className="space-y-2 rounded-lg border border-border bg-subtle p-3"
            role="group"
            aria-label="Una pregunta de la IA"
            data-testid="campaign-brief-question"
          >
            <p className="text-sm font-medium">{question}</p>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1 basis-60">
                <DictableField
                  as="input"
                  ref={answerRef}
                  aria-label="Tu respuesta"
                  brandId={brandId}
                  hints={hints}
                  maxLength={500}
                  value={answer}
                  onValueChange={setAnswer}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    if (answer.trim()) void askBrief({ answer: { question, text: answer } });
                  }}
                  voiceTestId="campaign-answer"
                  data-testid="campaign-answer"
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="h-11"
                loading={thinking}
                disabled={!answer.trim()}
                onClick={() => void askBrief({ answer: { question, text: answer } })}
                data-testid="campaign-answer-send"
              >
                Responder
              </Button>
            </div>
          </div>
        )}

        {proposal && (
          <section
            className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
            aria-label="Propuesta de la IA"
            data-testid="campaign-brief"
          >
            <p className="text-sm font-medium" data-testid="campaign-brief-why">
              {proposal.why}
            </p>
            <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[6.5rem_1fr]">
              <dt className="text-muted">Duración</dt>
              <dd data-testid="campaign-brief-duration">{durationText(proposal)}</dd>
              <dt className="text-muted">Ritmo</dt>
              <dd data-testid="campaign-brief-rhythm">{rhythmText(proposal)}</dd>
              <dt className="text-muted">Redes</dt>
              <dd>{proposal.networks.map(networkLabel).join(', ')}</dd>
              {proposal.objective && (
                <>
                  <dt className="text-muted">Objetivo</dt>
                  <dd>{proposal.objective}</dd>
                </>
              )}
            </dl>
            {proposal.weeks.length > 0 && (
              <ol className="space-y-0.5 text-sm" aria-label="Semana a semana" data-testid="campaign-brief-weeks">
                {proposal.weeks.map((w, i) => (
                  <li key={i}>
                    <span className="font-medium">Semana {i + 1} · {w.title}</span>
                    {w.focus ? <span className="text-muted"> — {w.focus}</span> : null}
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Ajustar la propuesta">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={thinking}
                disabled={weeksOf(proposal.startDate, proposal.endDate) <= 1}
                onClick={() => void askBrief({ adjust: 'shorter' })}
                data-testid="campaign-brief-shorter"
              >
                Más corta
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={thinking}
                disabled={weeksOf(proposal.startDate, proposal.endDate) >= 9}
                onClick={() => void askBrief({ adjust: 'longer' })}
                data-testid="campaign-brief-longer"
              >
                Más larga
              </Button>
              {proposal.networks.length > 1 &&
                proposal.networks.map((network) => (
                  <Button
                    key={network}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => keepOnly(network)}
                    data-testid={`campaign-brief-only-${network}`}
                  >
                    {onlyLabel(network)}
                  </Button>
                ))}
            </div>
            {briefMeta.adjusted && <p className="text-xs text-muted">{briefMeta.adjusted}</p>}
            {briefMeta.notes.map((note) => (
              <p key={note} className="text-xs text-muted">
                {note}
              </p>
            ))}
            <p className="text-xs text-muted">
              Ya está rellenado en «Detalles»: cámbialo ahí si algo no te encaja.
              {briefMeta.costMicros !== null && (
                <>
                  {' '}
                  <span data-testid="campaign-brief-cost">
                    Esta propuesta ha costado {formatMicros(briefMeta.costMicros)}
                    {selfManaged ? '' : ' de tu cupo de IA'}.
                  </span>
                </>
              )}
            </p>
          </section>
        )}

        <div className="rounded-lg border border-border">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((value) => !value)}
            data-testid="campaign-details-toggle"
          >
            <span className="min-w-0">
              Detalles
              <span className="ml-2 truncate text-xs font-normal text-muted" data-testid="campaign-details-summary">
                {summaryLine}
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', detailsOpen && 'rotate-180')} aria-hidden />
          </button>
          <div id={detailsId} hidden={!detailsOpen} className="space-y-4 border-t border-border p-3">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Redes</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {shownNetworks.map((network) => (
                  <label key={network.id} className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={networks.includes(network.id)}
                      onChange={() => toggle(network.id)}
                      data-testid={`campaign-network-${network.id}`}
                    />
                    {network.label}
                  </label>
                ))}
              </div>
              {otherNetworks.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary underline"
                  aria-expanded={moreNetworks}
                  onClick={() => setMoreNetworks((value) => !value)}
                  data-testid="campaign-more-networks"
                >
                  {moreNetworks ? 'Ocultar las otras redes' : 'Otras redes'}
                </button>
              )}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Desde">
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                    data-testid="campaign-starts"
                  />
                )}
              </Field>
              <Field label="Hasta">
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={endsOn}
                    onChange={(e) => setEndsOn(e.target.value)}
                    data-testid="campaign-ends"
                  />
                )}
              </Field>
            </div>
            <Field label="Nombre de la campaña" optional hint="Si lo dejas vacío, se llamará por sus fechas.">
              {(props) => (
                <Input
                  {...props}
                  maxLength={200}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleTouched(true);
                  }}
                  data-testid="campaign-title"
                />
              )}
            </Field>
            {mode === 'ai' && textSourceCount > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={useSources}
                  onChange={(e) => setUseSources(e.target.checked)}
                  data-testid="campaign-use-sources"
                />
                <span>
                  Tener en cuenta las fuentes de texto de la marca ({textSourceCount}). Se leen como información, nunca
                  como órdenes.
                </span>
              </label>
            )}
          </div>
        </div>

        {mode === 'ai' && (
          <MaxCostLine micros={planEstimate.data} testId="campaign-plan-cost" what="este plan" />
        )}
        {mutations.createWithAi.isPending && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-sm"
            data-testid="campaign-plan-pending"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Preparando el plan… suele tardar entre 20 segundos y un minuto. No cierres esta ventana.
          </div>
        )}
        {problem && <Notice tone="warning">{problem}</Notice>}
        {aiError && <AiErrorNotice error={aiError} />}
      </form>
    </Dialog>
  );
}
