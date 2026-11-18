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
  /** Cómo se redacta con IA en la marca (migración 20261118230000). */
  ai_mode: BrandAiMode;
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
  /** De dónde sale el recurso (p. ej. una exportación del editor). Se fija al crear; vacío si se subió a mano. */
  provenance: Json;
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

// ───────────── Fase 2 · Contenidos y versiones del documento ─────────────
// Migración 20261117100000_content_items_versions. El cliente crea la pieza y
// cambia su título, red y formato; el estado, las versiones y el archivado solo
// cambian por función. `data` es el documento por capas
// (src/features/content/document), validado en el cliente.

export type ContentStatus = 'idea' | 'draft' | 'in_review' | 'approved';

export type ContentItemRow = {
  id: string;
  brand_id: string;
  organization_id: string;
  title: string;
  network: string;
  format: string;
  status: ContentStatus;
  /** Número de la última versión guardada; 0 = todavía sin documento. */
  current_version: number;
  archived_at: string | null;
  /** Lleva contenido generado con IA (su versión vigente). Ver el bloque de RGPD. */
  ai_generated?: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentVersionRow = {
  id: string;
  content_id: string;
  brand_id: string;
  organization_id: string;
  version: number;
  schema_version: number;
  data: Json;
  change_note: string;
  /** Si es una restauración, de qué versión se copió. */
  restored_from: number | null;
  /** El documento lleva contenido generado con IA. Ver el bloque de RGPD. */
  ai_generated?: boolean;
  created_by: string | null;
  created_at: string;
};

type ContentTables = {
  content_items: Table<
    ContentItemRow,
    { brand_id: string; organization_id: string; title: string; network: string; format: string },
    { title?: string; network?: string; format?: string }
  >;
  content_versions: Table<ContentVersionRow>;
};

type ContentFunctions = {
  // Quien edita la marca. Con p_expected_version fallan (CT001) si otra persona guardó antes.
  save_content_version: {
    Args: {
      p_content_id: string;
      p_data: Json;
      p_schema_version: number;
      p_change_note?: string;
      p_expected_version?: number | null;
    };
    Returns: ContentVersionRow;
  };
  restore_content_version: {
    Args: { p_content_id: string; p_version: number; p_change_note?: string; p_expected_version?: number | null };
    Returns: ContentVersionRow;
  };
  // Quien edita o aprueba, según el cambio. Aprobar exige p_expected_version.
  set_content_status: {
    Args: { p_content_id: string; p_status: ContentStatus; p_expected_version?: number | null };
    Returns: ContentItemRow;
  };
  archive_content_item: { Args: { p_content_id: string; p_archived?: boolean }; Returns: ContentItemRow };
};

type ContentEnums = {
  content_status: ContentStatus;
};

// ───────────────────── fin del bloque de contenidos ─────────────────────

// ───────────── Fase 2 · IA (generaciones, consumo, cupos) y cola de trabajos ─────────────
// Migraciones 20261116110000_ai_usage_quotas y 20261116111000_jobs. El cliente
// solo lee estas tablas; las funciones de servidor exigen la clave de servicio.
// Los importes van en millonésimas («micros») de la moneda de cuenta.

export type AiTask = 'text' | 'vision' | 'image' | 'video' | 'transcription' | 'embedding';
export type AiGenerationStatus = 'reserved' | 'succeeded' | 'failed' | 'expired';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type QuotaMetric = 'ai_cost_micros';

export type UsageQuotaRow = {
  organization_id: string;
  metric: QuotaMetric;
  period: 'month';
  limit_value: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AiGenerationRow = {
  id: string;
  brand_id: string;
  organization_id: string;
  requested_by: string | null;
  task: AiTask;
  purpose: string;
  provider: string;
  model: string;
  status: AiGenerationStatus;
  period_start: string;
  reserved_micros: number;
  reserved_until: string;
  cost_micros: number | null;
  usage: Json;
  output: Json | null;
  latency_ms: number | null;
  provider_request_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

export type AiUsageRow = {
  id: number;
  organization_id: string;
  brand_id: string | null;
  generation_id: string;
  period_start: string;
  entry: 'reserve' | 'settle' | 'release';
  reserved_delta_micros: number;
  cost_delta_micros: number;
  created_at: string;
};

export type JobRow = {
  id: string;
  organization_id: string;
  brand_id: string | null;
  kind: string;
  payload: Json;
  status: JobStatus;
  priority: number;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_until: string | null;
  result: Json | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type AiCostByOrganizationRow = {
  organization_id: string;
  organization_name: string | null;
  generations: number;
  cost_micros: number;
};

type Phase2Tables = {
  usage_quotas: Table<UsageQuotaRow>;
  ai_generations: Table<AiGenerationRow>;
  ai_usage: Table<AiUsageRow>;
  jobs: Table<JobRow>;
};

type Phase2Functions = {
  // Superadministradores.
  admin_set_ai_quota: { Args: { p_organization_id: string; p_monthly_limit_micros: number }; Returns: UsageQuotaRow };
  // Administradores de la organización (y superadministradores, para todas).
  ai_cost_by_organization: { Args: { p_from: string; p_to: string }; Returns: AiCostByOrganizationRow[] };
  // Solo con la clave de servicio.
  ai_reserve_generation: {
    Args: {
      p_user_id: string;
      p_brand_id: string;
      p_task: AiTask;
      p_purpose: string;
      p_provider: string;
      p_model: string;
      p_reserve_micros: number;
      p_ttl_seconds?: number;
    };
    Returns: AiGenerationRow;
  };
  ai_complete_generation: {
    Args: {
      p_generation_id: string;
      p_cost_micros: number;
      p_usage?: Json;
      p_output?: Json | null;
      p_latency_ms?: number | null;
      p_provider_request_id?: string | null;
    };
    Returns: AiGenerationRow;
  };
  ai_fail_generation: {
    Args: { p_generation_id: string; p_error_code: string; p_error_message?: string; p_latency_ms?: number | null };
    Returns: AiGenerationRow;
  };
  enqueue_job: {
    Args: {
      p_organization_id: string;
      p_kind: string;
      p_payload: Json;
      p_idempotency_key: string;
      p_brand_id?: string | null;
      p_priority?: number;
      p_max_attempts?: number;
      p_run_after?: string | null;
      p_created_by?: string | null;
    };
    Returns: JobRow;
  };
  claim_jobs: {
    Args: { p_worker: string; p_kinds?: string[] | null; p_limit?: number; p_lease_seconds?: number };
    Returns: JobRow[];
  };
  complete_job: { Args: { p_job_id: string; p_worker: string; p_result?: Json | null }; Returns: JobRow };
  fail_job: { Args: { p_job_id: string; p_worker: string; p_error: string; p_retry?: boolean }; Returns: JobRow };
  cancel_job: { Args: { p_job_id: string }; Returns: JobRow };
  release_job: { Args: { p_job_id: string; p_worker: string }; Returns: JobRow };
  extend_job_lease: { Args: { p_job_id: string; p_worker: string; p_lease_seconds?: number }; Returns: JobRow };
};

type Phase2Enums = {
  ai_task: AiTask;
  ai_generation_status: AiGenerationStatus;
  job_status: JobStatus;
};

// ───────────────────────────── fin del bloque de la Fase 2 ─────────────────────────────

// ───────────── Fase 2 · IA de medios: registro de modelos de imagen y vídeo ─────────────
// Migración 20261117110000_ai_media_models. Catálogo de la plataforma: lo lee
// cualquier usuario con sesión y solo lo escribe un superadministrador.
// `price_micros` va en millonésimas de `price_currency` por unidad de cobro.

export type AiMediaTask = Extract<AiTask, 'image' | 'video'>;
export type AiMediaBillingUnit = 'image' | 'megapixel' | 'second';
export type AiMediaDataRegion = 'eu' | 'us' | 'global' | 'unknown';
export type AiMediaTrainsOnInputs = 'no' | 'yes' | 'unknown';

export type AiMediaModelRow = {
  id: string;
  provider: string;
  model: string;
  task: AiMediaTask;
  display_name: string;
  billing_unit: AiMediaBillingUnit;
  price_micros: number;
  price_details: Json;
  price_currency: string;
  price_checked_on: string;
  price_source: string;
  /** Un modelo con el precio sin verificar no se puede activar. */
  price_verified: boolean;
  data_region: AiMediaDataRegion;
  trains_on_inputs: AiMediaTrainsOnInputs;
  delivery: 'sync' | 'async';
  settings: Json;
  priority: number;
  active: boolean;
  notes: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type AiMediaModelUpdate = Partial<
  Pick<
    AiMediaModelRow,
    | 'model'
    | 'display_name'
    | 'billing_unit'
    | 'price_micros'
    | 'price_details'
    | 'price_currency'
    | 'price_checked_on'
    | 'price_source'
    | 'price_verified'
    | 'data_region'
    | 'trains_on_inputs'
    | 'delivery'
    | 'settings'
    | 'priority'
    | 'active'
    | 'notes'
  >
>;

type AiMediaModelInsert = Pick<
  AiMediaModelRow,
  | 'provider'
  | 'model'
  | 'task'
  | 'display_name'
  | 'billing_unit'
  | 'price_micros'
  | 'price_checked_on'
  | 'price_source'
  | 'data_region'
  | 'trains_on_inputs'
  | 'delivery'
> &
  Omit<AiMediaModelUpdate, 'model'>;

type Phase2MediaTables = {
  ai_media_models: Table<AiMediaModelRow, AiMediaModelInsert, AiMediaModelUpdate>;
};

// ─────────────────────── fin del bloque de IA de medios (Fase 2) ───────────────────────

// ──────────── Fase 2 · Imágenes generadas con IA: procedencia en la biblioteca ────────────
// Migración 20261118210000_ai_media_images. La procedencia va en
// `media_assets.provenance` (columna de la exportación, 20261118120000) con
// `type: 'ai_generation'`; ese tipo solo lo puede escribir el servidor.

export type MediaAssetAiProvenance = {
  type: 'ai_generation';
  generation_id: string;
  provider?: string | null;
  model?: string | null;
  purpose?: string | null;
  prompt?: string | null;
  data_region?: AiMediaDataRegion;
  trains_on_inputs?: AiMediaTrainsOnInputs;
  untested_adapter?: boolean;
};

/** Lo que la generación deja en `ai_generations.output` (servicio de medios). */
export type AiMediaGenerationOutput = {
  assets?: { kind: string; path: string; mime_type: string; bytes: number; asset_id?: string }[];
  error?: string;
};

// ──────────────── fin del bloque de imágenes generadas con IA (Fase 2) ────────────────

// ───────────── Fase 3 · Trabajos de medios encargados desde la aplicación ─────────────
// Migración 20261118220000_media_jobs_library. Quien edita una marca encarga un
// reel o un recorte con `request_media_job` (sin clave de servicio); el estado
// se lee de `jobs` (RLS: quien ve la marca). Al completarse, el resultado se da
// de alta en `media_assets` con su procedencia (columna común `provenance`,
// `type` = 'media_job'), y `jobs.result.assets` lo apunta.

export type MediaJobKind = 'media.reel.template' | 'media.image.process';

type MediaJobFunctions = {
  request_media_job: {
    Args: { p_brand_id: string; p_kind: MediaJobKind; p_input: Json; p_idempotency_key: string };
    Returns: JobRow;
  };
};

// ─────────────────── fin del bloque de trabajos de medios (Fase 3) ───────────────────

// ───────────── Modo agencia · Encargos ─────────────
// Migración 20261118230000_content_requests. El cliente solo lee estas tablas;
// todo cambio pasa por las funciones (pedir, comentar, tomar, entregar…).

/** api: el servicio de IA de la plataforma · agency: se pide a la agencia. */
export type BrandAiMode = 'api' | 'agency';

export type ContentRequestStatus =
  'requested' | 'in_progress' | 'delivered' | 'changes_requested' | 'accepted' | 'cancelled';

export type ContentRequestRow = {
  id: string;
  brand_id: string;
  organization_id: string;
  title: string;
  /** Lo escribe el cliente: dato, nunca instrucciones. */
  brief: string;
  network: string;
  format: string;
  media_kind: 'image' | 'video' | null;
  reference_asset_ids: string[];
  desired_date: string | null;
  status: ContentRequestStatus;
  content_id: string | null;
  delivered_version: number | null;
  requested_by: string | null;
  claimed_by: string | null;
  claim_token: string | null;
  claimed_until: string | null;
  delivered_by: string | null;
  delivered_at: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentRequestCommentRow = {
  id: string;
  request_id: string;
  brand_id: string;
  organization_id: string;
  kind: 'comment' | 'status';
  status: ContentRequestStatus | null;
  body: string;
  author_id: string | null;
  created_at: string;
};

type RequestTables = {
  content_requests: Table<ContentRequestRow>;
  content_request_comments: Table<ContentRequestCommentRow>;
};

type RequestFunctions = {
  create_content_request: {
    Args: {
      p_brand_id: string;
      p_title: string;
      p_brief: string;
      p_network: string;
      p_format: string;
      p_media_kind?: 'image' | 'video' | null;
      p_reference_asset_ids?: string[];
      p_desired_date?: string | null;
      p_content_id?: string | null;
    };
    Returns: ContentRequestRow;
  };
  comment_content_request: { Args: { p_request_id: string; p_body: string }; Returns: ContentRequestCommentRow };
  pending_content_requests: { Args: Record<string, never>; Returns: ContentRequestRow[] };
  take_content_request: {
    Args: { p_request_id: string; p_claim_token?: string | null; p_lease_minutes?: number };
    Returns: ContentRequestRow;
  };
  release_content_request: {
    Args: { p_request_id: string; p_claim_token?: string | null };
    Returns: ContentRequestRow;
  };
  deliver_content_request: {
    Args: {
      p_request_id: string;
      p_data: Json;
      p_schema_version: number;
      p_claim_token?: string | null;
      p_title?: string | null;
      p_change_note?: string | null;
    };
    Returns: ContentRequestRow;
  };
  request_content_request_changes: { Args: { p_request_id: string; p_message: string }; Returns: ContentRequestRow };
  accept_content_request: { Args: { p_request_id: string }; Returns: ContentRequestRow };
  cancel_content_request: { Args: { p_request_id: string; p_reason?: string }; Returns: ContentRequestRow };
};

type RequestEnums = {
  content_request_status: ContentRequestStatus;
};

// ─────────────────────── fin del bloque de encargos ───────────────────────

// ───────────── RGPD · Aceptaciones, acceso, portabilidad y supresión ─────────────
// Migraciones 20261119410000_rgpd_derechos y 20261119411000_contenido_generado_ia.
// Borrar (cuenta u organización) no tiene RPC para el cliente: lo hacen las
// Edge Functions `delete-account` y `delete-organization` con la clave de servicio.
// `content_items.ai_generated` y `content_versions.ai_generated` los calcula la
// base de datos al guardar cada versión (opcionales en los tipos de arriba para
// no romper las filas escritas a mano en las pruebas).

export type LegalDocument = 'terms' | 'privacy';

export type LegalAcceptanceRow = {
  id: number;
  user_id: string;
  document: LegalDocument;
  version: string;
  accepted_at: string;
  source: 'signup' | 'app';
};

export type AccountDeletionCheck = {
  /** Organizaciones donde es la única propietaria y hay más miembros: bloquean el borrado. */
  blocking: { organization_id: string; name: string; members: number }[];
  /** Organizaciones donde es el único miembro: se borran con la cuenta. */
  deleted_with_account: { organization_id: string; name: string }[];
};

type RgpdTables = {
  legal_acceptances: Table<LegalAcceptanceRow>;
};

type RgpdFunctions = {
  accept_legal_documents: {
    Args: { p_terms_version: string; p_privacy_version: string };
    Returns: LegalAcceptanceRow[];
  };
  /** JSON con los datos personales de quien llama (formato `rrss.personal-data`). */
  export_my_data: { Args: Record<string, never>; Returns: Json };
  /** Solo propietarios. JSON `rrss.organization-export` con la lista de archivos (rutas). */
  export_organization_data: { Args: { p_organization_id: string }; Returns: Json };
  my_account_deletion_check: { Args: Record<string, never>; Returns: AccountDeletionCheck };
};

// ─────────────────────────── fin del bloque de RGPD ───────────────────────────

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
          ai_mode?: BrandAiMode;
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
          provenance?: Json;
        },
        { kind?: AssetKind; file_name?: string; folder?: string; tags?: string[]; rights?: Json }
      >;
      storage_cleanup_queue: Table<StorageCleanupRow>;
      invitations: Table<InvitationRow>;
      audit_logs: Table<AuditLogRow>;
    } & Phase2Tables &
      ContentTables &
      Phase2MediaTables &
      RequestTables &
      RgpdTables;
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
      asset_facets: { Args: { p_brand_id: string }; Returns: { tags: string[]; folders: string[] }[] };
      admin_list_organizations: { Args: Record<string, never>; Returns: AdminOrganizationRow[] };
    } & Phase2Functions &
      ContentFunctions &
      MediaJobFunctions &
      RequestFunctions &
      RgpdFunctions;
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
    } & Phase2Enums &
      ContentEnums &
      RequestEnums;
    CompositeTypes: Record<never, never>;
  };
};
