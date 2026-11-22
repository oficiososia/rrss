-- Portada del reel al publicar en Instagram (docs/publicacion.md, «Portada del reel»).
--
-- El montaje de un reel ya guarda su portada como una imagen JPEG de la
-- biblioteca (migración 20261215010000: `provenance.role = 'cover'`, con
-- `cover_of_path` = ruta del vídeo). El publicador la necesita en el momento de
-- crear el contenedor del reel; esta función se la da:
--
--   social_publication_cover(publicación) → {"asset_id", "storage_path"} o null
--
-- Solo para la clave de servicio. Busca, entre las imágenes JPEG de la MISMA
-- marca, la portada más reciente cuyo `cover_of_path` es la ruta del vídeo de la
-- publicación (el primer recurso de la publicación, que en un reel es el vídeo).
-- Sin portada devuelve null y el reel sale con el fotograma que elija
-- Instagram. No cambia nada ni toca la regla de aprobación: es solo lectura.
-- Vuelta atrás: supabase/rollbacks/20261218010000_reel_cover_publish.sql.

create function public.social_publication_cover(p_publication_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('asset_id', c.id, 'storage_path', c.storage_path)
  from public.scheduled_publications p
  join public.media_assets v on v.id = p.media_asset_ids[1] and v.brand_id = p.brand_id
  join public.media_assets c on c.brand_id = p.brand_id
                            and c.kind = 'image'
                            and c.mime_type = 'image/jpeg'
                            and c.provenance ->> 'role' = 'cover'
                            and c.provenance ->> 'cover_of_path' = v.storage_path
  where p.id = p_publication_id
    and p.format = 'reel'
    and v.kind = 'video'
  order by c.created_at desc
  limit 1;
$$;

revoke all on function public.social_publication_cover(uuid) from public, anon, authenticated;
grant execute on function public.social_publication_cover(uuid) to service_role;
