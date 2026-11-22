-- «Animar esta foto con IA»: vídeo corto a partir de una foto real de la
-- biblioteca, para usar el clip en los reels (docs/ia-medios.md, §15).
--
--   1. Operación nueva del registro de modelos, `animate_photo` (solo vídeo):
--      un modelo de animar fotos nunca se elige para generar vídeo suelto, ni
--      al revés.
--   2. Dos modelos de fal.ai sembrados, INACTIVOS y con el precio SIN VERIFICAR:
--      un superadministrador los contrasta y los activa (un modelo con el
--      precio sin verificar no se puede activar).
--   3. Ajuste FAL_KEY en Plataforma → Integraciones (cifrado en Vault).
--   4. Procedencia `ai_animation`: solo la escribe el servidor, el original
--      tiene que ser una foto de la misma marca y cuenta como contenido
--      generado con IA (marca del Reglamento europeo de IA, art. 50).
--   5. `ai_media_allowance`: ¿puede esta persona animar ahora (permiso, plan y
--      cupo)? La interfaz solo ofrece la acción si lo hay.
-- Vuelta atrás: supabase/rollbacks/20261217010000_animar_foto_ia.sql.

-- ─────────────────────── 1. Operación nueva ───────────────────────

alter table public.ai_media_models drop constraint ai_media_models_operation_check;
alter table public.ai_media_models
  add constraint ai_media_models_operation_check
    check (operation in ('generate', 'remove_background', 'upscale', 'replace_background', 'enhance', 'animate_photo'));

alter table public.ai_media_models drop constraint ai_media_models_edit_is_image;
alter table public.ai_media_models
  add constraint ai_media_models_edit_is_image check (
    operation = 'generate'
    or (operation = 'animate_photo' and task = 'video')
    or (operation <> 'animate_photo' and task = 'image'));

comment on column public.ai_media_models.operation is
  'generate (crear una imagen o un vídeo), una edición de foto (remove_background, upscale, replace_background, enhance) o animate_photo (vídeo a partir de una foto).';

-- ─────────────────────── 2. Modelos de fal.ai ───────────────────────
-- Ficha oficial de cada modelo en fal.ai (llms.txt, consultada el 22/11/2026).
-- Ninguno procesa en la UE de forma garantizada (región 'unknown' = fuera de la UE).

insert into public.ai_media_models
  (provider, model, task, operation, display_name, billing_unit, price_micros, price_details, price_checked_on,
   price_source, price_verified, data_region, trains_on_inputs, delivery, settings, priority, active, notes)
values
  ('fal', 'minimax/h3/image-to-video', 'video', 'animate_photo', 'Animar foto · MiniMax H3 768p (fal.ai)', 'second', 60000, '{}',
   '2026-11-22',
   'https://fal.ai/models/minimax/h3/image-to-video/llms.txt: 0,06 USD por segundo a 768P (480P 0,05; 2K 0,13; 4K 0,16). SIN VERIFICAR por una persona: la página general de precios de fal.ai mostraba otras cifras para modelos H3 parecidos.',
   false, 'unknown', 'unknown', 'async',
   '{"fields": {"image": "image_url", "prompt": "prompt", "duration": "duration"}, "static": {"resolution": "768P", "enable_safety_checker": true}, "min_seconds": 5, "max_seconds": 10}',
   10, false,
   'Principal. Hay que fijar la resolución (768P): por defecto el modelo usa 2K, que cuesta más del doble. La proporción del vídeo es la de la foto (el modelo no tiene parámetro de proporción). Proveedor chino a través de fal.ai (EE. UU.): sin garantía de UE. Adaptador sin probar contra fal.ai real.'),
  ('fal', 'fal-ai/kling-video/v3/standard/image-to-video', 'video', 'animate_photo', 'Animar foto · Kling v3 Standard (fal.ai)', 'second', 84000, '{}',
   '2026-11-22',
   'https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/llms.txt: 0,084 USD por segundo sin audio (0,126 con audio). SIN VERIFICAR por una persona: la página general de precios de fal.ai mostraba 0,14 USD por segundo.',
   false, 'unknown', 'unknown', 'async',
   '{"fields": {"image": "start_image_url", "prompt": "prompt", "duration": "duration"}, "duration_as_string": true, "static": {"generate_audio": false, "enable_safety_checker": true}, "min_seconds": 3, "max_seconds": 10}',
   0, false,
   'Respaldo. Se manda sin audio (con audio cuesta 0,126). La proporción es la de la foto. Kuaishou a través de fal.ai (EE. UU.): sin garantía de UE. Adaptador sin probar contra fal.ai real.');

-- ─────────────────────── 3. Clave de fal.ai ───────────────────────

insert into private.integration_setting_keys (setting_key, integration, is_secret) values
  ('FAL_KEY', 'ai_image', true);

