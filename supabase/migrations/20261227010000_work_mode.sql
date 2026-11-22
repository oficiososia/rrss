-- Cómo trabaja una organización: «Lo llevamos nosotros» (autogestión) o «Nos lo
-- lleva una agencia» (el flujo de encargos de siempre).
--
--   * `organizations.work_mode` ('self' | 'agency'). Las organizaciones nuevas
--     nacen en autogestión; las que ya existían pasan a autogestión salvo las de
--     tipo agencia, que se quedan como estaban. Lo cambian los propietarios y
--     administradores de la organización (la política `organizations_update`
--     ya existente; solo se añade la columna a los privilegios).
--   * En autogestión TODA marca de la organización redacta con IA (`ai_mode =
--     'api'`): así las funciones de IA (texto, imagen, vídeo, «reel como este»)
--     no cambian ni una línea y nadie recibe `agency_mode`. Se impone con un
--     disparador en `brands` (no se puede poner `agency` en una organización en
--     autogestión) y otro en `organizations` (al pasar a autogestión, las marcas
--     en modo agencia vuelven a `api`). Los encargos abiertos no se tocan: quedan
--     guardados y reaparecen si la organización vuelve al modo agencia.
--   * `org_usage_overview(organización, mes)`: lo mismo que «Gasto y uso» de la
--     plataforma pero de UNA organización, para su propietario si está en
--     autogestión (y para los superadministradores). Solo lectura.
--
-- Lo que NO se abre: nada de otras organizaciones, ni las claves y ajustes
-- globales (Integraciones), ni los cupos y planes, ni los avisos de plataforma.
--
-- Vuelta atrás: supabase/rollbacks/20261227010000_work_mode.sql

-- ───────────────────────────── Columna ─────────────────────────────

alter table public.organizations
  add column work_mode text not null default 'self' check (work_mode in ('self', 'agency'));

-- Las que ya eran agencia conservan su flujo; el resto pasa a autogestión (el valor por defecto).
update public.organizations set work_mode = 'agency' where kind = 'agency';

-- Las marcas de organizaciones en autogestión no pueden quedarse en modo agencia.
update public.brands b set ai_mode = 'api'
from public.organizations o
where o.id = b.organization_id and o.work_mode = 'self' and b.ai_mode = 'agency';

grant update (work_mode) on public.organizations to authenticated;

-- ─────────────────────────── Disparadores ───────────────────────────

create function private.brand_ai_mode_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ai_mode = 'agency'
     and exists (select 1 from public.organizations o where o.id = new.organization_id and o.work_mode = 'self') then
    raise exception 'Esta organización lleva las redes por su cuenta: no admite el modo agencia en las marcas'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger brands_ai_mode_guard before insert or update of ai_mode, organization_id on public.brands
  for each row execute function private.brand_ai_mode_guard();

create function private.org_work_mode_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.work_mode = 'self' then
    update public.brands set ai_mode = 'api' where organization_id = new.id and ai_mode = 'agency';
  end if;
  return null;
end $$;

create trigger organizations_work_mode after update of work_mode on public.organizations
  for each row when (new.work_mode is distinct from old.work_mode)
  execute function private.org_work_mode_changed();

revoke all on function private.brand_ai_mode_guard() from public, anon, authenticated;
revoke all on function private.org_work_mode_changed() from public, anon, authenticated;

-- ───────────────────── Organizaciones nuevas ─────────────────────

-- Igual que antes, pero la organización nace en autogestión; una de tipo agencia
-- nace en modo agencia (es lo que quien la crea como agencia espera).
create or replace function public.create_organization(p_name text, p_kind public.org_kind default 'business')
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

  insert into public.organizations (name, kind, work_mode, created_by)
  values (btrim(p_name), p_kind, case when p_kind = 'agency' then 'agency' else 'self' end, v_uid)
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, v_uid, 'owner');

  return v_org;
end $$;

-- ───────────────── Gasto y uso de una organización ─────────────────

-- Las mismas columnas que `platform_usage_overview`, para una sola organización.
-- Quién: superadministradores, o el PROPIETARIO de la organización si trabaja en
-- autogestión (en modo agencia el coste real es de la agencia, no del cliente).
create function public.org_usage_overview(p_organization_id uuid, p_period_start date)
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
  if p_organization_id is null or not (
       private.is_platform_admin()
       or exists (
         select 1
         from public.organization_members om
         join public.organizations o on o.id = om.organization_id
         where om.organization_id = p_organization_id
           and om.user_id = (select auth.uid())
           and om.role = 'owner'
           and o.work_mode = 'self')) then
    raise exception 'Solo el propietario de una organización en autogestión ve su gasto' using errcode = '42501';
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
      where g.status = 'succeeded' and g.period_start = p_period_start and g.organization_id = p_organization_id
      group by 1
    ), ledger as (
      select u.organization_id as org,
             coalesce(sum(u.reserved_delta_micros + u.cost_delta_micros), 0)::bigint as committed,
             coalesce(sum(u.cost_delta_micros), 0)::bigint as spent
      from public.ai_usage u
      where u.period_start = p_period_start and u.organization_id = p_organization_id
      group by 1
    ), media as (
      select j.organization_id as org, count(*) as total,
             count(*) filter (where j.status = 'succeeded') as ok,
             count(*) filter (where j.status = 'failed') as bad,
             count(*) filter (where j.status in ('queued', 'running')) as active,
             coalesce(sum(private.job_machine_ms(j.result)) filter (where j.status = 'succeeded'), 0) / 1000.0 as secs,
             count(*) filter (where j.status = 'succeeded' and private.job_machine_ms(j.result) is null) as untimed
      from public.jobs j
      where private.is_media_worker_kind(j.kind) and j.organization_id = p_organization_id
        and j.created_at >= v_from and j.created_at < v_to
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
    where o.id = p_organization_id;
end $$;

revoke all on function public.org_usage_overview(uuid, date) from public, anon, authenticated;
grant execute on function public.org_usage_overview(uuid, date) to authenticated;
