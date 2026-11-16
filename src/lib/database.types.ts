// Tipos de la base de datos, escritos a mano a partir de supabase/migrations.
// Cuando exista el proyecto de Supabase se sustituirán por los generados
// (`supabase gen types typescript`); hasta entonces este archivo es el contrato.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrgKind = 'business' | 'agency';
export type OrgRole = 'owner' | 'admin' | 'member';
export type BrandRole = 'manager' | 'editor' | 'reviewer' | 'client' | 'viewer';
export type BrandStatus = 'onboarding' | 'active' | 'archived';
export type ProfileStatus = 'active' | 'archived';
export type SourceKind = 'pdf' | 'document' | 'website' | 'json' | 'text' | 'image';
export type SourceStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type AssetKind = 'image' | 'video' | 'logo' | 'document' | 'audio' | 'template';
export type AssetOrigin = 'upload' | 'generated' | 'import';

export type ProfileRow = {
  user_id: string;
  email: string;
  full_name: string;
  locale: string;
  created_at: string;
  updated_at: string;
};

export type OrganizationRow = {
  id: string;
  name: string;
  kind: OrgKind;
  settings: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationMemberRow = {
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
};

export type BrandRow = {
  id: string;
  organization_id: string;
  name: string;
  sector: string;
  website: string;
  timezone: string;
  default_locale: string;
  status: BrandStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BrandMemberRow = {
  brand_id: string;
  organization_id: string;
  user_id: string;
  role: BrandRole;
  created_at: string;
};

export type BrandProfileRow = {
  id: string;
  brand_id: string;
  organization_id: string;
  version: number;
  status: ProfileStatus;
  schema_version: number;
  data: Json;
  provenance: Json;
  change_note: string;
  created_by: string | null;
  created_at: string;
};

export type KnowledgeSourceRow = {
  id: string;
  brand_id: string;
  organization_id: string;
  kind: SourceKind;
  title: string;
  storage_path: string | null;
  url: string | null;
  mime_type: string | null;
  bytes: number | null;
  status: SourceStatus;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MediaAssetRow = {
  id: string;
  brand_id: string;
  organization_id: string;
  kind: AssetKind;
  origin: AssetOrigin;
  storage_path: string;
  file_name: string;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sha256: string | null;
  folder: string;
  tags: string[];
  rights: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  org_role: OrgRole;
  brand_id: string | null;
  brand_role: BrandRole | null;
  token_hash: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type AuditLogRow = {
  id: number;
  organization_id: string;
  brand_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  data: Json;
  created_at: string;
};

export type AdminOrganizationRow = {
  id: string;
  name: string;
  kind: OrgKind;
  created_at: string;
  members: number;
  brands: number;
  assets: number;
  storage_bytes: number;
};

export type InvitationPreview = {
  organization_name: string;
  email: string;
  org_role: OrgRole;
  brand_name: string | null;
  brand_role: BrandRole | null;
  usable: boolean;
};

/** Archivos de Storage pendientes de borrar tras eliminar su recurso (los anota un disparador). */
export type StorageCleanupRow = {
  id: number;
  organization_id: string;
  brand_id: string;
  storage_path: string;
  created_at: string;
};

type Table<Row, Insert = never, Update = never> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, never, { full_name?: string; locale?: string }>;
      platform_admins: Table<{ user_id: string; created_at: string }>;
      organizations: Table<OrganizationRow, never, { name?: string; kind?: OrgKind; settings?: Json }>;
      organization_members: Table<OrganizationMemberRow>;
      brands: Table<
        BrandRow,
        {
          organization_id: string;
          name: string;
          sector?: string;
          website?: string;
          timezone?: string;
          default_locale?: string;
          status?: BrandStatus;
        },
        {
          name?: string;
          sector?: string;
          website?: string;
          timezone?: string;
          default_locale?: string;
          status?: BrandStatus;
        }
      >;
      brand_members: Table<
        BrandMemberRow,
        { brand_id: string; organization_id: string; user_id: string; role: BrandRole },
        { role?: BrandRole }
      >;
      brand_profiles: Table<BrandProfileRow>;
      brand_knowledge_sources: Table<
        KnowledgeSourceRow,
        {
          brand_id: string;
          organization_id: string;
          kind: SourceKind;
          title: string;
          storage_path?: string | null;
          url?: string | null;
          mime_type?: string | null;
          bytes?: number | null;
        }
      >;
      media_assets: Table<
        MediaAssetRow,
        {
          brand_id: string;
          organization_id: string;
          kind: AssetKind;
          storage_path: string;
          file_name: string;
          mime_type: string;
          bytes: number;
          width?: number | null;
          height?: number | null;
          duration_ms?: number | null;
          sha256?: string | null;
          folder?: string;
          tags?: string[];
          rights?: Json;
        },
        { kind?: AssetKind; file_name?: string; folder?: string; tags?: string[]; rights?: Json }
      >;
      storage_cleanup_queue: Table<StorageCleanupRow>;
      invitations: Table<InvitationRow>;
      audit_logs: Table<AuditLogRow>;
    };
    Views: Record<never, never>;
    Functions: {
      create_organization: { Args: { p_name: string; p_kind?: OrgKind }; Returns: OrganizationRow };
      set_member_role: { Args: { p_organization_id: string; p_user_id: string; p_role: OrgRole }; Returns: undefined };
      remove_member: { Args: { p_organization_id: string; p_user_id: string }; Returns: undefined };
      create_invitation: {
        Args: {
          p_organization_id: string;
          p_email: string;
          p_org_role?: OrgRole;
          p_brand_id?: string | null;
          p_brand_role?: BrandRole | null;
        };
        Returns: { invitation_id: string; token: string }[];
      };
      revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      get_invitation: { Args: { p_token: string }; Returns: InvitationPreview[] };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      save_brand_profile: {
        Args: { p_brand_id: string; p_data: Json; p_provenance?: Json; p_change_note?: string };
        Returns: BrandProfileRow;
      };
      admin_list_organizations: { Args: Record<string, never>; Returns: AdminOrganizationRow[] };
    };
    Enums: {
      org_kind: OrgKind;
      org_role: OrgRole;
      brand_role: BrandRole;
      brand_status: BrandStatus;
      profile_status: ProfileStatus;
      source_kind: SourceKind;
      source_status: SourceStatus;
      asset_kind: AssetKind;
      asset_origin: AssetOrigin;
    };
    CompositeTypes: Record<never, never>;
  };
};
