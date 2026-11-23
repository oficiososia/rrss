-- Fotos y vídeos borrados de la biblioteca que un reel o una pieza siguen usando.
--
-- 1. `private.media_job_input` ya no enseña la ruta interna del archivo en sus
--    mensajes, y distingue dos casos que antes decían lo mismo (y mentían en el
--    primero):
--      * La ruta es de la carpeta de ESTA marca pero ya no hay recurso con ella
--        (se borró de la biblioteca): «La foto 1 ya no está en la biblioteca».
--      * La ruta es de otra marca (o no sigue el formato): el mensaje genérico de
--        siempre, «Pieza 1: el archivo no es un recurso de esta marca», sin ruta.
--    Qué es «de esta marca» se decide por la ruta (`<organización>/<marca>/…`), no
--    por si existe en otra: así el mensaje no deja averiguar si un archivo ajeno
--    existe. Mismo `errcode` (22023) en todos los casos.
--
-- 2. `public.asset_usage` encuentra también los reels: su documento guarda la RUTA
--    del archivo, no siempre su id (los archivos que genera el servidor no llevan
--    el id en la ruta). Busca el id o la ruta, en la versión vigente de cada pieza
--    y en el borrador automático de los reels (`reel_drafts`, que solo ve quien
--    edita la marca: la RLS lo decide, la función sigue siendo SECURITY INVOKER).
--
-- Vuelta atrás: supabase/rollbacks/20270107010000_media_missing_messages.sql.

create or replace function private.media_job_input(p_brand_id uuid, p_path jsonb, p_kinds public.asset_kind[], p_label text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_path text;
  v_number text;
  v_own boolean;
begin
  if jsonb_typeof(p_path) is distinct from 'string' then
    raise exception '%: falta la ruta del archivo', p_label using errcode = '22023';
  end if;
  v_path := p_path #>> '{}';
  -- Ni segmentos vacíos, ni «.», ni «..», ni barras invertidas.
  if v_path ~ '(^|/)\.{0,2}(/|$)' or position(E'\\' in v_path) > 0 then
    raise exception '%: la ruta del archivo no es válida', p_label using errcode = '22023';
  end if;
  if exists (
    select 1 from public.media_assets a
    where a.brand_id = p_brand_id and a.storage_path = v_path and a.kind = any (p_kinds)
  ) then
    return v_path;
  end if;

  -- ¿Está en la carpeta de esta marca? (`<organización>/<marca>/…`; las rutas antiguas, `<marca>/…`.)
  v_own := split_part(v_path, '/', 1) = p_brand_id::text
           or (split_part(v_path, '/', 2) = p_brand_id::text and split_part(v_path, '/', 3) <> '');
  if v_own and not exists (
    select 1 from public.media_assets a where a.brand_id = p_brand_id and a.storage_path = v_path
  ) then
    v_number := substring(p_label from '^Pieza ([0-9]+)$');
    if v_number is not null then
      if 'video' = any (p_kinds) then
        raise exception 'El vídeo % ya no está en la biblioteca', v_number using errcode = '22023';
      end if;
      raise exception 'La foto % ya no está en la biblioteca', v_number using errcode = '22023';
    elsif p_label = 'Música' then
      raise exception 'La música ya no está en la biblioteca' using errcode = '22023';
    elsif p_label = 'Portada' then
      raise exception 'La foto de la portada ya no está en la biblioteca' using errcode = '22023';
    end if;
    raise exception '%: el archivo ya no está en la biblioteca', p_label using errcode = '22023';
  end if;

  raise exception '%: el archivo no es un recurso de esta marca', p_label using errcode = '22023';
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
    -- La versión vigente de cada pieza y, si es un reel con borrador, también el borrador.
    -- El texto se calcula una vez por documento, no una por recurso.
    select c.id, c.title, c.network, c.format, c.status, c.archived_at is not null as archived,
           v.data::text as doc
    from public.content_items c
    join public.content_versions v on v.content_id = c.id and v.version = c.current_version
    where c.brand_id = p_brand_id
    union all
    select c.id, c.title, c.network, c.format, c.status, c.archived_at is not null, d.data::text
    from public.content_items c
    join public.reel_drafts d on d.content_id = c.id
    where c.brand_id = p_brand_id
  )
  -- Una fila por archivo y pieza aunque salga en la versión y en el borrador.
  select u.asset_id, u.content_id, u.title, u.network, u.format, u.status, u.archived
  from (
    select distinct on (a.id, d.id)
           a.id as asset_id, d.id as content_id, d.title, d.network, d.format, d.status, d.archived
    from public.media_assets a
    join docs d on strpos(d.doc, a.id::text) > 0 or strpos(d.doc, '"' || a.storage_path || '"') > 0
    where a.brand_id = p_brand_id
    order by a.id, d.id
  ) u
  order by u.asset_id, u.title;
$$;

revoke all on function public.asset_usage(uuid) from public, anon;
grant execute on function public.asset_usage(uuid) to authenticated, service_role;
