-- Vuelta atrás de 20261223010000_reel_like.sql: quita «Hacer un reel como este».
-- Los análisis en marcha se cancelan y se BORRAN los análisis (reel_references); las plantillas
-- de reel guardadas a partir de ellos (brand_reel_templates, migración 20261224010000) se quedan. Antes, los archivos de los análisis
-- que quedaran (vídeos de referencia, fotogramas, sonido) pasan a la cola de limpieza para
-- que no se queden huérfanos. Las piezas de reel creadas a partir de un análisis se quedan.

update public.jobs set status = 'cancelled', locked_by = null, locked_until = null, finished_at = now()
where kind = 'media.reel.analyze' and status in ('queued', 'running');

select private.reel_reference_release_files(r.id, true)
from public.reel_references r
where r.files_released_at is null or r.source_path is not null;

drop trigger if exists jobs_sync_reel_reference on public.jobs;
drop function if exists private.jobs_sync_reel_reference();
drop function if exists public.set_reel_reference_content(uuid, uuid);
drop function if exists public.discard_reel_reference(uuid);
drop function if exists public.reel_references_expire(uuid);
drop function if exists public.reel_reference_claim(uuid, boolean);
drop function if exists public.reel_reference_finish(uuid, jsonb, bigint, uuid[]);

-- Las funciones de antes (20261219010000 y 20261214010000), sin el tipo `media.reel.analyze`.

create or replace function private.media_jobs_this_month(p_brand_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.jobs j
  where j.brand_id = p_brand_id
    and j.kind in ('media.reel.template', 'media.image.process', 'media.cutout')
    and j.status <> 'cancelled'
    and j.created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC');
$$;

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
  if p_kind is null or p_kind not in ('media.reel.template', 'media.image.process', 'media.cutout') then
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
    and j.kind in ('media.reel.template', 'media.image.process', 'media.cutout')
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
  else
    v_payload := private.media_image_payload(v_org, p_brand_id, v_input, gen_random_uuid()::text);
  end if;

  return public.enqueue_job(v_org, p_kind, v_payload, v_key, p_brand_id, 0, 3, null, v_user);
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
    and j.kind in ('media.reel.template', 'media.image.process', 'media.cutout')
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

create or replace function private.jobs_plan_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'media.reel.template' then
    perform private.require_plan_feature(new.organization_id, 'reels');
  end if;
  if new.kind in ('media.reel.template', 'media.image.process', 'media.cutout', 'source.extract') then
    perform private.check_storage_limit(new.organization_id, 0);
  end if;
  return new;
end $$;

drop function if exists private.media_reel_analyze_payload(uuid, uuid, jsonb, text, uuid);
drop function if exists private.reel_references_expire(uuid);
drop function if exists private.reel_reference_release_files(uuid, boolean);
drop function if exists private.reel_reference_file_paths(public.reel_references, boolean);

drop table if exists public.reel_references;

revoke all on function private.media_jobs_this_month(uuid) from public, anon, authenticated;
revoke all on function public.request_media_job(uuid, text, jsonb, text) from public, anon;
grant execute on function public.request_media_job(uuid, text, jsonb, text) to authenticated;
revoke all on function public.cancel_media_job(uuid) from public, anon;
grant execute on function public.cancel_media_job(uuid) to authenticated;
