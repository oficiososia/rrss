import { MoreHorizontal, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  PageHeader,
  Select,
  Spinner,
} from '@/components/ui';
import { InviteDialog } from '@/features/invitations/InviteDialog';
import { useBrandMemberMutations, useBrandMembers, useOrgMembers, type BrandMember } from '@/features/orgs/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { BRAND_ROLE_HELP, BRAND_ROLE_LABEL, BRAND_ROLES, ORG_ROLE_LABEL } from '@/features/permissions/roles';
import type { BrandRole } from '@/lib/database.types';
import { translateError } from '@/lib/errors';

export function BrandTeamPage() {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const canManage = can('manage');
  const brandMembers = useBrandMembers(org.id, brand.id);
  const orgMembers = useOrgMembers(org.id);
  const { add, setRole, remove } = useBrandMemberMutations(org.id, brand.id);

  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addUser, setAddUser] = useState('');
  const [addRole, setAddRole] = useState<BrandRole>('editor');
  const [removing, setRemoving] = useState<BrandMember | null>(null);

  const admins = (orgMembers.data ?? []).filter((m) => m.role !== 'member');
  const withAccess = new Set((brandMembers.data ?? []).map((m) => m.user_id));
  const candidates = (orgMembers.data ?? []).filter((m) => m.role === 'member' && !withAccess.has(m.user_id));

  function submitAdd() {
    add.mutate(
      { userId: addUser, role: addRole },
      {
        onSuccess: () => {
          setAdding(false);
          setAddUser('');
          toast.success('Acceso concedido');
        },
        onError: (e) => toast.error(translateError(e)),
      },
    );
  }

  return (
    <>
      <PageHeader
        title="Equipo"
        description={`Quién puede trabajar en ${brand.name} y con qué permisos.`}
        action={
          canManage && (
            <>
              <Button
                variant="secondary"
                onClick={() => setAdding(true)}
                disabled={candidates.length === 0}
                title={candidates.length === 0 ? 'No quedan miembros de la organización por añadir' : undefined}
              >
                Añadir miembro
              </Button>
              <Button onClick={() => setInviting(true)} data-testid="brand-invite-open">
                <UserPlus className="h-4 w-4" aria-hidden />
                Invitar por correo
              </Button>
            </>
          )
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Miembros de la marca" />
          {brandMembers.isPending ? (
            <Spinner />
          ) : brandMembers.isError ? (
            <ErrorState error={brandMembers.error} onRetry={() => void brandMembers.refetch()} />
          ) : brandMembers.data.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nadie más tiene acceso todavía"
              description={
                canManage
                  ? 'Añade a miembros de la organización o invita a alguien por correo.'
                  : 'Solo los administradores de la organización trabajan en esta marca.'
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {brandMembers.data.map((member) => (
                <li
                  key={member.user_id}
                  className="flex items-center gap-3 px-5 py-3"
                  data-testid={`brand-member-${member.email}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.full_name || member.email || 'Tú'}</p>
                    <p className="truncate text-xs text-muted">{member.email}</p>
                  </div>
                  <Badge>{BRAND_ROLE_LABEL[member.role]}</Badge>
                  {canManage && (
                    <Menu>
                      <MenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Acciones para ${member.full_name || member.email}`}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden />
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuLabel>Cambiar rol</MenuLabel>
                        {BRAND_ROLES.filter((r) => r !== member.role).map((role) => (
                          <MenuItem
                            key={role}
                            onSelect={() =>
                              setRole.mutate(
                                { userId: member.user_id, role },
                                {
                                  onSuccess: () => toast.success('Rol actualizado'),
                                  onError: (e) => toast.error(translateError(e)),
                                },
                              )
                            }
                          >
                            {BRAND_ROLE_LABEL[role]}
                          </MenuItem>
                        ))}
                        <MenuSeparator />
                        <MenuItem destructive onSelect={() => setRemoving(member)}>
                          Quitar de la marca
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {admins.length > 0 && (
          <Card>
            <CardHeader
              title="Administradores de la organización"
              description="Gestionan todas las marcas sin necesidad de añadirlos a cada una."
            />
            <ul className="divide-y divide-border">
              {admins.map((member) => (
                <li key={member.user_id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.full_name || member.email}</p>
                    <p className="truncate text-xs text-muted">{member.email}</p>
                  </div>
                  <Badge tone="primary">{ORG_ROLE_LABEL[member.role]}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Añadir miembro a la marca"
        description="Personas que ya están en la organización y aún no tienen acceso a esta marca."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button onClick={submitAdd} loading={add.isPending} disabled={!addUser}>
              Añadir
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Persona">
            {(p) => (
              <Select {...p} value={addUser} onChange={(e) => setAddUser(e.target.value)}>
                <option value="">Elige a alguien…</option>
                {candidates.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name ? `${m.full_name} (${m.email})` : m.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Rol en la marca" hint={BRAND_ROLE_HELP[addRole]}>
            {(p) => (
              <Select {...p} value={addRole} onChange={(e) => setAddRole(e.target.value as BrandRole)}>
                {BRAND_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {BRAND_ROLE_LABEL[role]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Dialog>

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        orgId={org.id}
        orgRoles={['member']}
        brands={[brand]}
        lockBrand
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`¿Quitar a ${removing?.full_name || removing?.email} de la marca?`}
        description="Dejará de ver esta marca, pero seguirá en la organización."
        confirmLabel="Quitar"
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.user_id, {
            onSuccess: () => {
              setRemoving(null);
              toast.success('Acceso retirado');
            },
            onError: (e) => {
              setRemoving(null);
              toast.error(translateError(e));
            },
          })
        }
      />
    </>
  );
}
