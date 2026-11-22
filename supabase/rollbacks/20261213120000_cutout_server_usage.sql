-- Vuelta atrás de 20261213120000_cutout_server_usage.sql.
-- Borra el registro de uso del recorte en el servidor (se pierde el histórico).
-- Sin él, `api/cutout-mask.ts` responde 503 y el navegador sigue recortando solo.

drop function if exists public.cutout_finish(bigint, integer, boolean);
drop function if exists public.cutout_reserve(uuid);
drop table if exists public.cutout_usage;
