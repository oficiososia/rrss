import { Link } from 'react-router-dom';
import { Field, Input } from '@/components/ui';
import { useContext } from 'react';
import { BrandContext, OrgContext } from '@/features/orgs/context';
import { useWorkMode } from '@/features/orgs/workMode';
import type { BrandAiReadiness } from './brandReadiness';
import { formatMicros } from './money';

// Lo que se enseña antes de pedir algo a la IA: el aviso del perfil, el sector
// (si hace falta) y el coste máximo. La lógica está en brandReadiness.ts.

/** Una línea: con el perfil completo, los textos se parecen más a la marca (no bloquea nada). */
export function ProfileHint({ readiness }: { readiness: BrandAiReadiness }) {
  const org = useContext(OrgContext)?.org;
  const brand = useContext(BrandContext)?.brand;
  if (!org || !brand || readiness.loading || readiness.percent >= 100) return null;
  return (
    <p className="text-xs text-muted" data-testid="ai-profile-hint">
      {readiness.profileMissing
        ? 'La marca todavía no tiene perfil: la IA escribe con su nombre y su sector. '
        : `Perfil de marca al ${readiness.percent} %. `}
      Con el perfil completo, los textos se parecerán más a tu marca.{' '}
      <Link to={`/o/${org.id}/m/${brand.id}/marca`} className="font-medium text-primary underline">
        Completar el perfil
      </Link>
    </p>
  );
}

/** «¿A qué se dedica la marca?»: lo único que hace falta si no hay perfil ni sector. */
export function SectorField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field
      label="¿A qué se dedica la marca?"
      hint="Una línea basta (por ejemplo, «coctelería» o «gimnasio»). Sin esto, la IA tendría que inventárselo."
    >
      {(props) => (
        <Input
          {...props}
          maxLength={120}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          data-testid="ai-brand-sector"
        />
      )}
    </Field>
  );
}

/** «Coste máximo: 0,02 €» antes de pulsar; nada mientras se calcula o si el servidor no sabe calcularlo. */
export function MaxCostLine({
  micros,
  testId,
  what,
}: {
  micros: number | undefined;
  testId: string;
  /** «este plan», «estas propuestas»… */
  what: string;
}) {
  const { selfManaged } = useWorkMode();
  if (micros === undefined) return null;
  return (
    <p className="text-xs text-muted" data-testid={testId}>
      Coste máximo de {what}: <span className="font-medium text-fg">{formatMicros(micros)}</span>
      {selfManaged ? '' : ' del cupo de IA'}. Suele costar menos; si la respuesta no sirve, no se cobra.
    </p>
  );
}
