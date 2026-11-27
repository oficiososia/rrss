-- Vuelta atrás de 20270119010000_instagram_stories.sql.
-- Las historias dejan de publicarse solas: la regla de formatos y la de los
-- recursos vuelven a las de 20261119030000 y 20261203010000. Lo que estaba en
-- el calendario como historia se reevalúa y queda en espera con
-- «unsupported_format» (no se borra nada; lo ya publicado no cambia).

create or replace function private.publication_format_supported(p_network text, p_format text) returns boolean
language sql immutable set search_path = '' as $$
  select p_network = 'instagram' and p_format in ('post', 'carousel', 'reel');
$$;

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
  if p_format = 'post' and (v_count <> 1 or v_pages <> 1) then
    return 'invalid_media';
  end if;
  if p_format = 'carousel' and (v_pages not between 2 and 10 or v_count <> v_pages) then
    return 'invalid_media';
  end if;
  return null;
end $$;

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
