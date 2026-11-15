-- Núcleo multi-tenant (Fase 1).
--
-- Jerarquía:  organización  →  marcas  →  (perfil de marca, fuentes, biblioteca)
-- Un usuario puede pertenecer a varias organizaciones con un rol distinto en
-- cada una, y dentro de una organización a varias marcas con un rol por marca.
--
-- Reglas de diseño (ver docs/02-modelo-de-datos.md):
--   * El aislamiento se aplica AQUÍ (RLS), no en la interfaz.
--   * Toda tabla con datos de una marca lleva brand_id + organization_id, y una
--     clave foránea compuesta impide que apunten a organizaciones distintas.
--   * Las políticas usan `x in (select private.…())`: Postgres evalúa la
--     subconsulta una vez por sentencia (no por fila), que es lo que aguanta
--     tablas grandes.
--   * Las operaciones con reglas de negocio (crear organización, invitar,
--     cambiar roles, versionar el perfil) son funciones SECURITY DEFINER con
--     comprobaciones explícitas; el cliente no escribe esas tablas directamente.
--   * Nada de esto depende de un cliente concreto.

create schema if not exists private;

-- ───────────────────────────── Tipos ─────────────────────────────

create type public.org_kind as enum ('business', 'agency');
-- owner: todo, incluida la propiedad · admin: todo menos tocar a los owners ·
-- member: solo las marcas donde tenga un rol.
create type public.org_role as enum ('owner', 'admin', 'member');
-- De más a menos: gestor, editor, revisor/aprobador, cliente, solo lectura.
create type public.brand_role as enum ('manager', 'editor', 'reviewer', 'client', 'viewer');
create type public.brand_status as enum ('onboarding', 'active', 'archived');
create type public.profile_status as enum ('active', 'archived');
create type public.source_kind as enum ('pdf', 'document', 'website', 'json', 'text', 'image');
create type public.source_status as enum ('pending', 'processing', 'ready', 'failed');
create type public.asset_kind as enum ('image', 'video', 'logo', 'document', 'audio', 'template');
create type public.asset_origin as enum ('upload', 'generated', 'import');

-- ───────────────────────────── Tablas ─────────────────────────────

-- Datos visibles de cada usuario (auth.users no es accesible desde el cliente).
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  locale text not null default 'es' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Superadministradores de la plataforma. Se dan de alta a mano (SQL con la
-- clave de servicio); no hay ninguna vía desde el cliente.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind public.org_kind not null default 'business',
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  -- Segunda FK a profiles: permite a la API incrustar nombre y correo.
  constraint organization_members_profile_fk foreign key (user_id) references public.profiles (user_id) on delete cascade
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  sector text not null default '' check (char_length(sector) <= 120),
  website text not null default '' check (char_length(website) <= 300),
  timezone text not null default 'Europe/Madrid' check (char_length(timezone) between 1 and 64),
  default_locale text not null default 'es' check (default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  status public.brand_status not null default 'onboarding',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Destino de las FK compuestas (brand_id, organization_id) de las tablas hijas.
  unique (id, organization_id)
);
create index brands_organization_idx on public.brands (organization_id, created_at);

create table public.brand_members (
  brand_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  role public.brand_role not null,
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade,
  -- Solo puede tener rol en una marca quien ya es miembro de su organización;
  -- al salir de la organización pierde también sus marcas.
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade,
  constraint brand_members_profile_fk foreign key (user_id) references public.profiles (user_id) on delete cascade
);
create index brand_members_user_idx on public.brand_members (user_id);
create index brand_members_org_user_idx on public.brand_members (organization_id, user_id);

