-- Operación y control de gasto (docs/operacion-gasto.md).
--
--   1. Tope global mensual de gasto de IA (ajuste AI_GLOBAL_MONTHLY_CAP de
--      Plataforma → Integraciones). Al alcanzarlo, `ai_reserve_generation`
--      rechaza con AI003 toda generación de pago de cualquier organización; lo
--      que no cuesta (editar, publicar, plantillas, el recorte en el navegador)
--      no pasa por ahí y no se entera.
--   2. «Gasto y uso» (superadministrador): coste de IA del mes por organización
--      y por tipo, uso del trabajador de medios (tiempos guardados en
--      `jobs.result.timings`), almacenamiento por marca y cupo consumido.
--   3. Avisos de plataforma (`platform_alerts`): organización al 80 % y al 100 %
--      de su cupo, tope global, trabajos de medios que fallan repetidamente y
--      tareas programadas (pg_cron / pg_net) que fallan. Los genera
--      `private.platform_alerts_scan()`, que corre cada 10 minutos donde hay
--      pg_cron y que la pantalla también puede lanzar a mano.
--   4. Limpieza de `storage_cleanup_queue` de marcas y organizaciones ya
--      borradas (nadie del cliente las puede ver ya): las lee el servidor
--      (`media-storage/purge-cleanup`) y la tarea horaria las despacha.
--
--   5. Tope mensual de trabajos del trabajador de medios por marca (reels y
--      recortes), con ajuste MEDIA_JOBS_MONTHLY_PER_BRAND en Integraciones (por
--      defecto 400; 0 = sin tope). Se comprueba en `request_media_job`.
--   6. Revisión de precios de IA sin verificar y marcas de «cupo a mano» y
--      «plan sin límites» en «Gasto y uso».
--
-- Vuelta atrás: supabase/rollbacks/20261219010000_operacion_gasto.sql

-- ─────────────────── 1. Tope global mensual de IA ───────────────────

insert into private.integration_setting_keys (setting_key, integration, is_secret) values
  ('AI_GLOBAL_MONTHLY_CAP', 'ai_text', false),
  ('MEDIA_JOBS_MONTHLY_PER_BRAND', 'media_worker', false);

-- Tope en micros, o null si no hay (o no es un número válido: la pantalla
-- valida la forma antes de guardar).
create function private.ai_global_cap_micros() returns bigint
language sql stable security definer set search_path = '' as $$
  select case when btrim(s.plain_value) ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
              then round(btrim(s.plain_value)::numeric * 1000000)::bigint end
  from private.integration_settings s
  where s.setting_key = 'AI_GLOBAL_MONTHLY_CAP';
$$;

-- Lo comprometido en el mes por todas las organizaciones (reservas vivas +
-- coste real). Las reservas caducadas que nadie cerró no cuentan: se devolverán
-- solas cuando su organización vuelva a reservar.
create function private.ai_global_committed(p_period date) returns bigint
language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(u.reserved_delta_micros + u.cost_delta_micros)
                    from public.ai_usage u where u.period_start = p_period), 0)
        - coalesce((select sum(g.reserved_micros) from public.ai_generations g
                    where g.period_start = p_period and g.status = 'reserved' and g.reserved_until < now()), 0))::bigint;
$$;

-- Lo que queda del tope este mes (puede ser negativo), o null si no hay tope.
create function private.ai_global_remaining(p_period date) returns bigint
language sql stable security definer set search_path = '' as $$
  select private.ai_global_cap_micros() - private.ai_global_committed(p_period);
$$;

-- Igual que la versión de 20261119310000 con una comprobación más: el tope
-- global. Si hay tope, las reservas de todas las organizaciones se serializan
-- con un bloqueo de aviso (siempre después del de la suscripción, así que no
-- hay interbloqueos). Falla con:
--   AI003  la IA de pago está en pausa este mes por el tope global
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
  v_cap bigint;
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

  -- Tope global de la plataforma.
  v_cap := private.ai_global_cap_micros();
  if v_cap is not null then
    perform pg_advisory_xact_lock(hashtextextended('rrss.ai_global_cap', 0));
    if private.ai_global_committed(v_period) + p_reserve_micros > v_cap then
      raise exception 'La IA de pago está en pausa este mes: la plataforma ha llegado a su tope de gasto. Seguirá en pausa hasta el mes que viene o hasta que la plataforma amplíe el tope. Lo que no usa IA sigue funcionando.'
        using errcode = 'AI003',
              detail = jsonb_build_object(
                'period_start', v_period, 'cap_micros', v_cap,
                'committed_micros', private.ai_global_committed(v_period),
                'requested_micros', p_reserve_micros)::text;
    end if;
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

