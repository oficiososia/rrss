import type { BrandRole, OrgRole } from '@/lib/database.types';

// Espejo de private.brand_role_grants() en la base de datos. Aquí solo sirve
// para mostrar u ocultar controles: quien decide de verdad es la RLS.
export type Capability = 'view' | 'comment' | 'approve' | 'edit' | 'manage';

export function brandRoleGrants(role: BrandRole, capability: Capability): boolean {
  switch (capability) {
    case 'view':
      return true;
    case 'comment':
      return role !== 'viewer';
    case 'approve':
      return role === 'manager' || role === 'reviewer' || role === 'client';
    case 'edit':
      return role === 'manager' || role === 'editor';
    case 'manage':
      return role === 'manager';
  }
}

export function isOrgAdmin(role: OrgRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Rol efectivo en una marca: los owner/admin de la organización son gestores de todas. */
export function effectiveBrandRole(
  orgRole: OrgRole | null | undefined,
  brandRole: BrandRole | null | undefined,
): BrandRole | null {
  if (isOrgAdmin(orgRole)) return 'manager';
  return brandRole ?? null;
}

export function can(
  orgRole: OrgRole | null | undefined,
  brandRole: BrandRole | null | undefined,
  capability: Capability,
): boolean {
  const role = effectiveBrandRole(orgRole, brandRole);
  return role !== null && brandRoleGrants(role, capability);
}

/** Roles de organización que `actor` puede asignar a un miembro con rol `target`. */
export function assignableOrgRoles(actor: OrgRole | null | undefined, target: OrgRole): OrgRole[] {
  if (actor === 'owner') return ['owner', 'admin', 'member'];
  if (actor === 'admin' && target !== 'owner') return ['admin', 'member'];
  return [];
}

export function canRemoveMember(actor: OrgRole | null | undefined, target: OrgRole, isSelf: boolean): boolean {
  if (isSelf) return true;
  if (actor === 'owner') return true;
  return actor === 'admin' && target !== 'owner';
}

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Miembro',
};

export const ORG_ROLE_HELP: Record<OrgRole, string> = {
  owner: 'Control total de la organización.',
  admin: 'Gestiona todas las marcas y el equipo.',
  member: 'Solo accede a las marcas donde tenga un rol.',
};

export const BRAND_ROLE_LABEL: Record<BrandRole, string> = {
  manager: 'Gestor',
  editor: 'Editor',
  reviewer: 'Revisor',
  client: 'Cliente',
  viewer: 'Solo lectura',
};

export const BRAND_ROLE_HELP: Record<BrandRole, string> = {
  manager: 'Configura la marca, su perfil y su equipo.',
  editor: 'Crea y edita contenido y biblioteca.',
  reviewer: 'Revisa y aprueba contenido.',
  client: 'Ve el contenido y lo aprueba.',
  viewer: 'Solo puede consultar.',
};

export const BRAND_ROLES: BrandRole[] = ['manager', 'editor', 'reviewer', 'client', 'viewer'];
