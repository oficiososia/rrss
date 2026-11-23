-- Historias de Instagram (solo imagen) en el publicador.
--
--   1. `private.publication_format_supported` admite instagram/story.
--   2. La regla de los recursos trata la historia como una publicación de una
--      imagen: UNA exportación JPEG de esa pieza y esa versión, sin cambios sin
--      guardar, de un documento de UNA página (la historia 9:16 del editor).
--      Un vídeo no vale todavía (las historias de vídeo no se publican solas).
--   3. Se reevalúa lo que ya estaba en el calendario como historia (quedaba en
--      espera con «unsupported_format»): si lo demás cumple, queda programado.
--
-- El publicador (supabase/functions/_shared/social/publisher.ts) crea el
-- contenedor con media_type=STORIES e image_url, sin pie ni texto alternativo,
-- y lo publica con media_publish, igual que una imagen.
-- Antes: una historia se podía preparar y apuntar en el calendario, pero no se publicaba.
-- Ahora: una historia aprobada con su exportación JPEG se programa y se publica como una publicación.

-- ─────────────────────── 1. Formato admitido ───────────────────────

create or replace function private.publication_format_supported(p_network text, p_format text) returns boolean
language sql immutable set search_path = '' as $$
  select p_network = 'instagram' and p_format in ('post', 'carousel', 'reel', 'story');
$$;

-- ─────────────────────── 2. Recursos de una historia ───────────────────────

-- ¿Valen estos recursos para esta pieza, versión y formato? Null si valen; si
-- no, 'no_media' (faltan) o 'invalid_media'.
--   post y story: 1 imagen JPEG, exportación de esa pieza y versión, y el
--         documento de la versión tiene una sola página.
--   carousel: una exportación JPEG por página (de 2 a 10 páginas), de esa pieza
--         y versión, y en el orden de las páginas (el recurso i es la página i).
--   reel: 1 vídeo MP4 o MOV de la marca.
create or replace function private.publication_media_problem(
  p_brand_id uuid, p_content_id uuid, p_version integer, p_format text, p_asset_ids uuid[]
) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_count integer := coalesce(cardinality(p_asset_ids), 0);
  v_pages integer;
  v_found integer;
  v_ok integer;
  v_in_order integer;
begin
  if v_count = 0 then
    return 'no_media';
  end if;
  if p_format = 'reel' then
    select count(*), count(*) filter (where a.kind = 'video' and a.mime_type in ('video/mp4', 'video/quicktime'))
    into v_found, v_ok
    from public.media_assets a
    where a.id = any (p_asset_ids) and a.brand_id = p_brand_id;
    if v_found <> v_count or v_ok <> v_count or v_count <> 1 then
      return 'invalid_media';
    end if;
    return null;
  end if;

  v_pages := coalesce(private.content_version_page_count(p_content_id, p_version), 0);

  select count(*),
         count(*) filter (where
           a.kind = 'image' and a.mime_type = 'image/jpeg'
           and a.provenance ->> 'type' = 'export'
           and a.provenance ->> 'content_id' = p_content_id::text
           and coalesce(a.provenance ->> 'version', '') = coalesce(p_version::text, '-')
           and coalesce(a.provenance ->> 'unsaved_changes', 'false') = 'false'),
         count(*) filter (where
           case when v_pages > 1 then
             a.provenance ->> 'page' = u.ord::text and a.provenance ->> 'page_count' = v_pages::text
           else
             coalesce(a.provenance ->> 'page', '1') = '1' and coalesce(a.provenance ->> 'page_count', '1') = '1'
           end)
  into v_found, v_ok, v_in_order
  from unnest(p_asset_ids) with ordinality u(id, ord)
  join public.media_assets a on a.id = u.id and a.brand_id = p_brand_id;

  if v_found <> v_count or v_ok <> v_count or v_in_order <> v_count then
    return 'invalid_media';
  end if;
  if p_format in ('post', 'story') and (v_count <> 1 or v_pages <> 1) then
    return 'invalid_media';
  end if;
  if p_format = 'carousel' and (v_pages not between 2 and 10 or v_count <> v_pages) then
    return 'invalid_media';
  end if;
  return null;
end $$;

-- ─────────────────────── 3. Lo que ya estaba en el calendario ───────────────────────

do $$
declare
  v_org uuid;
begin
  for v_org in
    select distinct p.organization_id from public.scheduled_publications p
    where p.format = 'story' and p.status in ('planned', 'scheduled')
  loop
    perform private.publication_refresh_org(v_org);
  end loop;
end $$;
