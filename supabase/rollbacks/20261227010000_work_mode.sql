-- Vuelta atrás de 20261227010000_work_mode.sql: quita el modo de trabajo de la
-- organización y su gasto. Las marcas conservan el `ai_mode` que tengan (las de
-- organizaciones que estaban en autogestión se quedan en `api`, que es lo que
-- ya tenían). Se pierde qué organizaciones eran de «agencia» por elección y no
-- por tipo; el tipo (`kind`) no se toca.

drop function if exists public.org_usage_overview(uuid, date);

-- Vuelve la versión anterior de create_organization (sin work_mode).
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

  insert into public.organizations (name, kind, created_by)
  values (btrim(p_name), p_kind, v_uid)
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, v_uid, 'owner');

  return v_org;
end $$;

drop trigger if exists organizations_work_mode on public.organizations;
drop trigger if exists brands_ai_mode_guard on public.brands;
drop function if exists private.org_work_mode_changed();
drop function if exists private.brand_ai_mode_guard();

revoke update (work_mode) on public.organizations from authenticated;
alter table public.organizations drop column if exists work_mode;
