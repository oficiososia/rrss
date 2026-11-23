-- Plataforma → Integraciones: la última «Probar conexión» de cada TARJETA.
--
-- La pantalla tiene una tarjeta por servicio, pero dos integraciones las
-- comparten varias tarjetas: «IA de texto» (OpenAI y Claude) e «IA de imagen»
-- (fal.ai y los demás proveedores). `private.integration_tests` guarda una fila
-- por integración, así que la tarjeta de Claude enseñaba la prueba de OpenAI
-- (y la de fal.ai, la de los demás proveedores de imagen).
--
-- Ahora cada tarjeta prueba solo lo suyo
-- (supabase/functions/_shared/integrations/probes.ts, PROBE_SCOPES) y anota su
-- resultado en su propia fila:
--   · `ai_text`         OpenAI (la de siempre)
--   · `ai_text_claude`  Claude (nueva)
--   · `ai_image`        los demás proveedores de imagen (la de siempre)
--   · `ai_image_fal`    fal.ai (nueva)
-- Son filas de pruebas, no integraciones nuevas: los ajustes
-- (`integration_setting_keys`) no cambian.
--
-- La función `platform-integrations` funciona con o sin esta migración: sin
-- ella, la prueba de Claude y la de fal.ai se hacen y se enseñan igual, pero
-- no quedan anotadas (la tarjeta vuelve a «Sin probar» al recargar).
--
-- Vuelta atrás: supabase/rollbacks/20270105010000_pruebas_por_tarjeta.sql

alter table private.integration_tests
  drop constraint integration_tests_integration_check,
  add constraint integration_tests_integration_check
    check (integration in ('meta', 'comfyui', 'ai_text', 'ai_image', 'stripe', 'google_drive', 'r2', 'media_worker',
                           'ai_text_claude', 'ai_image_fal'));

-- Igual que en 20261208010000, admitiendo las filas por tarjeta.
create or replace function public.integration_record_test(p_user_id uuid, p_integration text, p_ok boolean, p_message text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or not exists (select 1 from public.platform_admins pa where pa.user_id = p_user_id) then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  if p_integration is null
     or p_integration not in ('meta', 'comfyui', 'ai_text', 'ai_image', 'stripe', 'google_drive', 'r2', 'media_worker',
                              'ai_text_claude', 'ai_image_fal') then
    raise exception 'Esa integración no existe' using errcode = '22023';
  end if;
  insert into private.integration_tests (integration, ok, message, tested_by, tested_at)
  values (p_integration, coalesce(p_ok, false), left(coalesce(p_message, ''), 500), p_user_id, now())
  on conflict (integration) do update
    set ok = excluded.ok, message = excluded.message, tested_by = excluded.tested_by, tested_at = now();
  insert into private.integration_audit (actor_id, action, integration, data)
  values (p_user_id, 'test', p_integration, jsonb_build_object('ok', coalesce(p_ok, false)));
end $$;