-- Perfil de marca («cerebro de marca»), versionado y de solo añadir: cada
-- guardado crea una versión nueva y archiva la anterior. `provenance` guarda de
-- dónde sale cada dato (usuario, importación, IA sin verificar…).
create table public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  organization_id uuid not null,
  version integer not null check (version > 0),
  status public.profile_status not null default 'active',
  schema_version integer not null default 1 check (schema_version > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 262144),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  change_note text not null default '' check (char_length(change_note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade,
  unique (brand_id, version)
);
create unique index brand_profiles_one_active_idx on public.brand_profiles (brand_id) where status = 'active';

-- Material del que se extrae el conocimiento de la marca (manual en PDF, web,
-- documentos…). En la Fase 1 se guarda y se lista; el procesado con IA es Fase 2.
create table public.brand_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  organization_id uuid not null,
  kind public.source_kind not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  storage_path text unique,
  url text check (url is null or (char_length(url) <= 2000 and url ~* '^https?://')),
  mime_type text,
  bytes bigint check (bytes is null or bytes >= 0),
  status public.source_status not null default 'pending',
  error text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade,
  check ((storage_path is not null) <> (url is not null))
);
create index brand_knowledge_sources_brand_idx on public.brand_knowledge_sources (brand_id, created_at desc);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  organization_id uuid not null,
  kind public.asset_kind not null,
  origin public.asset_origin not null default 'upload',
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null,
  bytes bigint not null check (bytes >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  -- Huella del contenido: detecta duplicados dentro de una marca.
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  folder text not null default '' check (char_length(folder) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 50),
  -- Derechos de uso: {"license": "...", "owner": "...", "expires_on": "...", "notes": "..."}
  rights jsonb not null default '{}'::jsonb check (jsonb_typeof(rights) = 'object'),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade,
  -- La ruta del archivo empieza siempre por <organización>/<marca>/.
  check (storage_path like organization_id::text || '/' || brand_id::text || '/%')
);
create index media_assets_brand_created_idx on public.media_assets (brand_id, created_at desc);
create index media_assets_brand_kind_idx on public.media_assets (brand_id, kind);
create index media_assets_brand_sha_idx on public.media_assets (brand_id, sha256) where sha256 is not null;
create index media_assets_tags_idx on public.media_assets using gin (tags);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  org_role public.org_role not null default 'member',
  brand_id uuid,
  brand_role public.brand_role,
  -- Solo se guarda la huella del token; el token se entrega una única vez.
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade,
  check ((brand_id is null) = (brand_role is null))
);
create index invitations_org_idx on public.invitations (organization_id, created_at desc);

-- Registro de auditoría. Sin FK a organizations a propósito: el registro debe
-- sobrevivir a lo que audita.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  brand_id uuid,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_brand_created_idx on public.audit_logs (brand_id, created_at desc) where brand_id is not null;

-- ─────────────────────── Funciones de autorización ───────────────────────
-- Viven en `private`, que la API no expone: solo se usan desde políticas y RPC.

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()));
$$;

create function private.my_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select om.organization_id from public.organization_members om where om.user_id = (select auth.uid());
$$;

create function private.my_admin_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select om.organization_id from public.organization_members om
  where om.user_id = (select auth.uid()) and om.role in ('owner', 'admin');
$$;

