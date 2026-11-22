-- Biblioteca: en qué piezas se usa cada archivo.
--
-- La ficha de un archivo dice en qué piezas está y la lista puede filtrar «sin
-- usar en ninguna pieza». El documento de una pieza guarda el id del recurso
-- dentro de su JSON (capas de imagen y de logotipo), así que se busca ahí, en
-- la versión VIGENTE de cada pieza (la que se ve y se publica), igual que hace
-- la limpieza de provisionales (20261119112000).
--
-- SECURITY INVOKER a propósito (como asset_facets): la RLS de media_assets, de
-- content_items y de content_versions decide qué ve quien pregunta; una marca
-- ajena devuelve cero filas. No hay tabla nueva ni escritura.

create function public.asset_usage(p_brand_id uuid)
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
