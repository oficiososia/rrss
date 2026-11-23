import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditLogRow,
  BrandMemberRow,
  BrandRole,
  BrandRow,
  InvitationRow,
  OrganizationRow,
  OrgKind,
  OrgRole,
  OrgWorkMode,
  ProfileRow,
} from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export interface MyOrganization extends OrganizationRow {
  role: OrgRole;
}

export interface Member {
  user_id: string;
  role: OrgRole;
  created_at: string;
  full_name: string;
  email: string;
}

export const keys = {
  orgs: (userId: string) => ['orgs', userId] as const,
  platformAdmin: (userId: string) => ['platform-admin', userId] as const,
  members: (orgId: string) => ['org', orgId, 'members'] as const,
  brands: (orgId: string) => ['org', orgId, 'brands'] as const,
  brandsElsewhere: (orgIds: string[]) => ['brands-elsewhere', ...orgIds] as const,
  myBrandRoles: (orgId: string, userId: string) => ['org', orgId, 'my-brand-roles', userId] as const,
  invitations: (orgId: string) => ['org', orgId, 'invitations'] as const,
  audit: (orgId: string, brandId: string | null, page: number) => ['org', orgId, 'audit', brandId, page] as const,
  org: (orgId: string) => ['org', orgId] as const,
};

export function useMyOrganizations(userId: string) {
  return useQuery({
    queryKey: keys.orgs(userId),
    queryFn: async (): Promise<MyOrganization[]> => {
      const [orgs, memberships] = await Promise.all([
        supabase.from('organizations').select('*').order('name'),
        supabase.from('organization_members').select('organization_id, role').eq('user_id', userId),
      ]);
      const roles = new Map(unwrap(memberships).map((m) => [m.organization_id, m.role]));
      return unwrap(orgs).flatMap((org) => {
        const role = roles.get(org.id);
        return role ? [{ ...org, role }] : [];
      });
    },
  });
}

export function useIsPlatformAdmin(userId: string) {
  return useQuery({
    queryKey: keys.platformAdmin(userId),
    queryFn: async () =>
      unwrap(await supabase.from('platform_admins').select('user_id').eq('user_id', userId)).length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useCreateOrganization(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; kind: OrgKind }) =>
      unwrap(await supabase.rpc('create_organization', { p_name: input.name, p_kind: input.kind })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.orgs(userId) }),
  });
}

export function useUpdateOrganization(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name?: string; kind?: OrgKind; work_mode?: OrgWorkMode }) => {
      const rows = unwrap(await supabase.from('organizations').update(input).eq('id', orgId).select('id'));
      if (rows.length === 0) throw { code: '42501', message: 'permission denied' };
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orgs'] }),
        // Al pasar a autogestión las marcas vuelven a redactar con IA: se leen de nuevo.
        queryClient.invalidateQueries({ queryKey: ['org', orgId] }),
      ]),
  });
}

async function fetchProfiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = unwrap(await supabase.from('profiles').select('*').in('user_id', unique));
  return new Map(rows.map((p) => [p.user_id, p]));
}

export function useOrgMembers(orgId: string) {
  return useQuery({
    queryKey: keys.members(orgId),
    queryFn: async (): Promise<Member[]> => {
      const rows = unwrap(
        await supabase.from('organization_members').select('*').eq('organization_id', orgId).order('created_at'),
      );
      const profiles = await fetchProfiles(rows.map((r) => r.user_id));
      return rows.map((r) => ({
        user_id: r.user_id,
        role: r.role,
        created_at: r.created_at,
        full_name: profiles.get(r.user_id)?.full_name ?? '',
        email: profiles.get(r.user_id)?.email ?? '',
      }));
    },
  });
}

export function useBrands(orgId: string) {
  return useQuery({
    queryKey: keys.brands(orgId),
    queryFn: async (): Promise<BrandRow[]> =>
      unwrap(await supabase.from('brands').select('*').eq('organization_id', orgId).order('name')),
  });
}

/**
 * Las marcas (sin las archivadas) de las DEMÁS organizaciones a las que se pertenece, para el selector
 * único de marcas: se cambia de marca sin pasar antes por «cambiar de organización». Las que deja ver
 * la base de datos (RLS), y solo de las organizaciones pedidas. Con una sola organización no pregunta.
 */
export function useBrandsElsewhere(orgIds: string[]) {
  return useQuery({
    queryKey: keys.brandsElsewhere(orgIds),
    enabled: orgIds.length > 0,
    queryFn: async (): Promise<Pick<BrandRow, 'id' | 'name' | 'organization_id' | 'status'>[]> =>
      unwrap(
        await supabase
          .from('brands')
          .select('id, name, organization_id, status')
          .in('organization_id', orgIds)
          .order('name'),
      ).filter((b) => b.status !== 'archived'),
  });
}

export function useMyBrandRoles(orgId: string, userId: string) {
  return useQuery({
    queryKey: keys.myBrandRoles(orgId, userId),
    queryFn: async (): Promise<Map<string, BrandRole>> => {
      const rows = unwrap(
        await supabase
          .from('brand_members')
          .select('brand_id, role')
          .eq('organization_id', orgId)
          .eq('user_id', userId),
      );
      return new Map(rows.map((r) => [r.brand_id, r.role]));
    },
  });
}

export function useSetMemberRole(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; role: OrgRole }) => {
      unwrap(
        await supabase.rpc('set_member_role', {
          p_organization_id: orgId,
          p_user_id: input.userId,
          p_role: input.role,
        }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.org(orgId) }),
  });
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      unwrap(await supabase.rpc('remove_member', { p_organization_id: orgId, p_user_id: userId }));
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.org(orgId) }),
        queryClient.invalidateQueries({ queryKey: ['orgs'] }),
      ]),
  });
}

