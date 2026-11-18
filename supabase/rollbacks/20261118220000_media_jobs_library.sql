-- Vuelta atrás de 20261118220000_media_jobs_library.sql.
-- Los recursos que ya crearon los trabajos se quedan en la biblioteca (son
-- archivos de la marca), pero pierden su procedencia: las columnas
-- `source_job_id` y `provenance` desaparecen. Los trabajos ya encolados siguen
-- en la cola; al terminar ya no se darán de alta en la biblioteca.
drop trigger if exists jobs_publish_media_assets on public.jobs;
drop function if exists private.jobs_publish_media_assets();
drop function if exists public.request_media_job(uuid, text, jsonb, text);
drop function if exists private.media_jobs_max_active();
drop function if exists private.media_image_payload(uuid, uuid, jsonb, text);
drop function if exists private.media_reel_payload(uuid, uuid, jsonb, text);
drop function if exists private.media_job_input(uuid, jsonb, public.asset_kind[], text);
drop function if exists private.jsonb_only_keys(jsonb, text[]);
drop index if exists public.media_assets_source_job_idx;
alter table public.media_assets drop column if exists provenance, drop column if exists source_job_id;