-- «¿Se puede animar ahora?» (20261217010000) con el motivo nuevo `ai_paused`.
create or replace function public.ai_media_allowance(p_user_id uuid, p_brand_id uuid, p_task public.ai_task)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_plan public.plans;
  v_limit bigint;
  v_committed bigint;
  v_remaining_global bigint;
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
  v_remaining_global := private.ai_global_remaining(v_period);
  if v_remaining_global is not null and v_remaining_global <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'ai_paused', 'remaining_micros', 0);
  end if;
  return jsonb_build_object('allowed', true, 'reason', null,
                            'remaining_micros', least(v_limit - v_committed, coalesce(v_remaining_global, v_limit - v_committed)));
end $$;

-- Estado del tope para la pantalla (superadministrador).
create function public.platform_ai_global_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_period date := private.ai_period_start(now());
  v_cap bigint := private.ai_global_cap_micros();
  v_committed bigint := private.ai_global_committed(v_period);
begin
  if not private.is_platform_admin() then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'period_start', v_period,
    'cap_micros', v_cap,
    'committed_micros', v_committed,
    'cost_micros', coalesce((select sum(u.cost_delta_micros) from public.ai_usage u where u.period_start = v_period), 0),
    'paused', v_cap is not null and v_committed >= v_cap);
end $$;

-- ─────────────────────── 2. «Gasto y uso» ───────────────────────

