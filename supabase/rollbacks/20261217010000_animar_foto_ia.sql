-- Vuelta atrás de 20261217010000_animar_foto_ia.sql.
--
-- DESTRUCTIVA en parte: borra los modelos de animar fotos del registro (si se
-- activó alguno o se le cambió el precio, exportarlos antes) y el ajuste
-- FAL_KEY guardado en Plataforma → Integraciones (con su secreto de Vault).
-- Los vídeos animados que sigan en la biblioteca conservan su procedencia
-- `ai_animation`; solo desaparece la guarda.

drop function if exists public.ai_media_allowance(uuid, uuid, public.ai_task);

drop trigger if exists media_assets_animation_provenance_guard on public.media_assets;
drop function if exists private.media_assets_animation_provenance_guard();

-- La función de 20261119411000, sin `ai_animation`.
create or replace function private.media_assets_ai_generated(p_brand_id uuid, p_asset_ids uuid[])
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.media_assets a
    where a.brand_id = p_brand_id
      and a.id = any (coalesce(p_asset_ids, '{}'))
      and (
        a.provenance ->> 'type' = 'ai_generation'
        or (a.provenance ->> 'type' = 'media_job' and exists (
              select 1
              from jsonb_array_elements(
                     case when jsonb_typeof(a.provenance -> 'sources') = 'array' then a.provenance -> 'sources'
                          when jsonb_typeof(a.provenance -> 'source_asset_ids') = 'array' then a.provenance -> 'source_asset_ids'
                          else '[]'::jsonb end) s
              join public.media_assets src
                on src.brand_id = p_brand_id
               and src.id::text = coalesce(s ->> 'asset_id', case when jsonb_typeof(s) = 'string' then s #>> '{}' end)
              where src.provenance ->> 'type' = 'ai_generation'))
        or (a.provenance ->> 'type' = 'export' and (
              exists (
                select 1 from public.content_versions v
                where v.brand_id = p_brand_id
                  and v.content_id::text = a.provenance ->> 'content_id'
                  and v.version::text = a.provenance ->> 'version'
                  and v.ai_generated)
              or (a.provenance ->> 'version' is null and exists (
                select 1 from public.content_items c
                where c.brand_id = p_brand_id and c.id::text = a.provenance ->> 'content_id' and c.ai_generated))))
      )
  );
$$;

do $$
begin
  if to_regclass('vault.secrets') is not null then
    delete from vault.secrets vs
    where vs.id in (
      select s.vault_secret_id from private.integration_settings s
      where s.vault_secret_id is not null and s.setting_key = 'FAL_KEY'
    );
  end if;
end $$;
delete from private.integration_setting_keys where setting_key = 'FAL_KEY';

delete from public.ai_media_models where operation = 'animate_photo';

alter table public.ai_media_models drop constraint if exists ai_media_models_edit_is_image;
alter table public.ai_media_models
  add constraint ai_media_models_edit_is_image check (operation = 'generate' or task = 'image');
alter table public.ai_media_models drop constraint if exists ai_media_models_operation_check;
alter table public.ai_media_models
  add constraint ai_media_models_operation_check
    check (operation in ('generate', 'remove_background', 'upscale', 'replace_background', 'enhance'));
comment on column public.ai_media_models.operation is
  'generate (crear una imagen o un vídeo) o una edición de foto: remove_background, upscale, replace_background, enhance.';