-- Matriz de permisos por rol de marca. Es el único sitio donde se define.
--   view     ver la marca y su contenido
--   comment  comentar
--   approve  aprobar o rechazar contenido
--   edit     crear y editar contenido y biblioteca
--   manage   configurar la marca, su perfil, sus fuentes y su equipo
create function private.brand_role_grants(p_role public.brand_role, p_capability text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_capability
    when 'view' then true
    when 'comment' then p_role <> 'viewer'
    when 'approve' then p_role in ('manager', 'reviewer', 'client')
    when 'edit' then p_role in ('manager', 'editor')
    when 'manage' then p_role = 'manager'
    else false
  end;
$$;

-- Marcas sobre las que el usuario actual tiene una capacidad. Los owner/admin
-- de la organización actúan como gestores de todas sus marcas.
create function private.brand_ids_with(p_capability text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select b.id
  from public.brands b
  join public.organization_members om
    on om.organization_id = b.organization_id and om.user_id = (select auth.uid())
  left join public.brand_members bm
    on bm.brand_id = b.id and bm.user_id = om.user_id
  where (om.role in ('owner', 'admin') and private.brand_role_grants('manager', p_capability))
     or (bm.role is not null and private.brand_role_grants(bm.role, p_capability));
$$;

-- Usuarios con los que el usuario actual comparte alguna organización.
create function private.visible_user_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select om.user_id from public.organization_members om
  where om.organization_id in (select private.my_org_ids());
$$;

-- ─────────────────────────── Disparadores ───────────────────────────

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger organizations_touch before update on public.organizations for each row execute function private.touch_updated_at();
create trigger brands_touch before update on public.brands for each row execute function private.touch_updated_at();
create trigger brand_knowledge_sources_touch before update on public.brand_knowledge_sources for each row execute function private.touch_updated_at();
create trigger media_assets_touch before update on public.media_assets for each row execute function private.touch_updated_at();

-- Alta de usuario → fila en profiles. El correo se mantiene sincronizado.
create function private.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, lower(coalesce(new.email, '')), left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
  on conflict (user_id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_auth_user();
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function private.handle_auth_user();

-- Una organización nunca se queda sin propietario.
create function private.keep_one_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    -- Si la organización ya no existe (borrado en cascada) no hay nada que proteger.
    if exists (select 1 from public.organizations o where o.id = old.organization_id)
       and not exists (
         select 1 from public.organization_members om
         where om.organization_id = old.organization_id and om.role = 'owner' and om.user_id <> old.user_id
       ) then
      raise exception 'La organización debe conservar al menos un propietario' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger organization_members_keep_owner before update of role or delete on public.organization_members
  for each row execute function private.keep_one_owner();

-- Auditoría genérica: quién hizo qué sobre qué fila. No guarda contenidos
-- voluminosos ni secretos (perfil completo, huellas de token).
create function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_org uuid;
  v_brand uuid;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  if tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  else
    v_org := (v_row ->> 'organization_id')::uuid;
  end if;
  if tg_table_name = 'brands' then
    v_brand := (v_row ->> 'id')::uuid;
  else
    v_brand := (v_row ->> 'brand_id')::uuid;
  end if;

  insert into public.audit_logs (organization_id, brand_id, actor_id, action, entity_type, entity_id, data)
  values (
    v_org,
    v_brand,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    v_row - 'data' - 'provenance' - 'token_hash' - 'settings'
  );
  return null;
end $$;

create trigger organizations_audit after insert or update or delete on public.organizations for each row execute function private.audit();
create trigger organization_members_audit after insert or update or delete on public.organization_members for each row execute function private.audit();
create trigger brands_audit after insert or update or delete on public.brands for each row execute function private.audit();
create trigger brand_members_audit after insert or update or delete on public.brand_members for each row execute function private.audit();
create trigger brand_profiles_audit after insert on public.brand_profiles for each row execute function private.audit();
create trigger brand_knowledge_sources_audit after insert or delete on public.brand_knowledge_sources for each row execute function private.audit();
create trigger media_assets_audit after delete on public.media_assets for each row execute function private.audit();
create trigger invitations_audit after insert or update on public.invitations for each row execute function private.audit();

-- ─────────────────────────────── RPC ───────────────────────────────

-- Crea una organización y hace propietario a quien la crea.
create function public.create_organization(p_name text, p_kind public.org_kind default 'business')
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  -- Freno contra el abuso: nadie necesita ser propietario de decenas de organizaciones.
  if (select count(*) from public.organization_members om where om.user_id = v_uid and om.role = 'owner') >= 20 then
    raise exception 'Has alcanzado el máximo de organizaciones que puedes crear' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, kind, created_by)
  values (btrim(p_name), p_kind, v_uid)
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, v_uid, 'owner');

  return v_org;
end $$;

-- Cambia el rol de un miembro. Solo los propietarios tocan a otros
-- propietarios o nombran propietarios.
create function public.set_member_role(p_organization_id uuid, p_user_id uuid, p_role public.org_role)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.org_role;
  v_target public.org_role;
begin
  select om.role into v_me from public.organization_members om
  where om.organization_id = p_organization_id and om.user_id = (select auth.uid());
  select om.role into v_target from public.organization_members om
  where om.organization_id = p_organization_id and om.user_id = p_user_id;

  if v_me is null or v_me not in ('owner', 'admin') or v_target is null then
    raise exception 'No tienes permiso para cambiar este rol' using errcode = '42501';
  end if;
  if v_me <> 'owner' and (v_target = 'owner' or p_role = 'owner') then
    raise exception 'Solo un propietario puede cambiar el rol de propietario' using errcode = '42501';
  end if;

  update public.organization_members om set role = p_role
  where om.organization_id = p_organization_id and om.user_id = p_user_id;
end $$;

-- Quita a un miembro (o permite marcharse a uno mismo).
create function public.remove_member(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_me public.org_role;
  v_target public.org_role;
begin
  select om.role into v_me from public.organization_members om
  where om.organization_id = p_organization_id and om.user_id = v_uid;
  select om.role into v_target from public.organization_members om
  where om.organization_id = p_organization_id and om.user_id = p_user_id;

  if v_me is null or v_target is null then
    raise exception 'No tienes permiso para quitar a este miembro' using errcode = '42501';
  end if;
  if p_user_id <> v_uid then
    if v_me not in ('owner', 'admin') or (v_target = 'owner' and v_me <> 'owner') then
      raise exception 'No tienes permiso para quitar a este miembro' using errcode = '42501';
    end if;
  end if;

  delete from public.organization_members om
  where om.organization_id = p_organization_id and om.user_id = p_user_id;
end $$;

-- Crea una invitación y devuelve el token (única vez que se ve).
--   * owner/admin: pueden invitar con cualquier rol (owner solo si son owner).
--   * gestor de una marca: solo como «member» y solo a su marca.
create function public.create_invitation(
  p_organization_id uuid,
  p_email text,
  p_org_role public.org_role default 'member',
  p_brand_id uuid default null,
  p_brand_role public.brand_role default null
) returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_me public.org_role;
  v_token text;
  v_id uuid;
  v_email text := lower(btrim(p_email));
begin
  select om.role into v_me from public.organization_members om
  where om.organization_id = p_organization_id and om.user_id = v_uid;

  if v_me is null then
    raise exception 'No tienes permiso para invitar en esta organización' using errcode = '42501';
  end if;
  if (p_brand_id is null) <> (p_brand_role is null) then
    raise exception 'Indica la marca y su rol a la vez' using errcode = '22023';
  end if;
  if p_brand_id is not null and not exists (
    select 1 from public.brands b where b.id = p_brand_id and b.organization_id = p_organization_id
  ) then
    raise exception 'La marca no pertenece a esta organización' using errcode = '42501';
  end if;

  if v_me = 'member' then
    if p_org_role <> 'member' or p_brand_id is null
       or p_brand_id not in (select private.brand_ids_with('manage')) then
      raise exception 'No tienes permiso para invitar en esta organización' using errcode = '42501';
    end if;
  elsif v_me = 'admin' and p_org_role = 'owner' then
    raise exception 'Solo un propietario puede invitar a otro propietario' using errcode = '42501';
  end if;

  -- Freno contra el abuso: invitaciones pendientes por organización.
  if (select count(*) from public.invitations i
      where i.organization_id = p_organization_id and i.accepted_at is null
        and i.revoked_at is null and i.expires_at > now()) >= 200 then
    raise exception 'Hay demasiadas invitaciones pendientes' using errcode = 'P0001';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.invitations (organization_id, email, org_role, brand_id, brand_role, token_hash, invited_by)
  values (p_organization_id, v_email, p_org_role, p_brand_id, p_brand_role,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_uid)
  returning id into v_id;

  return query select v_id, v_token;
end $$;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.invitations i set revoked_at = now()
  where i.id = p_invitation_id and i.accepted_at is null and i.revoked_at is null
    and (i.organization_id in (select private.my_admin_org_ids()) or i.invited_by = (select auth.uid()));
  if not found then
    raise exception 'No se puede anular esta invitación' using errcode = '42501';
  end if;
end $$;

-- Vista previa para la pantalla de aceptación: solo quien tiene el token.
create function public.get_invitation(p_token text)
returns table (organization_name text, email text, org_role public.org_role, brand_name text, brand_role public.brand_role, usable boolean)
language sql stable security definer set search_path = '' as $$
  select o.name, i.email, i.org_role, b.name, i.brand_role,
         (i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.brands b on b.id = i.brand_id
  where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Acepta una invitación. Solo vale para la cuenta cuyo correo coincide con el
-- invitado: por eso la confirmación de correo debe estar activada en Auth.
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_inv public.invitations;
  v_current public.org_role;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;

  select * into v_inv from public.invitations i
  where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;

  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'La invitación no existe o ya no es válida' using errcode = 'P0001';
  end if;
  if v_inv.email <> v_email then
    raise exception 'Esta invitación es para otra dirección de correo' using errcode = '42501';
  end if;

  select om.role into v_current from public.organization_members om
  where om.organization_id = v_inv.organization_id and om.user_id = v_uid;

  if v_current is null then
    insert into public.organization_members (organization_id, user_id, role)
    values (v_inv.organization_id, v_uid, v_inv.org_role);
  end if;
  -- Si ya era miembro se conserva su rol: una invitación nunca lo rebaja ni lo sube.

  if v_inv.brand_id is not null then
    insert into public.brand_members (brand_id, organization_id, user_id, role)
    values (v_inv.brand_id, v_inv.organization_id, v_uid, v_inv.brand_role)
    on conflict (brand_id, user_id) do nothing;
  end if;

  update public.invitations i set accepted_at = now(), accepted_by = v_uid where i.id = v_inv.id;
  return v_inv.organization_id;
end $$;

-- Guarda el perfil de marca como versión nueva y archiva la vigente.
create function public.save_brand_profile(
  p_brand_id uuid,
  p_data jsonb,
  p_provenance jsonb default '{}'::jsonb,
  p_change_note text default ''
) returns public.brand_profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_version integer;
  v_profile public.brand_profiles;
begin
  if p_brand_id not in (select private.brand_ids_with('manage')) then
    raise exception 'No tienes permiso para cambiar el perfil de esta marca' using errcode = '42501';
  end if;

  -- El bloqueo de la marca serializa los guardados simultáneos.
  select b.organization_id into v_org from public.brands b where b.id = p_brand_id for update;

  select coalesce(max(bp.version), 0) + 1 into v_version
  from public.brand_profiles bp where bp.brand_id = p_brand_id;

  update public.brand_profiles bp set status = 'archived'
  where bp.brand_id = p_brand_id and bp.status = 'active';

  insert into public.brand_profiles (brand_id, organization_id, version, data, provenance, change_note, created_by)
  values (p_brand_id, v_org, v_version, p_data, coalesce(p_provenance, '{}'::jsonb),
          left(coalesce(p_change_note, ''), 500), (select auth.uid()))
  returning * into v_profile;

  return v_profile;
end $$;

-- Panel de superadministración: resumen de todas las organizaciones.
create function public.admin_list_organizations()
returns table (id uuid, name text, kind public.org_kind, created_at timestamptz,
               members bigint, brands bigint, assets bigint, storage_bytes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, o.kind, o.created_at,
      (select count(*) from public.organization_members om where om.organization_id = o.id),
      (select count(*) from public.brands b where b.organization_id = o.id),
      (select count(*) from public.media_assets ma where ma.organization_id = o.id),
      (select coalesce(sum(ma.bytes), 0)::bigint from public.media_assets ma where ma.organization_id = o.id)
    from public.organizations o
    order by o.created_at desc;
end $$;

-- ───────────────────────── Seguridad a nivel de fila ─────────────────────────

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.brands enable row level security;
alter table public.brand_members enable row level security;
alter table public.brand_profiles enable row level security;
alter table public.brand_knowledge_sources enable row level security;
alter table public.media_assets enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: me veo a mí y a quienes comparten organización conmigo.
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or user_id in (select private.visible_user_ids()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- platform_admins: cada uno solo sabe si lo es.
create policy platform_admins_select_own on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- organizations: se crean con create_organization(); no se borran desde el cliente.
create policy organizations_select on public.organizations for select to authenticated
  using (id in (select private.my_org_ids()));
create policy organizations_update on public.organizations for update to authenticated
  using (id in (select private.my_admin_org_ids())) with check (id in (select private.my_admin_org_ids()));

-- organization_members: solo lectura; los cambios van por RPC.
create policy organization_members_select on public.organization_members for select to authenticated
  using (organization_id in (select private.my_org_ids()));

-- brands: las crea un owner/admin; no se borran (se archivan).
-- La primera condición no consulta `brands`: así INSERT … RETURNING ve la fila
-- recién creada (una función STABLE no ve lo insertado por su propia sentencia).
create policy brands_select on public.brands for select to authenticated
  using (organization_id in (select private.my_admin_org_ids()) or id in (select private.brand_ids_with('view')));
create policy brands_insert on public.brands for insert to authenticated
  with check (organization_id in (select private.my_admin_org_ids()) and created_by = (select auth.uid()));
create policy brands_update on public.brands for update to authenticated
  using (id in (select private.brand_ids_with('manage'))) with check (id in (select private.brand_ids_with('manage')));

-- brand_members: lo gestiona quien gestiona la marca; cada uno ve su propia fila.
create policy brand_members_select on public.brand_members for select to authenticated
  using (user_id = (select auth.uid()) or brand_id in (select private.brand_ids_with('manage')));
create policy brand_members_insert on public.brand_members for insert to authenticated
  with check (brand_id in (select private.brand_ids_with('manage')));
create policy brand_members_update on public.brand_members for update to authenticated
  using (brand_id in (select private.brand_ids_with('manage'))) with check (brand_id in (select private.brand_ids_with('manage')));
create policy brand_members_delete on public.brand_members for delete to authenticated
  using (brand_id in (select private.brand_ids_with('manage')));

-- brand_profiles: solo lectura; se escribe con save_brand_profile().
create policy brand_profiles_select on public.brand_profiles for select to authenticated
  using (brand_id in (select private.brand_ids_with('view')));

create policy brand_knowledge_sources_select on public.brand_knowledge_sources for select to authenticated
  using (brand_id in (select private.brand_ids_with('view')));
create policy brand_knowledge_sources_insert on public.brand_knowledge_sources for insert to authenticated
  with check (brand_id in (select private.brand_ids_with('manage')) and created_by = (select auth.uid()));
create policy brand_knowledge_sources_delete on public.brand_knowledge_sources for delete to authenticated
  using (brand_id in (select private.brand_ids_with('manage')));

create policy media_assets_select on public.media_assets for select to authenticated
  using (brand_id in (select private.brand_ids_with('view')));
create policy media_assets_insert on public.media_assets for insert to authenticated
  with check (brand_id in (select private.brand_ids_with('edit')) and created_by = (select auth.uid()));
create policy media_assets_update on public.media_assets for update to authenticated
  using (brand_id in (select private.brand_ids_with('edit'))) with check (brand_id in (select private.brand_ids_with('edit')));
create policy media_assets_delete on public.media_assets for delete to authenticated
  using (brand_id in (select private.brand_ids_with('edit')));

-- invitations: las ven los administradores y quien las creó.
create policy invitations_select on public.invitations for select to authenticated
  using (organization_id in (select private.my_admin_org_ids()) or invited_by = (select auth.uid()));

-- audit_logs: solo lectura para los administradores de la organización.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id in (select private.my_admin_org_ids()));

-- ───────────────────────────── Privilegios ─────────────────────────────
-- Mínimo privilegio: se parte de cero y se concede columna a columna lo que el
-- cliente puede tocar. `anon` no tiene acceso a nada.

-- En Supabase las tablas y funciones nuevas de `public` nacen abiertas a anon y
-- authenticated. Se desactiva para que una migración futura no abra nada por
-- olvido: cada una debe conceder explícitamente lo que necesite.
alter default privileges in schema public revoke all on tables from anon, authenticated, public;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated, public;

revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all functions in schema private from anon, authenticated, public;

grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on public.profiles, public.platform_admins, public.organizations, public.organization_members,
  public.brands, public.brand_members, public.brand_profiles, public.brand_knowledge_sources,
  public.media_assets, public.invitations, public.audit_logs to authenticated;

grant update (full_name, locale) on public.profiles to authenticated;
grant update (name, kind, settings) on public.organizations to authenticated;
grant insert (organization_id, name, sector, website, timezone, default_locale, status) on public.brands to authenticated;
grant update (name, sector, website, timezone, default_locale, status) on public.brands to authenticated;
grant insert (brand_id, organization_id, user_id, role) on public.brand_members to authenticated;
grant update (role) on public.brand_members to authenticated;
grant delete on public.brand_members to authenticated;
grant insert (brand_id, organization_id, kind, title, storage_path, url, mime_type, bytes) on public.brand_knowledge_sources to authenticated;
grant delete on public.brand_knowledge_sources to authenticated;
grant insert (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes, width, height, duration_ms, sha256, folder, tags, rights)
  on public.media_assets to authenticated;
grant update (kind, file_name, folder, tags, rights) on public.media_assets to authenticated;
grant delete on public.media_assets to authenticated;