-- Milisegundos de máquina que el trabajador guardó en `result.timings`
-- (downloadMs, renderMs, uploadMs…): la suma de sus valores numéricos. Null si
-- el trabajo no trae tiempos (no se inventa un número).
create function private.job_machine_ms(p_result jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select sum(t.value::numeric)
  from jsonb_each_text(case when jsonb_typeof(p_result -> 'timings') = 'object'
                            then p_result -> 'timings' else '{}'::jsonb end) t
  where t.value ~ '^[0-9]+(\.[0-9]+)?$';
$$;

-- Por organización y mes: IA (coste por tipo, cupo), trabajador de medios y
-- almacenamiento. Solo superadministradores. `p_period_start` = primer día del mes.
create function public.platform_usage_overview(p_period_start date)
returns table (
  organization_id uuid, organization_name text, kind public.org_kind, plan_name text,
  plan_code text, plan_unlimited boolean,
  ai_limit_micros bigint, ai_limit_overridden boolean,
  ai_committed_micros bigint, ai_cost_micros bigint,
  cost_text_micros bigint, cost_image_micros bigint, cost_video_micros bigint, cost_transcription_micros bigint,
  generations bigint,
  media_jobs bigint, media_jobs_succeeded bigint, media_jobs_failed bigint, media_jobs_active bigint,
  media_machine_seconds numeric, media_jobs_without_timings bigint,
  storage_bytes bigint, storage_limit_bytes bigint
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'Indica el primer día del mes' using errcode = '22023';
  end if;
  v_from := p_period_start::timestamp at time zone 'UTC';
  v_to := (p_period_start + interval '1 month')::timestamp at time zone 'UTC';

  return query
    with cost as (
      select g.organization_id as org,
             coalesce(sum(g.cost_micros) filter (where g.task in ('text', 'vision', 'embedding')), 0)::bigint as t,
             coalesce(sum(g.cost_micros) filter (where g.task = 'image'), 0)::bigint as i,
             coalesce(sum(g.cost_micros) filter (where g.task = 'video'), 0)::bigint as v,
             coalesce(sum(g.cost_micros) filter (where g.task = 'transcription'), 0)::bigint as tr,
             count(*) as n
      from public.ai_generations g
      where g.status = 'succeeded' and g.period_start = p_period_start
      group by 1
    ), ledger as (
      select u.organization_id as org,
             coalesce(sum(u.reserved_delta_micros + u.cost_delta_micros), 0)::bigint as committed,
             coalesce(sum(u.cost_delta_micros), 0)::bigint as spent
      from public.ai_usage u
      where u.period_start = p_period_start
      group by 1
    ), media as (
      select j.organization_id as org, count(*) as total,
             count(*) filter (where j.status = 'succeeded') as ok,
             count(*) filter (where j.status = 'failed') as bad,
             count(*) filter (where j.status in ('queued', 'running')) as active,
             coalesce(sum(private.job_machine_ms(j.result)) filter (where j.status = 'succeeded'), 0) / 1000.0 as secs,
             count(*) filter (where j.status = 'succeeded' and private.job_machine_ms(j.result) is null) as untimed
      from public.jobs j
      where private.is_media_worker_kind(j.kind) and j.created_at >= v_from and j.created_at < v_to
      group by 1
    )
    select o.id, o.name, o.kind, pl.name,
           pl.code, (pl.max_brands is null or pl.max_members is null or pl.max_storage_bytes is null),
           coalesce(q.limit_value, pl.ai_monthly_micros)::bigint, q.limit_value is not null,
           coalesce(l.committed, 0)::bigint, coalesce(l.spent, 0)::bigint,
           coalesce(c.t, 0)::bigint, coalesce(c.i, 0)::bigint, coalesce(c.v, 0)::bigint, coalesce(c.tr, 0)::bigint,
           coalesce(c.n, 0)::bigint,
           coalesce(m.total, 0)::bigint, coalesce(m.ok, 0)::bigint, coalesce(m.bad, 0)::bigint,
           coalesce(m.active, 0)::bigint, round(coalesce(m.secs, 0), 1), coalesce(m.untimed, 0)::bigint,
           private.org_storage_bytes(o.id), pl.max_storage_bytes
    from public.organizations o
    cross join lateral private.org_plan(o.id) pl
    left join public.usage_quotas q on q.organization_id = o.id and q.metric = 'ai_cost_micros'
    left join cost c on c.org = o.id
    left join ledger l on l.org = o.id
    left join media m on m.org = o.id
    order by coalesce(l.committed, 0) desc, o.name;
end $$;

-- Almacenamiento por marca (recursos de la biblioteca + fuentes de conocimiento).
create function public.platform_storage_by_brand()
returns table (
  organization_id uuid, organization_name text, brand_id uuid, brand_name text,
  assets bigint, bytes bigint, r2_bytes bigint, media_jobs_month bigint, media_jobs_cap integer
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_platform_admin() then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, b.id, b.name,
           (select count(*) from public.media_assets ma where ma.brand_id = b.id),
           ((select coalesce(sum(ma.bytes), 0) from public.media_assets ma where ma.brand_id = b.id)
            + (select coalesce(sum(ks.bytes), 0) from public.brand_knowledge_sources ks where ks.brand_id = b.id))::bigint,
           (select coalesce(sum(ma.bytes), 0) from public.media_assets ma
            where ma.brand_id = b.id and ma.storage_backend = 'r2')::bigint,
           private.media_jobs_this_month(b.id), private.media_jobs_monthly_max()
    from public.brands b
    join public.organizations o on o.id = b.organization_id
    order by 6 desc, o.name, b.name;
end $$;

-- ─────────────────────── 3. Avisos de plataforma ───────────────────────

create table public.platform_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'ai_quota_80', 'ai_quota_100', 'ai_global_cap_80', 'ai_global_cap_reached',
    'media_jobs_failing', 'media_jobs_cap_reached', 'scheduled_job_failed', 'scheduled_http_failed',
    'worker_machine_long')),
  -- Un aviso por motivo y periodo: lo vuelve a generar la tarea sin duplicarlo.
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  organization_id uuid references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  detail text not null default '' check (char_length(detail) <= 1000),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 8192),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);
create index platform_alerts_open_idx on public.platform_alerts (created_at desc) where resolved_at is null;
create index platform_alerts_org_idx on public.platform_alerts (organization_id) where organization_id is not null;