// ── Invitaciones ─────────────────────────────────────────────────────────

export type PendingInvitation = Pick<
  InvitationRow,
  'id' | 'email' | 'org_role' | 'brand_id' | 'brand_role' | 'expires_at' | 'created_at' | 'invited_by'
>;

export function useInvitations(orgId: string) {
  return useQuery({
    queryKey: keys.invitations(orgId),
    queryFn: async (): Promise<PendingInvitation[]> =>
      unwrap(
        await supabase
          .from('invitations')
          .select('id, email, org_role, brand_id, brand_role, expires_at, created_at, invited_by')
          .eq('organization_id', orgId)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
      ),
  });
}

export interface InvitationInput {
  email: string;
  orgRole: OrgRole;
  brandId: string | null;
  brandRole: BrandRole | null;
}

export function useCreateInvitation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: InvitationInput): Promise<string> => {
      const rows = unwrap(
        await supabase.rpc('create_invitation', {
          p_organization_id: orgId,
          p_email: input.email.trim().toLowerCase(),
          p_org_role: input.orgRole,
          p_brand_id: input.brandId,
          p_brand_role: input.brandRole,
        }),
      );
      const token = rows[0]?.token;
      if (!token) throw new Error('No se ha podido crear la invitación.');
      return token;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invitations(orgId) }),
  });
}

export function useRevokeInvitation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      unwrap(await supabase.rpc('revoke_invitation', { p_invitation_id: invitationId }));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invitations(orgId) }),
  });
}

export function invitationLink(token: string): string {
  return `${window.location.origin}/invitacion/${token}`;
}

// ── Equipo de una marca ──────────────────────────────────────────────────

export interface BrandMember extends Pick<BrandMemberRow, 'user_id' | 'role' | 'created_at'> {
  full_name: string;
  email: string;
}

export function useBrandMembers(orgId: string, brandId: string) {
  return useQuery({
    queryKey: [...keys.org(orgId), 'brand-members', brandId],
    queryFn: async (): Promise<BrandMember[]> => {
      const rows = unwrap(await supabase.from('brand_members').select('*').eq('brand_id', brandId).order('created_at'));
      const profiles = await fetchProfiles(rows.map((r) => r.user_id));
      return rows.map((r) => ({
        user_id: r.user_id,
        role: r.role,
        created_at: r.created_at,
        full_name: profiles.get(r.user_id)?.full_name ?? '',
        email: profiles.get(r.user_id)?.email ?? '',
      }));
    },
  });
}

export function useBrandMemberMutations(orgId: string, brandId: string) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: keys.org(orgId) });
  const add = useMutation({
    mutationFn: async (input: { userId: string; role: BrandRole }) => {
      unwrap(
        await supabase
          .from('brand_members')
          .insert({ brand_id: brandId, organization_id: orgId, user_id: input.userId, role: input.role }),
      );
    },
    onSuccess,
  });
  const setRole = useMutation({
    mutationFn: async (input: { userId: string; role: BrandRole }) => {
      const rows = unwrap(
        await supabase
          .from('brand_members')
          .update({ role: input.role })
          .eq('brand_id', brandId)
          .eq('user_id', input.userId)
          .select('user_id'),
      );
      if (rows.length === 0) throw { code: '42501', message: 'permission denied' };
    },
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const rows = unwrap(
        await supabase.from('brand_members').delete().eq('brand_id', brandId).eq('user_id', userId).select('user_id'),
      );
      if (rows.length === 0) throw { code: '42501', message: 'permission denied' };
    },
    onSuccess,
  });
  return { add, setRole, remove };
}

// ── Auditoría ────────────────────────────────────────────────────────────

export const AUDIT_PAGE_SIZE = 30;

export interface AuditPage {
  rows: AuditLogRow[];
  names: Map<string, string>;
  hasMore: boolean;
}

export function useAuditLogs(
  orgId: string,
  options: { brandId?: string | null; page?: number; pageSize?: number; enabled?: boolean },
) {
  const { brandId = null, page = 0, pageSize = AUDIT_PAGE_SIZE, enabled = true } = options;
  return useQuery({
    queryKey: [...keys.audit(orgId, brandId, page), pageSize],
    enabled,
    queryFn: async (): Promise<AuditPage> => {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        // Se pide una fila de más para saber si hay página siguiente.
        .range(page * pageSize, page * pageSize + pageSize);
      if (brandId) query = query.eq('brand_id', brandId);
      const all = unwrap(await query);
      const rows = all.slice(0, pageSize);
      const ids = rows.flatMap((r) => {
        const subject = typeof r.data === 'object' && r.data !== null && !Array.isArray(r.data) ? r.data.user_id : null;
        return [r.actor_id, typeof subject === 'string' ? subject : null].filter((v): v is string => Boolean(v));
      });
      const profiles = await fetchProfiles(ids);
      const names = new Map([...profiles].map(([id, p]) => [id, p.full_name || p.email]));
      return { rows, names, hasMore: all.length > pageSize };
    },
  });
}

// ── Plataforma ───────────────────────────────────────────────────────────

export function useAdminOrganizations(enabled: boolean) {
  return useQuery({
    queryKey: ['platform', 'organizations'],
    enabled,
    queryFn: async () => unwrap(await supabase.rpc('admin_list_organizations')),
  });
}
