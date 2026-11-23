-- Vuelta atrás de 20270107010000_media_missing_messages.sql: deja `private.media_job_input`
-- y `public.asset_usage` como estaban (20261118220000 y 20270101010000). No toca datos.

create or replace function private.media_job_input(p_brand_id uuid, p_path jsonb, p_kinds public.asset_kind[], p_label text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_path text;
begin
  if jsonb_typeof(p_path) is distinct from 'string' then
    raise exception '%: falta la ruta del archivo', p_label using errcode = '22023';
  end if;
  v_path := p_path #>> '{}';
  -- Ni segmentos vacíos, ni «.», ni «..», ni barras invertidas.
  if v_path ~ '(^|/)\.{0,2}(/|$)' or position(E'\\' in v_path) > 0 then
    raise exception '%: la ruta «%» no es válida', p_label, v_path using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.media_assets a
    where a.brand_id = p_brand_id and a.storage_path = v_path and a.kind = any (p_kinds)
  ) then
    raise exception '%: «%» no es un recurso de esta marca', p_label, v_path using errcode = '22023';
  end if;
  return v_path;
end $$;

revoke all on function private.media_job_input(uuid, jsonb, public.asset_kind[], text) from public, anon, authenticated;

create or replace function public.asset_usage(p_brand_id uuid)
returns table (
  asset_id uuid,
  content_id uuid,
  title text,
  network text,
  format text,
  status public.content_status,
  archived boolean
)
language sql stable security invoker set search_path = '' as $$
  with docs as (
    -- El texto del documento se calcula una vez por pieza, no una por recurso.
    select c.id, c.title, c.network, c.format, c.status, c.archived_at is not null as archived,
           v.data::text as doc
    from public.content_items c
    join public.content_versions v on v.content_id = c.id and v.version = c.current_version
    where c.brand_id = p_brand_id
  )
  select a.id, d.id, d.title, d.network, d.format, d.status, d.archived
  from public.media_assets a
  join docs d on strpos(d.doc, a.id::text) > 0
  where a.brand_id = p_brand_id
  order by a.id, d.title;
$$;

revoke all on function public.asset_usage(uuid) from public, anon;
grant execute on function public.asset_usage(uuid) to authenticated, service_role;
