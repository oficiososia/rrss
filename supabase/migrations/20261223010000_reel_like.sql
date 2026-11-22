-- «Hacer un reel como este» (docs/reel-como-este.md).
--
-- Una persona sube un vídeo que le gusta (o pega su enlace) y el sistema lo
-- ESTUDIA para rehacerlo con las ideas y el material de la marca. El vídeo de
-- referencia solo se analiza: de él no entra nada en la biblioteca.
--
--   1. `reel_references`: un análisis. Lo crea `request_media_job` al encargar
--      el trabajo `media.reel.analyze` (que mide el vídeo SIN IA en el
--      trabajador de medios), recibe la medición al terminar el trabajo y el
--      resultado de la IA por la función `ai-reel-like` (clave de servicio).
--   2. La PLANTILLA reutilizable que sale del análisis NO se guarda aquí: va a
--      `brand_reel_templates` (migración 20261224010000, formato compartido
--      `rrss.reel-template`), con `deliver_reel_templates(…, 'reference')`.
--   3. `request_media_job`, `cancel_media_job`, `jobs_plan_limit` y la cuenta
--      mensual admiten el tipo nuevo. `worker-gateway` no cambia: el tipo
--      `media.%` ya pasa (`private.is_media_worker_kind`).
--   4. Archivos: el vídeo subido vive en `<org>/<marca>/referencias/<uuid>.<ext>`
--      y los fotogramas y trozos de sonido del análisis en
--      `<org>/<marca>/referencias/<id>/`. Al terminar (bien, mal o descartado)
--      sus rutas pasan a `storage_cleanup_queue`: la función los borra en el
--      acto y, si no puede, los barre la limpieza de siempre.
--
-- Vuelta atrás: supabase/rollbacks/20261223010000_reel_like.sql

-- ───────────────────────────── Tabla ─────────────────────────────

create table public.reel_references (
  id uuid primary key,
  brand_id uuid not null,
  organization_id uuid not null,
  job_id uuid references public.jobs (id) on delete set null,
  -- De dónde vino: un archivo subido o un enlace (del enlace solo se guarda el dominio).
  source_kind text not null check (source_kind in ('upload', 'link')),
  source_host text check (source_host is null or char_length(source_host) between 1 and 255),
  -- Ruta del archivo subido mientras exista (se borra tras el análisis, salvo `keep_source`).
  source_path text check (source_path is null or char_length(source_path) between 75 and 600),
  keep_source boolean not null default false,
  -- ¿Se prepara el sonido para transcribir lo que se dice?
  speech boolean not null default false,
  -- De qué quiere la marca que vaya SU reel (opcional).
  idea text not null default '' check (char_length(idea) <= 600),
  status text not null default 'analyzing'
    check (status in ('analyzing', 'measured', 'ready', 'failed', 'expired')),
  error text check (error is null or char_length(error) <= 1000),
  -- Medición sin IA del trabajador (planos, cortes, compás, fotogramas).
  measurement jsonb check (measurement is null or (jsonb_typeof(measurement) = 'object'
                                                   and pg_column_size(measurement) <= 262144)),
  -- Resultado: plantilla, guion, textos (supabase/functions/_shared/reels/like.ts).
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 262144)),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  generation_ids uuid[] not null default '{}',
  -- Pieza (borrador de reel) que se abrió en el editor a partir de este análisis.
  content_id uuid references public.content_items (id) on delete set null,
  -- Cuándo se soltaron los archivos del análisis (pasaron a la cola de limpieza).
  files_released_at timestamptz,
  -- Cuándo empezó la parte de IA (para no lanzarla dos veces a la vez).
  ai_started_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade,
  check (source_kind = 'upload' or (source_path is null and not keep_source))
);
create index reel_references_brand_idx on public.reel_references (brand_id, created_at desc);
create index reel_references_content_idx on public.reel_references (content_id) where content_id is not null;
create unique index reel_references_source_path_idx on public.reel_references (source_path) where source_path is not null;

-- ───────────────────────── Seguridad a nivel de fila ─────────────────────────

alter table public.reel_references enable row level security;

-- Lo ve quien ve la marca. No hay políticas de escritura: todo entra por funciones.
create policy reel_references_select on public.reel_references for select to authenticated
  using (brand_id in (select private.brand_ids_with('view')));

