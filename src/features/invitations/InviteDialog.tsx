import { Check, Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Field, Input, Notice, Select } from '@/components/ui';
import { invitationLink, useCreateInvitation } from '@/features/orgs/api';
import {
  BRAND_ROLE_HELP,
  BRAND_ROLE_LABEL,
  BRAND_ROLES,
  ORG_ROLE_HELP,
  ORG_ROLE_LABEL,
} from '@/features/permissions/roles';
import type { BrandRole, BrandRow, OrgRole } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { copyText } from '@/lib/utils';

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  /** Roles de organización que puede conceder quien invita. */
  orgRoles: OrgRole[];
  /** Marcas a las que puede invitar. Con una sola y `lockBrand`, la marca va fija. */
  brands: BrandRow[];
  lockBrand?: boolean;
}

export function InviteDialog({ open, onOpenChange, orgId, orgRoles, brands, lockBrand = false }: InviteDialogProps) {
  const create = useCreateInvitation(orgId);
  const [email, setEmail] = useState('');
  const [orgRole, setOrgRole] = useState<OrgRole>('member');
  const [brandId, setBrandId] = useState<string>(lockBrand ? (brands[0]?.id ?? '') : '');
  const [brandRole, setBrandRole] = useState<BrandRole>('editor');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Los administradores ya gestionan todas las marcas: no tiene sentido darles un rol de marca.
  const needsBrand = orgRole === 'member';
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  function close(next: boolean) {
    if (!next) {
      setEmail('');
      setLink(null);
      setCopied(false);
      create.reset();
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const withBrand = needsBrand && brandId !== '';
    create.mutate(
      { email, orgRole, brandId: withBrand ? brandId : null, brandRole: withBrand ? brandRole : null },
      { onSuccess: (token) => setLink(invitationLink(token)) },
    );
  }

  async function copy() {
    if (!link) return;
    if (await copyText(link)) {
      setCopied(true);
      toast.success('Enlace copiado');
    } else {
      toast.error('No se ha podido copiar. Selecciónalo y cópialo a mano.');
    }
  }

  if (link) {
    return (
      <Dialog
        open={open}
        onOpenChange={close}
        title="Invitación creada"
        description={`Envía este enlace a ${email.trim().toLowerCase()}. Solo se muestra ahora.`}
        footer={<Button onClick={() => close(false)}>Hecho</Button>}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              readOnly
              value={link}
              aria-label="Enlace de invitación"
              onFocus={(e) => e.target.select()}
              data-testid="invite-link"
              className="font-mono text-xs"
            />
            <Button variant="secondary" onClick={() => void copy()} aria-label="Copiar enlace">
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              Copiar
            </Button>
          </div>
          <Notice tone="warning">
            El envío automático por correo todavía no está disponible: tienes que hacerle llegar el enlace tú. Caduca en
            14 días y solo sirve para la cuenta con ese correo.
          </Notice>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Invitar a una persona"
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="invite-form"
            loading={create.isPending}
            disabled={!emailValid || (lockBrand && !brandId)}
            data-testid="invite-submit"
          >
            Crear invitación
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="space-y-4">
        <Field label="Correo electrónico">
          {(p) => (
            <Input
              {...p}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="invite-email"
            />
          )}
        </Field>
        {orgRoles.length > 1 && (
          <Field label="Rol en la organización" hint={ORG_ROLE_HELP[orgRole]}>
            {(p) => (
              <Select
                {...p}
                value={orgRole}
                onChange={(e) => setOrgRole(e.target.value as OrgRole)}
                data-testid="invite-org-role"
              >
                {orgRoles.map((role) => (
                  <option key={role} value={role}>
                    {ORG_ROLE_LABEL[role]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {needsBrand && brands.length > 0 && (
          <>
            {!lockBrand && (
              <Field
                label="Marca"
                hint="Sin marca, la persona entra en la organización pero no verá ninguna hasta que le des acceso."
              >
                {(p) => (
                  <Select
                    {...p}
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    data-testid="invite-brand"
                  >
                    <option value="">Ninguna por ahora</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {brandId && (
              <Field label="Rol en la marca" hint={BRAND_ROLE_HELP[brandRole]}>
                {(p) => (
                  <Select
                    {...p}
                    value={brandRole}
                    onChange={(e) => setBrandRole(e.target.value as BrandRole)}
                    data-testid="invite-brand-role"
                  >
                    {BRAND_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {BRAND_ROLE_LABEL[role]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </>
        )}
        {create.isError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {translateError(create.error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
