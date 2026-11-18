-- Vuelta atrás de 20261118210000_ai_media_images.sql.
--
-- DESTRUCTIVA en parte: borra la procedencia de las imágenes generadas (las
-- imágenes y sus filas en la biblioteca se quedan, como cualquier otro recurso)
-- y la fila del modelo `comfyui` (si se activó o se le puso precio, exportarla
-- antes). No desinstala pg_cron ni pg_net: puede haber otras tareas que los
-- usen. Los secretos de Vault, si se crearon, se quitan a mano.

-- SQL dinámico: donde no hay pg_cron (pruebas con PGlite) `cron.job` no existe.
do $do$
declare
  v_scheduled boolean;
begin
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = $1)' into v_scheduled using 'rrss-ai-media-poll';
    if v_scheduled then
      execute 'select cron.unschedule($1)' using 'rrss-ai-media-poll';
    end if;
  end if;
end
$do$;

drop function if exists private.ai_media_poll_dispatch();

delete from public.ai_media_models where provider = 'comfyui' and model = 'flux-2-klein-4b';

drop index if exists public.media_assets_ai_generation_idx;
alter table public.media_assets
  drop column if exists provenance,
  drop column if exists ai_generation_id;
