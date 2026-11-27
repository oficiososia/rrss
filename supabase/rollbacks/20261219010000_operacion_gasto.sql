-- Vuelta atrás de 20261219010000_operacion_gasto.sql.
-- Borra los avisos de plataforma (platform_alerts) y el ajuste del tope global
-- (con su valor guardado); la cola de limpieza y los trabajos no se tocan.

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      perform cron.unschedule('rrss-platform-alerts');
    exception when others then null;
    end;
    begin
      perform cron.unschedule('rrss-storage-cleanup');
    exception when others then null;
    end;
  end if;
end
$do$;

create or replace function public.ai_reserve_generation(
  p_user_id uuid,
  p_brand_id uuid,
  p_task public.ai_task,
  p_purpose text,
  p_provider text,
  p_model text,
  p_reserve_micros bigint,
  p_ttl_seconds integer default 600
) returns public.ai_generations
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_plan public.plans;
  v_limit bigint;
  v_committed bigint;
  v_period date := private.ai_period_start(now());
  v_gen public.ai_generations;
begin
  if p_reserve_micros is null or p_reserve_micros <= 0 then
    raise exception 'La reserva de cupo debe ser mayor que cero' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 10 and 86400 then
    raise exception 'La caducidad de la reserva debe estar entre 10 segundos y un día' using errcode = '22023';
  end if;

  select b.organization_id into v_org from public.brands b where b.id = p_brand_id;
  if v_org is null or p_user_id is null
     or not private.user_has_brand_capability(p_user_id, p_brand_id, 'edit') then
    raise exception 'No tienes permiso para generar contenido en esta marca' using errcode = '42501';
  end if;

  perform private.lock_subscription(v_org);
  v_plan := private.org_plan(v_org);

  perform private.require_plan_feature(v_org, case p_task
    when 'image' then 'ai_image' when 'video' then 'ai_video' else 'ai_text' end);

  select q.limit_value into v_limit
  from public.usage_quotas q
  where q.organization_id = v_org and q.metric = 'ai_cost_micros';
  if not found then
    if v_plan.ai_monthly_micros <= 0 then
      raise exception 'Esta organización no tiene cupo de IA asignado: su plan «%» no incluye IA', v_plan.name
        using errcode = 'AI002';
    end if;
    v_limit := v_plan.ai_monthly_micros;
  end if;

  if p_task in ('image', 'video') then
    perform private.check_storage_limit(v_org, 0);
  end if;

  perform private.ai_release_expired(v_org);

  select coalesce(sum(u.reserved_delta_micros + u.cost_delta_micros), 0) into v_committed
  from public.ai_usage u
  where u.organization_id = v_org and u.period_start = v_period;

  if v_committed + p_reserve_micros > v_limit then
    raise exception 'El cupo de IA de este mes está agotado: no queda saldo suficiente para esta generación'
      using errcode = 'AI001',
            detail = jsonb_build_object(
              'period_start', v_period, 'limit_micros', v_limit,
              'committed_micros', v_committed, 'requested_micros', p_reserve_micros)::text;
  end if;

  insert into public.ai_generations (brand_id, organization_id, requested_by, task, purpose, provider, model,
                                     period_start, reserved_micros, reserved_until)
  values (p_brand_id, v_org, p_user_id, p_task, p_purpose, p_provider, p_model,
          v_period, p_reserve_micros, now() + make_interval(secs => p_ttl_seconds))
  returning * into v_gen;

  insert into public.ai_usage (organization_id, brand_id, generation_id, period_start, entry, reserved_delta_micros)
  values (v_org, p_brand_id, v_gen.id, v_period, 'reserve', p_reserve_micros);

  return v_gen;
end $$;

create or replace function public.ai_media_allowance(p_user_id uuid, p_brand_id uuid, p_task public.ai_task)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_plan public.plans;
  v_limit bigint;
  v_committed bigint;
  v_period date := private.ai_period_start(now());
  v_feature text := case p_task when 'image' then 'ai_image' when 'video' then 'ai_video' else 'ai_text' end;
begin
  select b.organization_id into v_org from public.brands b where b.id = p_brand_id;
  if v_org is null or p_user_id is null
     or not private.user_has_brand_capability(p_user_id, p_brand_id, 'edit') then
    return jsonb_build_object('allowed', false, 'reason', 'no_permission', 'remaining_micros', 0);
  end if;
  v_plan := private.org_plan(v_org);
  if not (v_feature = any (v_plan.features)) then
    return jsonb_build_object('allowed', false, 'reason', 'plan', 'remaining_micros', 0);
  end if;
  select q.limit_value into v_limit
  from public.usage_quotas q where q.organization_id = v_org and q.metric = 'ai_cost_micros';
  if not found then
    if v_plan.ai_monthly_micros <= 0 then
      return jsonb_build_object('allowed', false, 'reason', 'no_quota', 'remaining_micros', 0);
    end if;
    v_limit := v_plan.ai_monthly_micros;
  end if;
  perform private.ai_release_expired(v_org);
  select coalesce(sum(u.reserved_delta_micros + u.cost_delta_micros), 0) into v_committed
  from public.ai_usage u where u.organization_id = v_org and u.period_start = v_period;
  if v_limit - v_committed <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'quota_exhausted', 'remaining_micros', 0);
  end if;
  return jsonb_build_object('allowed', true, 'reason', null, 'remaining_micros', v_limit - v_committed);
end $$;

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

drop function if exists public.platform_alert_external(text, text, text, text, jsonb);
drop function if exists public.platform_price_review(date);
drop function if exists private.media_jobs_this_month(uuid);
drop function if exists private.media_jobs_monthly_max();
drop function if exists public.storage_cleanup_orphans(interval, integer);
drop function if exists private.storage_cleanup_dispatch();
drop function if exists public.platform_alert_resolve(uuid);
drop function if exists public.platform_alerts_refresh();
drop function if exists private.platform_alerts_scan();
drop function if exists private.platform_alert_raise(text, text, uuid, text, text, jsonb, timestamptz);
drop table if exists public.platform_alerts;
drop function if exists public.platform_storage_by_brand();
drop function if exists public.platform_usage_overview(date);
drop function if exists private.job_machine_ms(jsonb);
drop function if exists public.platform_ai_global_status();
drop function if exists private.ai_global_remaining(date);
drop function if exists private.ai_global_committed(date);
drop function if exists private.ai_global_cap_micros();
delete from private.integration_setting_keys where setting_key in ('AI_GLOBAL_MONTHLY_CAP', 'MEDIA_JOBS_MONTHLY_PER_BRAND');
