-- Uso del recorte de fondo en el servidor (`api/cutout-mask.ts`, Vercel).
--
-- Quitar el fondo corre en el navegador (BEN2 con WebGPU, IS-Net sin ella). Si el
-- navegador no puede (poca memoria, móvil, sin WebAssembly, fallo del modelo), la
-- foto va a una función del servidor que ejecuta el mismo IS-Net con onnxruntime-node
-- y devuelve SOLO la máscara. Esta migración da a esa función lo que necesita para no
-- gastar CPU sin control:
--   * `cutout_usage`: una fila por recorte reservado (quién, de qué marca, cuánto tardó).
--   * `cutout_reserve(marca)`: la persona con sesión debe poder EDITAR esa marca, y se
--     comprueban los topes (por persona y día, por marca y mes). Si caben, deja la fila.
--   * `cutout_finish(id, ms, ok)`: anota la duración real.
-- Las dos funciones las llama la función del servidor CON el JWT de la persona, nunca
-- con la clave de servicio.
--
-- Vuelta atrás: supabase/rollbacks/20261213120000_cutout_server_usage.sql

create table public.cutout_usage (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  ok boolean
);

create index cutout_usage_user_day_idx on public.cutout_usage (user_id, created_at);
create index cutout_usage_brand_month_idx on public.cutout_usage (brand_id, created_at);

alter table public.cutout_usage enable row level security;

-- Quien gestiona la marca ve su uso; nadie escribe directamente (solo las funciones).
create policy cutout_usage_select on public.cutout_usage
  for select to authenticated using (brand_id in (select private.brand_ids_with('manage')));

revoke all on public.cutout_usage from anon, authenticated;
grant select on public.cutout_usage to authenticated;
grant all on public.cutout_usage to service_role;

create function public.cutout_reserve(p_brand_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_day_limit constant integer := 60;     -- recortes por persona y día
  c_month_limit constant integer := 600;  -- recortes por marca y mes
  v_user uuid := auth.uid();
  v_org uuid;
  v_day integer;
  v_month integer;
  v_id bigint;
begin
  if v_user is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '42501';
  end if;
  if p_brand_id is null or p_brand_id not in (select private.brand_ids_with('edit')) then
    raise exception 'Sin permiso para editar esta marca' using errcode = '42501';
  end if;
  select b.organization_id into v_org from public.brands b where b.id = p_brand_id;

  select count(*) into v_day from public.cutout_usage
  where user_id = v_user and created_at >= date_trunc('day', now());
  select count(*) into v_month from public.cutout_usage
  where brand_id = p_brand_id and created_at >= date_trunc('month', now());

  if v_day >= c_day_limit then
    return jsonb_build_object('allowed', false, 'reason', 'day', 'used_day', v_day, 'used_month', v_month,
                              'limit_day', c_day_limit, 'limit_month', c_month_limit);
  end if;
  if v_month >= c_month_limit then
    return jsonb_build_object('allowed', false, 'reason', 'month', 'used_day', v_day, 'used_month', v_month,
                              'limit_day', c_day_limit, 'limit_month', c_month_limit);
  end if;

  insert into public.cutout_usage (organization_id, brand_id, user_id)
  values (v_org, p_brand_id, v_user) returning id into v_id;
  return jsonb_build_object('allowed', true, 'id', v_id, 'used_day', v_day + 1, 'used_month', v_month + 1,
                            'limit_day', c_day_limit, 'limit_month', c_month_limit);
end $$;

create function public.cutout_finish(p_id bigint, p_ms integer, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.cutout_usage
  set duration_ms = greatest(coalesce(p_ms, 0), 0), ok = p_ok
  where id = p_id and user_id = auth.uid() and duration_ms is null;
end $$;

revoke all on function public.cutout_reserve(uuid) from public, anon;
revoke all on function public.cutout_finish(bigint, integer, boolean) from public, anon;
grant execute on function public.cutout_reserve(uuid) to authenticated;
grant execute on function public.cutout_finish(bigint, integer, boolean) to authenticated;
