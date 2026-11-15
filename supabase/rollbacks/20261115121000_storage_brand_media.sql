-- Vuelta atrás de 20261115121000_storage_brand_media.sql.
-- No borra el cubo ni sus archivos: eso se hace a mano y solo tras confirmar
-- que no queda nada que conservar.
drop policy if exists brand_media_select on storage.objects;
drop policy if exists brand_media_insert on storage.objects;
drop policy if exists brand_media_update on storage.objects;
drop policy if exists brand_media_delete on storage.objects;
drop function if exists private.storage_brand_id(text);