-- Crea el aviso, o lo reabre si ya estaba resuelto y el hecho es posterior
-- (`p_occurred_at`; null = situación continua: un aviso resuelto no se reabre).
-- Devuelve true si el aviso es nuevo o se ha reabierto.
create function private.platform_alert_raise(
  p_kind text, p_key text, p_org uuid, p_title text, p_detail text, p_data jsonb, p_occurred_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.platform_alerts (kind, dedupe_key, organization_id, title, detail, data)
  values (p_kind, p_key, p_org, left(p_title, 200), left(coalesce(p_detail, ''), 1000), coalesce(p_data, '{}'::jsonb))
  on conflict (dedupe_key) do update
    set detail = excluded.detail, data = excluded.data, created_at = now(), resolved_at = null, resolved_by = null
    where public.platform_alerts.resolved_at is not null
      and p_occurred_at is not null and p_occurred_at > public.platform_alerts.resolved_at
  returning id into v_id;
  return v_id is not null;
end $$;

-- Mira el estado y levanta los avisos que falten. Devuelve cuántos ha creado o
-- reabierto. No falla por lo que no encuentre (sin pg_cron o sin pg_net
-- simplemente no hay nada que mirar de las tareas programadas).
create function private.platform_alerts_scan() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_period date := private.ai_period_start(now());
  v_day text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  v_count integer := 0;
  v_cap bigint;
  v_committed bigint;
  r record;
begin
  -- Cupo de IA por organización: 80 % y 100 %.
  for r in
    select o.id, o.name,
           coalesce(q.limit_value, pl.ai_monthly_micros) as lim,
           coalesce((select sum(u.reserved_delta_micros + u.cost_delta_micros) from public.ai_usage u
                     where u.organization_id = o.id and u.period_start = v_period), 0)::bigint as used
    from public.organizations o
    cross join lateral private.org_plan(o.id) pl
    left join public.usage_quotas q on q.organization_id = o.id and q.metric = 'ai_cost_micros'
  loop
    if r.lim > 0 and r.used >= r.lim then
      if private.platform_alert_raise('ai_quota_100', 'ai_quota_100:' || r.id || ':' || v_period, r.id,
           'Cupo de IA agotado: ' || r.name,
           'Esta organización ha llegado al 100 % de su cupo de IA de este mes y no puede generar más hasta el mes que viene o hasta que se amplíe.',
           jsonb_build_object('period_start', v_period, 'limit_micros', r.lim, 'committed_micros', r.used), null) then
        v_count := v_count + 1;
      end if;
    elsif r.lim > 0 and r.used * 100 >= r.lim * 80 then
      if private.platform_alert_raise('ai_quota_80', 'ai_quota_80:' || r.id || ':' || v_period, r.id,
           'Cupo de IA al 80 %: ' || r.name,
           'Esta organización ha usado más del 80 % de su cupo de IA de este mes.',
           jsonb_build_object('period_start', v_period, 'limit_micros', r.lim, 'committed_micros', r.used), null) then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  -- Tope global de la plataforma.
  v_cap := private.ai_global_cap_micros();
  if v_cap is not null then
    v_committed := private.ai_global_committed(v_period);
    if v_committed >= v_cap then
      if private.platform_alert_raise('ai_global_cap_reached', 'ai_global_cap_reached:' || v_period, null,
           'La IA de pago está en pausa: tope global alcanzado',
           'El gasto de IA de todas las organizaciones ha llegado al tope mensual de la plataforma. Ninguna organización puede generar con IA hasta el mes que viene o hasta que se amplíe el tope (Plataforma → Integraciones).',
           jsonb_build_object('period_start', v_period, 'cap_micros', v_cap, 'committed_micros', v_committed), null) then
        v_count := v_count + 1;
      end if;
    elsif v_committed * 100 >= v_cap * 80 then
      if private.platform_alert_raise('ai_global_cap_80', 'ai_global_cap_80:' || v_period, null,
           'Tope global de IA al 80 %',
           'El gasto de IA de la plataforma ha pasado del 80 % del tope mensual.',
           jsonb_build_object('period_start', v_period, 'cap_micros', v_cap, 'committed_micros', v_committed), null) then
        v_count := v_count + 1;
      end if;
    end if;
  end if;

  -- Trabajos de medios que fallan repetidamente: 3 o más en 24 horas en una organización.
  for r in
    select o.id, o.name, count(*) as n, max(j.finished_at) as last_at,
           (array_agg(left(coalesce(j.last_error, ''), 200) order by j.finished_at desc))[1] as last_error
    from public.jobs j
    join public.organizations o on o.id = j.organization_id
    where j.status = 'failed' and private.is_media_worker_kind(j.kind) and j.finished_at > now() - interval '24 hours'
    group by o.id, o.name
    having count(*) >= 3
  loop
    if private.platform_alert_raise('media_jobs_failing', 'media_jobs_failing:' || r.id || ':' || v_day, r.id,
         'Fallan los trabajos de medios: ' || r.name,
         r.n || ' trabajos del trabajador de medios han fallado en las últimas 24 horas. Último error: ' || r.last_error,
         jsonb_build_object('failed_24h', r.n, 'last_at', r.last_at), r.last_at) then
      v_count := v_count + 1;
    end if;
  end loop;

  -- Marcas que han llegado al tope mensual de trabajos de medios.
  if private.media_jobs_monthly_max() is not null then
    for r in
      select b.id as brand_id, b.name as brand_name, b.organization_id as org, o.name as org_name,
             private.media_jobs_this_month(b.id) as n
      from public.brands b join public.organizations o on o.id = b.organization_id
      where private.media_jobs_this_month(b.id) >= private.media_jobs_monthly_max()
    loop
      if private.platform_alert_raise('media_jobs_cap_reached', 'media_jobs_cap_reached:' || r.brand_id || ':' || v_period, r.org,
           'Tope mensual de trabajos de medios alcanzado: ' || r.brand_name || ' (' || r.org_name || ')',
           'Esta marca ha pedido ' || r.n || ' trabajos de medios (reels y recortes) este mes y ya no puede encargar más hasta el mes que viene. Si es uso legítimo, sube MEDIA_JOBS_MONTHLY_PER_BRAND en Integraciones.',
           jsonb_build_object('period_start', v_period, 'brand_id', r.brand_id, 'jobs', r.n,
                              'cap', private.media_jobs_monthly_max()), null) then
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  -- Tareas programadas (pg_cron) que han fallado en la última hora.
  if to_regclass('cron.job_run_details') is not null and to_regclass('cron.job') is not null then
    begin
      for r in execute
        'select j.jobname::text as jobname, count(*) as n, max(d.start_time) as last_at,
                (array_agg(left(coalesce(d.return_message, ''''), 200) order by d.start_time desc))[1] as msg
         from cron.job_run_details d join cron.job j on j.jobid = d.jobid
         where d.status = ''failed'' and d.start_time > now() - interval ''1 hour'' and j.jobname like ''rrss-%''
         group by j.jobname'
      loop
        if private.platform_alert_raise('scheduled_job_failed', 'scheduled_job_failed:' || r.jobname || ':' || v_day, null,
             'Ha fallado una tarea programada: ' || r.jobname,
             r.n || ' ejecuciones fallidas en la última hora. Mensaje: ' || r.msg,
             jsonb_build_object('job', r.jobname, 'failures_1h', r.n, 'last_at', r.last_at), r.last_at) then
          v_count := v_count + 1;
        end if;
      end loop;
    exception when others then
      raise warning 'platform_alerts_scan: no se pudo leer cron.job_run_details (%)', sqlerrm;
    end;
  end if;

  -- Funciones programadas (pg_net) que respondieron con error o no respondieron.
  if to_regclass('net._http_response') is not null then
    begin
      for r in execute
        'select count(*) as n, max(created) as last_at,
                (array_agg(coalesce(status_code::text, ''sin respuesta'') order by created desc))[1] as last_status
         from net._http_response
         where created > now() - interval ''1 hour'' and (status_code >= 400 or timed_out or error_msg is not null)
         having count(*) > 0'
      loop
        if private.platform_alert_raise('scheduled_http_failed', 'scheduled_http_failed:' || v_day, null,
             'Una función programada ha respondido con error',
             r.n || ' llamadas programadas a funciones han fallado en la última hora (última respuesta: ' || r.last_status || '). Revisa los registros de las Edge Functions.',
             jsonb_build_object('failures_1h', r.n, 'last_status', r.last_status, 'last_at', r.last_at), r.last_at) then
          v_count := v_count + 1;
        end if;
      end loop;
    exception when others then
      raise warning 'platform_alerts_scan: no se pudo leer net._http_response (%)', sqlerrm;
    end;
  end if;

  return v_count;
end $$;

-- Lanzado a mano desde la pantalla (superadministrador).
create function public.platform_alerts_refresh() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  return private.platform_alerts_scan();
end $$;

-- Marca como visto un aviso (o, con null, todos los abiertos). Devuelve cuántos.
create function public.platform_alert_resolve(p_id uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  update public.platform_alerts a
  set resolved_at = now(), resolved_by = (select auth.uid())
  where a.resolved_at is null and (p_id is null or a.id = p_id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

alter table public.platform_alerts enable row level security;

create policy platform_alerts_select on public.platform_alerts for select to authenticated
  using (private.is_platform_admin());

-- ─────────────── 4. Limpieza de la cola de marcas y organizaciones borradas ───────────────

-- Anotaciones de la cola cuya marca ya no existe (borrada sola o con su
-- organización): el cliente ya no las ve y solo las barre el servidor. Se espera
-- `p_min_age` para no pisar el borrado inmediato de `delete-organization`.
create function public.storage_cleanup_orphans(p_min_age interval default interval '1 hour', p_limit integer default 200)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', x.storage_path, 'backend', x.storage_backend)), '[]'::jsonb)
  from (
    select q.storage_path, q.storage_backend
    from public.storage_cleanup_queue q
    where q.created_at < now() - coalesce(p_min_age, interval '1 hour')
      and not exists (select 1 from public.brands b where b.id = q.brand_id)
    order by q.created_at
    limit greatest(coalesce(p_limit, 200), 1)
  ) x;
$$;

create function private.storage_cleanup_dispatch() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
  v_request bigint;
begin
  if not exists (
    select 1 from public.storage_cleanup_queue q
    where q.created_at < now() - interval '1 hour'
      and not exists (select 1 from public.brands b where b.id = q.brand_id)
  ) then
    return null;
  end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    raise warning 'storage_cleanup_dispatch: faltan Vault o pg_net; no se llama a media-storage';
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'rrss_project_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_key using 'rrss_service_role_key';
  if v_url is null or v_key is null then
    raise warning 'storage_cleanup_dispatch: faltan los secretos rrss_project_url o rrss_service_role_key en Vault';
    return null;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
    into v_request
    using rtrim(v_url, '/') || '/functions/v1/media-storage/purge-cleanup',
          jsonb_build_object('source', 'pg_cron'),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
          60000;
  return v_request;
end $$;


-- ─────────────── 5. Tope mensual de trabajos de medios por marca ───────────────

-- Trabajos al mes por marca (reels y recortes). Por defecto 400: es una cifra
-- de partida, no un dato medido; se cambia en Integraciones → Trabajador de
-- medios (MEDIA_JOBS_MONTHLY_PER_BRAND). 0 = sin tope (null).
create function private.media_jobs_monthly_max() returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when s.plain_value is null then 400
    when btrim(s.plain_value) ~ '^[0-9]{1,6}$' then nullif(btrim(s.plain_value)::integer, 0)
    else 400 end
  from (select 1) x left join private.integration_settings s on s.setting_key = 'MEDIA_JOBS_MONTHLY_PER_BRAND';
$$;

-- Trabajos de medios pedidos por la marca este mes (UTC), sin contar los cancelados.
create function private.media_jobs_this_month(p_brand_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.jobs j
  where j.brand_id = p_brand_id
    and j.kind in ('media.reel.template', 'media.image.process', 'media.cutout')
    and j.status <> 'cancelled'
    and j.created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC');
$$;

-- Igual que la versión de 20261214010000 con el tope mensual por marca.
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

-- ─────────────── 6. Precios de IA sin verificar ───────────────

-- Qué modelos se han usado en el mes y si su precio es de fiar. El cupo solo
-- protege si el precio cargado es el real:
--   verified    imagen o vídeo con precio contrastado en `ai_media_models`
--   unverified  imagen o vídeo cuyo precio figura en el registro SIN verificar
--   unknown     imagen o vídeo que no está en el registro de modelos
--   simulated   proveedor simulado (precios inventados de las pruebas)
--   unconfirmed texto o transcripción con precio en AI_PRICES: el sistema no
--               guarda si se contrastó con la factura
--   no_price    texto o transcripción sin entrada en AI_PRICES
create function public.platform_price_review(p_period_start date)
returns table (
  task public.ai_task, provider text, model text, generations bigint, cost_micros bigint, status text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_prices text;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'Indica el primer día del mes' using errcode = '22023';
  end if;
  select s.plain_value into v_prices from private.integration_settings s where s.setting_key = 'AI_PRICES';
  return query
    select g.task, g.provider, g.model, count(*), coalesce(sum(g.cost_micros), 0)::bigint,
           case
             when g.provider like 'simulated%' or g.provider = 'simulado' then 'simulated'
             when g.task in ('image', 'video') then
               case when m.id is null then 'unknown' when m.price_verified then 'verified' else 'unverified' end
             when v_prices is not null and position('"' || g.provider || '/' || g.model || '"' in v_prices) > 0
               then 'unconfirmed'
             else 'no_price'
           end
    from public.ai_generations g
    left join public.ai_media_models m on m.provider = g.provider and m.model = g.model
    where g.status = 'succeeded' and g.period_start = p_period_start
    group by g.task, g.provider, g.model, m.id, m.price_verified
    order by 5 desc, 2, 3;
end $$;

-- Aviso que levanta el servidor (p. ej. una máquina de Fly encendida demasiadas horas).
create function public.platform_alert_external(p_kind text, p_key text, p_title text, p_detail text, p_data jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('worker_machine_long') then
    raise exception 'Tipo de aviso no admitido' using errcode = '22023';
  end if;
  return private.platform_alert_raise(p_kind, p_key, null, p_title, p_detail, p_data, null);
end $$;

-- ───────────────────────────── Privilegios ─────────────────────────────

revoke all on public.platform_alerts from anon, authenticated, public;
grant select on public.platform_alerts to authenticated;
grant all on public.platform_alerts to service_role;

revoke all on function private.ai_global_cap_micros() from public, anon, authenticated;
revoke all on function private.ai_global_committed(date) from public, anon, authenticated;
revoke all on function private.ai_global_remaining(date) from public, anon, authenticated;
revoke all on function private.job_machine_ms(jsonb) from public, anon, authenticated;
revoke all on function private.media_jobs_monthly_max() from public, anon, authenticated;
revoke all on function private.media_jobs_this_month(uuid) from public, anon, authenticated;
revoke all on function private.platform_alert_raise(text, text, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function private.platform_alerts_scan() from public, anon, authenticated;
revoke all on function private.storage_cleanup_dispatch() from public, anon, authenticated, service_role;

revoke all on function public.ai_reserve_generation(uuid, uuid, public.ai_task, text, text, text, bigint, integer) from public, anon, authenticated;
grant execute on function public.ai_reserve_generation(uuid, uuid, public.ai_task, text, text, text, bigint, integer) to service_role;
revoke all on function public.ai_media_allowance(uuid, uuid, public.ai_task) from public, anon, authenticated;
grant execute on function public.ai_media_allowance(uuid, uuid, public.ai_task) to service_role;

revoke all on function public.platform_ai_global_status() from public, anon, authenticated;
revoke all on function public.platform_usage_overview(date) from public, anon, authenticated;
revoke all on function public.platform_storage_by_brand() from public, anon, authenticated;
revoke all on function public.platform_alerts_refresh() from public, anon, authenticated;
revoke all on function public.platform_price_review(date) from public, anon, authenticated;
revoke all on function public.platform_alert_external(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.request_media_job(uuid, text, jsonb, text) from public, anon;
grant execute on function public.request_media_job(uuid, text, jsonb, text) to authenticated;
revoke all on function public.platform_alert_resolve(uuid) from public, anon, authenticated;
revoke all on function public.storage_cleanup_orphans(interval, integer) from public, anon, authenticated;
grant execute on function public.platform_ai_global_status() to authenticated;
grant execute on function public.platform_usage_overview(date) to authenticated;
grant execute on function public.platform_storage_by_brand() to authenticated;
grant execute on function public.platform_alerts_refresh() to authenticated;
grant execute on function public.platform_price_review(date) to authenticated;
grant execute on function public.platform_alert_external(text, text, text, text, jsonb) to service_role;
grant execute on function public.platform_alert_resolve(uuid) to authenticated;
grant execute on function public.storage_cleanup_orphans(interval, integer) to service_role;

-- ───────────────────────────── Reloj (pg_cron) ─────────────────────────────

-- Los avisos solo necesitan pg_cron; la limpieza, también pg_net. Mismo nombre
-- = se actualiza la tarea, no se duplica.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('rrss-platform-alerts', '*/10 * * * *', 'select private.platform_alerts_scan()');
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then
      create extension if not exists pg_net with schema extensions;
      perform cron.schedule('rrss-storage-cleanup', '23 * * * *', 'select private.storage_cleanup_dispatch()');
    end if;
  else
    raise notice 'pg_cron no está disponible: no se programan los avisos de plataforma ni la limpieza de la cola';
  end if;
end
$do$;