create trigger reel_references_touch before update on public.reel_references
  for each row execute function private.touch_updated_at();

-- ───────────────────────── Archivos del análisis ─────────────────────────

-- Fotogramas y trozos de sonido que puede dejar el trabajador (los mismos topes
-- que worker/src/handlers/reel-analyze.ts): si no hay medición (el trabajo
-- falló a medias), se sueltan todos los nombres posibles.
create function private.reel_reference_file_paths(p_ref public.reel_references, p_include_kept boolean)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dir text := format('%s/%s/referencias/%s', p_ref.organization_id, p_ref.brand_id, p_ref.id);
  v_paths text[] := '{}';
begin
  if p_ref.source_path is not null and (p_include_kept or not p_ref.keep_source) then
    v_paths := v_paths || p_ref.source_path;
  end if;
  if p_ref.measurement is not null then
    select v_paths || coalesce(array_agg(e.value ->> 'path'), '{}') into v_paths
    from jsonb_array_elements(coalesce(p_ref.measurement -> 'frames', '[]'::jsonb)
                              || coalesce(p_ref.measurement #> '{audio,speech}', '[]'::jsonb)) e
    where e.value ->> 'path' like v_dir || '/%';
  else
    select v_paths || array_agg(format('%s/%s-%s.%s', v_dir, k.prefix, lpad(n::text, 2, '0'), k.ext)) into v_paths
    from generate_series(1, 12) n, (values ('f', 'jpg'), ('a', 'm4a')) k(prefix, ext);
  end if;
  return v_paths;
end $$;

-- Suelta los archivos de un análisis: sus rutas pasan a la cola de limpieza
-- (cada una en su almacén) y el análisis deja de apuntar al vídeo subido.
-- Devuelve las rutas, para que quien pueda las borre en el acto.
create function private.reel_reference_release_files(p_reference_id uuid, p_include_kept boolean)
returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_ref public.reel_references;
  v_paths text[];
begin
  select * into v_ref from public.reel_references r where r.id = p_reference_id for update;
  if not found then
    return '{}';
  end if;
  v_paths := private.reel_reference_file_paths(v_ref, p_include_kept);
  insert into public.storage_cleanup_queue (organization_id, brand_id, storage_path, storage_backend)
  select v_ref.organization_id, v_ref.brand_id, p.path,
         coalesce((select l.backend from private.media_object_locations l where l.storage_path = p.path), 'supabase')
  from unnest(v_paths) p(path)
  on conflict (storage_path) do nothing;
  update public.reel_references r
  set files_released_at = now(),
      source_path = case when p_include_kept or not r.keep_source then null else r.source_path end,
      keep_source = case when p_include_kept then false else r.keep_source end
  where r.id = p_reference_id;
  return v_paths;
end $$;

-- Análisis abandonados: medidos hace más de un día sin pasar por la IA, o que
-- siguen «analizando» sin trabajo vivo. Se dan por caducados y se sueltan sus archivos.
create function private.reel_references_expire(p_brand_id uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_ref record;
  v_count integer := 0;
begin
  for v_ref in
    select r.id from public.reel_references r
    where (p_brand_id is null or r.brand_id = p_brand_id)
      and r.created_at < now() - interval '24 hours'
      and (r.status = 'measured'
           or (r.status = 'analyzing'
               and not exists (select 1 from public.jobs j where j.id = r.job_id and j.status in ('queued', 'running'))))
    for update skip locked
  loop
    perform private.reel_reference_release_files(v_ref.id, true);
    update public.reel_references r
    set status = 'expired', error = 'El análisis caducó sin terminarse: vuelve a subir el vídeo.'
    where r.id = v_ref.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ───────────────────────── Encargo del análisis ─────────────────────────

create function private.media_reel_analyze_payload(p_org uuid, p_brand_id uuid, p_input jsonb, p_file text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_file::uuid;
  v_source jsonb := p_input -> 'source';
  v_path text;
  v_url text;
  v_host text;
  v_speech boolean := false;
  v_keep boolean := false;
  v_idea text := '';
begin
  if not private.jsonb_only_keys(p_input, array['source', 'speech', 'keepSource', 'idea'])
     or jsonb_typeof(v_source) is distinct from 'object'
     or not private.jsonb_only_keys(v_source, array['path', 'url'])
     or ((v_source ? 'path') = (v_source ? 'url')) then
    raise exception 'El análisis de un reel necesita el archivo subido o un enlace, y solo uno de los dos'
      using errcode = '22023';
  end if;
  if p_input ? 'speech' then
    if jsonb_typeof(p_input -> 'speech') <> 'boolean' then
      raise exception 'Indica con sí o no si hay que transcribir la voz' using errcode = '22023';
    end if;
    v_speech := (p_input ->> 'speech')::boolean;
  end if;
  if p_input ? 'keepSource' then
    if jsonb_typeof(p_input -> 'keepSource') <> 'boolean' then
      raise exception 'Indica con sí o no si se guarda el vídeo de referencia' using errcode = '22023';
    end if;
    v_keep := (p_input ->> 'keepSource')::boolean;
  end if;
  if p_input ? 'idea' then
    if jsonb_typeof(p_input -> 'idea') <> 'string' or char_length(p_input ->> 'idea') > 600 then
      raise exception 'La idea del reel es un texto de 600 caracteres como mucho' using errcode = '22023';
    end if;
    v_idea := btrim(p_input ->> 'idea');
  end if;

  if v_source ? 'path' then
    v_path := v_source ->> 'path';
    -- Solo la carpeta privada de referencias de ESTA marca: nunca un recurso de la biblioteca.
    if jsonb_typeof(v_source -> 'path') <> 'string'
       or v_path !~ ('^' || p_org::text || '/' || p_brand_id::text
                     || '/referencias/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$') then
      raise exception 'El vídeo de referencia tiene que estar en la carpeta de referencias de esta marca (MP4, MOV o WebM)'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.reel_references r where r.source_path = v_path) then
      raise exception 'Ese vídeo de referencia ya se está analizando' using errcode = '22023';
    end if;
  else
    v_url := v_source ->> 'url';
    if jsonb_typeof(v_source -> 'url') <> 'string' or char_length(v_url) > 2000
       or v_url !~* '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?(/[^[:space:]]*)?$' then
      raise exception 'El enlace no es una dirección web válida (http o https, sin usuario ni contraseña)'
        using errcode = '22023';
    end if;
    if v_keep then
      raise exception 'Solo se puede guardar como referencia un vídeo subido, no un enlace' using errcode = '22023';
    end if;
    v_host := lower(substring(v_url from '^[a-zA-Z]+://([^/:?#]+)'));
  end if;

  insert into public.reel_references (id, brand_id, organization_id, source_kind, source_host, source_path,
                                      keep_source, speech, idea, created_by)
  values (v_id, p_brand_id, p_org, case when v_path is null then 'link' else 'upload' end, v_host, v_path,
          v_keep, v_speech, v_idea, p_user);

  return jsonb_build_object(
    'reference', jsonb_build_object('id', v_id),
    'source', case when v_path is null then jsonb_build_object('url', v_url) else jsonb_build_object('path', v_path) end,
    'speech', v_speech,
    'output', jsonb_build_object('dir', format('%s/%s/referencias/%s', p_org, p_brand_id, v_id))
  );
end $$;

-- Trabajos de medios pedidos por la marca este mes: cuenta también los análisis.
create or replace function private.media_jobs_this_month(p_brand_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.jobs j
  where j.brand_id = p_brand_id
    and j.kind in ('media.reel.template', 'media.image.process', 'media.cutout', 'media.reel.analyze')
    and j.status <> 'cancelled'
    and j.created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC');
$$;

-- Igual que la versión de 20261219010000 con el tipo `media.reel.analyze`.
create or replace function public.request_media_job(
  p_brand_id uuid,
  p_kind text,
  p_input jsonb,
  p_idempotency_key text
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_key text;
  v_job public.jobs;
  v_input jsonb;
  v_payload jsonb;
  v_active integer;
begin
  if v_user is null then
    raise exception 'Inicia sesión para encargar trabajos' using errcode = '42501';
  end if;
  if p_brand_id is null or p_brand_id not in (select private.brand_ids_with('edit')) then
    raise exception 'No tienes permiso para crear medios en esta marca' using errcode = '42501';
  end if;
  if p_kind is null
     or p_kind not in ('media.reel.template', 'media.image.process', 'media.cutout', 'media.reel.analyze') then
    raise exception 'Tipo de trabajo no admitido: %', coalesce(p_kind, '(vacío)') using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'Falta la clave del encargo (entre 8 y 100 caracteres)' using errcode = '22023';
  end if;

  -- Un encargo a la vez por marca: la cuenta de trabajos activos no se adelanta.
  select b.organization_id into v_org from public.brands b where b.id = p_brand_id for update;
  -- La clave lleva la marca: la misma clave en otra marca de la organización es otro encargo.
  v_key := format('media:%s:%s', p_brand_id, p_idempotency_key);

  select * into v_job from public.jobs j where j.organization_id = v_org and j.idempotency_key = v_key;
  if found then
    if v_job.kind <> p_kind or v_job.brand_id is distinct from p_brand_id then
      raise exception 'Esa clave ya se usó para otro encargo' using errcode = '22023';
    end if;
    return v_job;
  end if;

  select count(*) into v_active from public.jobs j
  where j.brand_id = p_brand_id
    and j.kind in ('media.reel.template', 'media.image.process', 'media.cutout', 'media.reel.analyze')
    and j.status in ('queued', 'running');
  if v_active >= private.media_jobs_max_active() then
    raise exception 'Hay % trabajos de medios en marcha en esta marca, el máximo a la vez. Espera a que termine alguno.', v_active
      using errcode = 'P0001';
  end if;

  -- Tope mensual por marca (ajuste de Integraciones; ver private.media_jobs_monthly_max).
  if private.media_jobs_monthly_max() is not null
     and private.media_jobs_this_month(p_brand_id) >= private.media_jobs_monthly_max() then
    raise exception 'Esta marca ha llegado a su tope mensual de % trabajos de medios (reels y recortes de fondo). Se renueva el día 1 del mes que viene; si necesitas más, avisa a quien administra la plataforma.', private.media_jobs_monthly_max()
      using errcode = 'P0001';
  end if;

  -- Los nulos de JSON cuentan como «no está» (música opcional, etc.).
  v_input := jsonb_strip_nulls(coalesce(p_input, '{}'::jsonb));
  if p_kind = 'media.reel.template' then
    v_payload := private.media_reel_payload(v_org, p_brand_id, v_input, gen_random_uuid()::text);
  elsif p_kind = 'media.cutout' then
    v_payload := private.media_cutout_payload(v_org, p_brand_id, v_input, gen_random_uuid()::text);
  elsif p_kind = 'media.reel.analyze' then
    -- De paso, los análisis abandonados de la marca sueltan sus archivos.
    perform private.reel_references_expire(p_brand_id);
    v_payload := private.media_reel_analyze_payload(v_org, p_brand_id, v_input, gen_random_uuid()::text, v_user);
  else
    v_payload := private.media_image_payload(v_org, p_brand_id, v_input, gen_random_uuid()::text);
  end if;

  v_job := public.enqueue_job(v_org, p_kind, v_payload, v_key, p_brand_id, 0, 3, null, v_user);
  if p_kind = 'media.reel.analyze' then
    update public.reel_references r set job_id = v_job.id where r.id = (v_payload #>> '{reference,id}')::uuid;
  end if;
  return v_job;
end $$;

create or replace function public.cancel_media_job(p_job_id uuid)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs;
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para cancelar trabajos' using errcode = '42501';
  end if;
  select * into v_job from public.jobs j
  where j.id = p_job_id
    and j.kind in ('media.reel.template', 'media.image.process', 'media.cutout', 'media.reel.analyze')
    and j.brand_id is not null
    and j.brand_id in (select private.brand_ids_with('edit'))
  for update;
  if not found then
    raise exception 'No tienes permiso para cancelar este trabajo' using errcode = '42501';
  end if;
  if v_job.status not in ('queued', 'running') then
    raise exception 'Este trabajo ya ha terminado: no se puede cancelar' using errcode = 'P0001';
  end if;
  return public.cancel_job(v_job.id);
end $$;

-- Estudiar un reel de referencia es parte de «reels» en el plan.
create or replace function private.jobs_plan_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind in ('media.reel.template', 'media.reel.analyze') then
    perform private.require_plan_feature(new.organization_id, 'reels');
  end if;
  if new.kind in ('media.reel.template', 'media.image.process', 'media.cutout', 'source.extract') then
    perform private.check_storage_limit(new.organization_id, 0);
  end if;
  return new;
end $$;

-- ───────────────────────── Del trabajo al análisis ─────────────────────────

-- Al terminar el trabajo: la medición pasa al análisis (o el motivo del fallo, y
-- entonces se sueltan los archivos). El resultado tiene que ser el de SU análisis
-- y sus archivos, de SU carpeta; si no, `complete_job` falla y no se cierra.
create function private.jobs_sync_reel_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (new.payload #>> '{reference,id}')::uuid;
  v_dir text := new.payload #>> '{output,dir}';
begin
  if v_id is null then
    return new;
  end if;
  if new.status = 'succeeded' then
    if new.result #>> '{reference,id}' is distinct from v_id::text
       or jsonb_typeof(new.result -> 'shots') is distinct from 'array'
       or jsonb_array_length(new.result -> 'shots') not between 1 and 30
       or jsonb_typeof(new.result -> 'frames') is distinct from 'array'
       or jsonb_array_length(new.result -> 'frames') > 12
       or exists (
         select 1
         from jsonb_array_elements(coalesce(new.result -> 'frames', '[]'::jsonb)
                                   || coalesce(new.result #> '{audio,speech}', '[]'::jsonb)) e
         where e.value ->> 'path' is null or e.value ->> 'path' not like v_dir || '/%'
            or e.value ->> 'path' ~ '(^|/)\.{1,2}(/|$)'
       ) then
      raise exception 'El resultado del análisis no corresponde a su encargo' using errcode = '22023';
    end if;
    update public.reel_references r
    set status = 'measured', measurement = new.result, error = null
    where r.id = v_id and r.status = 'analyzing';
  else
    update public.reel_references r
    set status = 'failed',
        error = left(case when new.status = 'cancelled' then 'Se canceló el análisis.'
                          else coalesce(nullif(new.last_error, ''), 'No se pudo analizar el vídeo.') end, 1000)
    where r.id = v_id and r.status = 'analyzing';
    if found then
      perform private.reel_reference_release_files(v_id, true);
    end if;
  end if;
  return new;
end $$;

create trigger jobs_sync_reel_reference after update of status on public.jobs
  for each row
  when (new.kind = 'media.reel.analyze' and old.status is distinct from new.status
        and new.status in ('succeeded', 'failed', 'cancelled'))
  execute function private.jobs_sync_reel_reference();

-- ─────────────────────── RPC del servidor (clave de servicio) ───────────────────────

-- La función `ai-reel-like` guarda el resultado de la IA. Suelta los archivos del
-- análisis (el vídeo subido también, salvo que se pidiera guardarlo) y devuelve
-- sus rutas para borrarlas en el acto.
create function public.reel_reference_finish(
  p_reference_id uuid,
  p_result jsonb,
  p_cost_micros bigint,
  p_generation_ids uuid[]
) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_ref public.reel_references;
begin
  select * into v_ref from public.reel_references r where r.id = p_reference_id for update;
  if not found then
    raise exception 'No existe ese análisis' using errcode = 'P0002';
  end if;
  if v_ref.status <> 'measured' then
    raise exception 'Ese análisis no está pendiente de resultado' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' or (p_result ->> 'schemaVersion') is distinct from '1'
     or jsonb_typeof(p_result -> 'template') is distinct from 'object' then
    raise exception 'El resultado no tiene la forma esperada' using errcode = '22023';
  end if;
  update public.reel_references r
  set status = 'ready', result = p_result, error = null, ai_started_at = null,
      cost_micros = greatest(coalesce(p_cost_micros, 0), 0),
      generation_ids = coalesce(p_generation_ids, '{}')
  where r.id = p_reference_id;
  return private.reel_reference_release_files(p_reference_id, false);
end $$;

-- Reserva la parte de IA de un análisis medido (una sola a la vez: una reserva de
-- hace más de 5 minutos se da por perdida) o la suelta si la IA falló.
create function public.reel_reference_claim(p_reference_id uuid, p_claim boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_claim, false) then
    update public.reel_references r set ai_started_at = now()
    where r.id = p_reference_id and r.status = 'measured'
      and (r.ai_started_at is null or r.ai_started_at < now() - interval '5 minutes');
  else
    update public.reel_references r set ai_started_at = null
    where r.id = p_reference_id and r.status = 'measured';
  end if;
  return found;
end $$;

-- Barrido de análisis abandonados (lo llama la función al atender a una marca).
create function public.reel_references_expire(p_brand_id uuid) returns integer
language sql security definer set search_path = '' as $$
  select private.reel_references_expire(p_brand_id);
$$;

-- ─────────────────────────── RPC para personas ───────────────────────────

-- Descarta un análisis: cancela su trabajo si sigue en marcha, suelta TODOS sus
-- archivos (también el vídeo guardado como referencia) y borra la fila.
-- Devuelve las rutas soltadas (ya están en la cola de limpieza).
create function public.discard_reel_reference(p_reference_id uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_ref public.reel_references;
  v_paths text[];
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para descartar el análisis' using errcode = '42501';
  end if;
  select * into v_ref from public.reel_references r
  where r.id = p_reference_id and r.brand_id in (select private.brand_ids_with('edit'))
  for update;
  if not found then
    raise exception 'No tienes permiso para descartar este análisis' using errcode = '42501';
  end if;
  -- Antes de cancelar: al cancelarse el trabajo, el análisis ya suelta sus archivos.
  v_paths := private.reel_reference_file_paths(v_ref, true);
  if v_ref.status = 'analyzing' and v_ref.job_id is not null then
    update public.jobs j
    set status = 'cancelled', locked_by = null, locked_until = null, finished_at = now()
    where j.id = v_ref.job_id and j.status in ('queued', 'running');
  end if;
  perform private.reel_reference_release_files(p_reference_id, true);
  delete from public.reel_references r where r.id = p_reference_id;
  return v_paths;
end $$;

-- Apunta qué pieza (borrador de reel) se abrió en el editor a partir del análisis.
create function public.set_reel_reference_content(p_reference_id uuid, p_content_id uuid)
returns public.reel_references
language plpgsql security definer set search_path = '' as $$
declare
  v_ref public.reel_references;
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión' using errcode = '42501';
  end if;
  select * into v_ref from public.reel_references r
  where r.id = p_reference_id and r.brand_id in (select private.brand_ids_with('edit'))
  for update;
  if not found then
    raise exception 'No tienes permiso para cambiar este análisis' using errcode = '42501';
  end if;
  if not exists (select 1 from public.content_items c
                 where c.id = p_content_id and c.brand_id = v_ref.brand_id and c.format = 'reel') then
    raise exception 'Esa pieza no es un reel de esta marca' using errcode = '22023';
  end if;
  update public.reel_references r set content_id = p_content_id where r.id = p_reference_id returning * into v_ref;
  return v_ref;
end $$;

-- ───────────────────────────── Privilegios ─────────────────────────────

revoke all on public.reel_references from anon, authenticated, public;
grant select on public.reel_references to authenticated;
grant all on public.reel_references to service_role;

revoke all on function private.reel_reference_file_paths(public.reel_references, boolean) from public, anon, authenticated;
revoke all on function private.reel_reference_release_files(uuid, boolean) from public, anon, authenticated;
revoke all on function private.reel_references_expire(uuid) from public, anon, authenticated;
revoke all on function private.media_reel_analyze_payload(uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function private.media_jobs_this_month(uuid) from public, anon, authenticated;
revoke all on function private.jobs_sync_reel_reference() from public, anon, authenticated;

revoke all on function public.request_media_job(uuid, text, jsonb, text) from public, anon;
grant execute on function public.request_media_job(uuid, text, jsonb, text) to authenticated;
revoke all on function public.cancel_media_job(uuid) from public, anon;
grant execute on function public.cancel_media_job(uuid) to authenticated;

revoke all on function public.reel_reference_finish(uuid, jsonb, bigint, uuid[]) from public, anon, authenticated;
grant execute on function public.reel_reference_finish(uuid, jsonb, bigint, uuid[]) to service_role;
revoke all on function public.reel_reference_claim(uuid, boolean) from public, anon, authenticated;
grant execute on function public.reel_reference_claim(uuid, boolean) to service_role;
revoke all on function public.reel_references_expire(uuid) from public, anon, authenticated;
grant execute on function public.reel_references_expire(uuid) to service_role;

revoke all on function public.discard_reel_reference(uuid) from public, anon;
grant execute on function public.discard_reel_reference(uuid) to authenticated;
revoke all on function public.set_reel_reference_content(uuid, uuid) from public, anon;
grant execute on function public.set_reel_reference_content(uuid, uuid) to authenticated;
