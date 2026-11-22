-- Plataforma → Integraciones, versión sencilla (f33):
--
--   1. AI_PRICE_SNAPSHOT: la última lectura de precios de modelos (OpenAI y
--      Claude) que hizo la función `platform-integrations` desde una fuente
--      pública (LiteLLM, que cita la página oficial de cada proveedor). No es
--      un secreto y la escribe el servidor con la sesión del superadministrador;
--      sirve de caché (12 h) y de último valor bueno si la fuente falla.
--   2. platform_cost_per_operation(mes): lo que de verdad ha costado cada tipo de
--      operación de IA este mes (coste liquidado en `ai_generations`, el mismo
--      que cuenta el cupo): cuántas operaciones, cuánto sumaron y, en
--      transcripción, cuántos segundos de audio. Solo superadministradores.
--
-- No cambia ninguna tabla. Vuelta atrás: supabase/rollbacks/20261222010000_precios_y_coste_real.sql

insert into private.integration_setting_keys (setting_key, integration, is_secret) values
  ('AI_PRICE_SNAPSHOT', 'ai_text', false);

create function public.platform_cost_per_operation(p_period_start date)
returns table (
  task public.ai_task, purpose text, provider text, model text,
  operations bigint, cost_micros bigint, audio_seconds numeric
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_platform_admin() then
    raise exception 'Solo para superadministradores' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'Indica el primer día del mes' using errcode = '22023';
  end if;
  return query
    select g.task, g.purpose, g.provider, g.model, count(*)::bigint,
           coalesce(sum(g.cost_micros), 0)::bigint,
           coalesce(sum(case when g.usage ->> 'audio_seconds' ~ '^[0-9]+(\.[0-9]+)?$'
                             then (g.usage ->> 'audio_seconds')::numeric end), 0)
    from public.ai_generations g
    where g.status = 'succeeded' and g.period_start = p_period_start
      and g.provider not like 'simulated%' and g.provider <> 'simulado'
    group by g.task, g.purpose, g.provider, g.model
    order by 6 desc, 2, 3, 4;
end $$;

revoke all on function public.platform_cost_per_operation(date) from public, anon, authenticated;
grant execute on function public.platform_cost_per_operation(date) to authenticated;