-- ─────────────────────── 4. Procedencia de las animaciones ───────────────────────

-- Solo el servidor puede dar un vídeo por animado con IA, y la foto de la que
-- sale tiene que ser de la misma marca (no es clave foránea a propósito: si la
-- foto se borra, el vídeo conserva de dónde salió). Sin SECURITY DEFINER: la
-- foto se busca con la RLS de quien inserta.
create function private.media_assets_animation_provenance_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_source text := new.provenance ->> 'animated_from';
begin
  if (new.provenance ->> 'type') is distinct from 'ai_animation' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.provenance is not distinct from old.provenance then
    return new;
  end if;
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Solo el servidor puede registrar un vídeo animado con IA' using errcode = '42501';
  end if;
  if v_source is null
     or v_source !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not exists (
       select 1 from public.media_assets a where a.id = v_source::uuid and a.brand_id = new.brand_id
     ) then
    raise exception 'La foto original no existe o no es de esta marca' using errcode = '23503';
  end if;
  return new;
end $$;

revoke all on function private.media_assets_animation_provenance_guard() from public, anon, authenticated;

create trigger media_assets_animation_provenance_guard before insert or update on public.media_assets
  for each row execute function private.media_assets_animation_provenance_guard();

-- Contenido generado con IA: un vídeo animado con IA, o un reel hecho con uno,
-- lleva la marca. Es la función de 20261119411000 con `ai_animation` además de
-- `ai_generation`.
create or replace function private.media_assets_ai_generated(p_brand_id uuid, p_asset_ids uuid[])
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.media_assets a
    where a.brand_id = p_brand_id
      and a.id = any (coalesce(p_asset_ids, '{}'))
      and (
        a.provenance ->> 'type' in ('ai_generation', 'ai_animation')
        or (a.provenance ->> 'type' = 'media_job' and exists (
              select 1
              from jsonb_array_elements(
                     case when jsonb_typeof(a.provenance -> 'sources') = 'array' then a.provenance -> 'sources'
                          when jsonb_typeof(a.provenance -> 'source_asset_ids') = 'array' then a.provenance -> 'source_asset_ids'
                          else '[]'::jsonb end) s
              join public.media_assets src
                on src.brand_id = p_brand_id
               and src.id::text = coalesce(s ->> 'asset_id', case when jsonb_typeof(s) = 'string' then s #>> '{}' end)
              where src.provenance ->> 'type' in ('ai_generation', 'ai_animation')))
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

-- ─────────────────────── 5. ¿Se puede animar ahora? ───────────────────────

-- Solo el servidor (clave de servicio), con el usuario ya autenticado, como
-- `ai_reserve_generation`. No reserva nada: dice si habría permiso, plan y
-- saldo para una generación de ese tipo, y cuánto saldo queda.
create function public.ai_media_allowance(p_user_id uuid, p_brand_id uuid, p_task public.ai_task)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_plan public.plans;
  v_limit bigint;
  v_committed bigint;
  v_period date := private.ai_period_start(now());
  v_feature text := case p_task when 'image' then 'ai_image' when 'video' then 'ai_video' else 'ai_text' end;
begin
  select b.organization_id into v_org from public.brands b where b.id = p_brand_id;
  if v_org is null or p_user_id is null
     or not private.user_has_brand_capability(p_user_id, p_brand_id, 'edit') then
    return jsonb_build_object('allowed', false, 'reason', 'no_permission', 'remaining_micros', 0);
  end if;
  v_plan := private.org_plan(v_org);
  if not (v_feature = any (v_plan.features)) then
    return jsonb_build_object('allowed', false, 'reason', 'plan', 'remaining_micros', 0);
  end if;
  select q.limit_value into v_limit
  from public.usage_quotas q where q.organization_id = v_org and q.metric = 'ai_cost_micros';
  if not found then
    if v_plan.ai_monthly_micros <= 0 then
      return jsonb_build_object('allowed', false, 'reason', 'no_quota', 'remaining_micros', 0);
    end if;
    v_limit := v_plan.ai_monthly_micros;
  end if;
  perform private.ai_release_expired(v_org);
  select coalesce(sum(u.reserved_delta_micros + u.cost_delta_micros), 0) into v_committed
  from public.ai_usage u where u.organization_id = v_org and u.period_start = v_period;
  if v_limit - v_committed <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'quota_exhausted', 'remaining_micros', 0);
  end if;
  return jsonb_build_object('allowed', true, 'reason', null, 'remaining_micros', v_limit - v_committed);
end $$;

revoke all on function public.ai_media_allowance(uuid, uuid, public.ai_task) from public, anon, authenticated;
grant execute on function public.ai_media_allowance(uuid, uuid, public.ai_task) to service_role;
