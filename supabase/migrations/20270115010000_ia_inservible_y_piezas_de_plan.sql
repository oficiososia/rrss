-- Dos cambios pequeños de la prueba de calidad del 23/11/2026 (fallos 2 y 15):
--
-- 1. Una respuesta de la IA que no se puede usar NO se cobra a la organización.
--    Hasta ahora `ai_complete_generation` apuntaba su coste aunque el resultado
--    se tirase («La IA ha devuelto una respuesta que no se puede usar», y el
--    consumo subía). `ai_waive_generation` cierra la generación como fallida,
--    devuelve la reserva y deja el coste real del proveedor en
--    `ai_generations.waived_cost_micros`: no cuenta para el cupo de la
--    organización, pero sí para el tope de gasto de la plataforma (que paga ella).
--
-- 2. Las piezas de un plan de campaña admiten cuatro campos OPCIONALES que la IA
--    ya prometía en el texto y no llegaban a la pieza: `title` (nombre corto),
--    `time` (hora propuesta, HH:MM), `aspect` (proporción: 1:1, 4:5, 9:16 o
--    16:9) y `headline` (titular que va en la imagen o en el vídeo). Un plan sin
--    ellos sigue valiendo igual; cualquier otro campo sigue invalidándolo.

-- ───────────────────── 1. Respuestas inservibles sin cobro ─────────────────────

alter table public.ai_generations
  add column waived_cost_micros bigint check (waived_cost_micros is null or waived_cost_micros >= 0);

comment on column public.ai_generations.waived_cost_micros is
  'Coste real del proveedor de una respuesta que no se pudo usar y no se cobró a la organización (ai_waive_generation).';

-- Cierra una generación cuya respuesta llegó pero no se puede usar: devuelve la
-- reserva (como un fallo) y guarda el coste real aparte. Repetir la llamada no
-- apunta dos veces.
create function public.ai_waive_generation(
  p_generation_id uuid,
  p_cost_micros bigint,
  p_usage jsonb default '{}'::jsonb,
  p_output jsonb default null,
  p_latency_ms integer default null,
  p_provider_request_id text default null,
  p_error_code text default 'invalid_output',
  p_error_message text default ''
) returns public.ai_generations
language plpgsql security definer set search_path = '' as $$
declare
  v_gen public.ai_generations;
begin
  if p_cost_micros is null or p_cost_micros < 0 then
    raise exception 'El coste no puede ser negativo' using errcode = '22023';
  end if;

  select * into v_gen from public.ai_generations g where g.id = p_generation_id for update;
  if not found then
    raise exception 'La generación no existe' using errcode = 'P0001';
  end if;
  if v_gen.status = 'failed' then
    return v_gen;
  end if;
  if v_gen.status = 'succeeded' then
    raise exception 'La generación ya se cerró como terminada' using errcode = 'P0001';
  end if;

  if v_gen.status = 'reserved' then
    insert into public.ai_usage (organization_id, brand_id, generation_id, period_start, entry, reserved_delta_micros)
    values (v_gen.organization_id, v_gen.brand_id, v_gen.id, v_gen.period_start, 'release', -v_gen.reserved_micros);
  end if;

  update public.ai_generations g
  set status = 'failed', waived_cost_micros = p_cost_micros, usage = coalesce(p_usage, '{}'::jsonb),
      output = p_output, latency_ms = p_latency_ms, provider_request_id = left(p_provider_request_id, 200),
      error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'invalid_output'), 64),
      error_message = left(coalesce(p_error_message, ''), 500), finished_at = now()
  where g.id = v_gen.id
  returning * into v_gen;

  return v_gen;
end $$;

revoke all on function public.ai_waive_generation(uuid, bigint, jsonb, jsonb, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_waive_generation(uuid, bigint, jsonb, jsonb, integer, text, text, text)
  to service_role;

-- Igual que en 20261219010000, más lo que pagó la plataforma por respuestas que
-- no se cobraron: el tope global protege el gasto real.
create or replace function private.ai_global_committed(p_period date) returns bigint
language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(u.reserved_delta_micros + u.cost_delta_micros)
                    from public.ai_usage u where u.period_start = p_period), 0)
        - coalesce((select sum(g.reserved_micros) from public.ai_generations g
                    where g.period_start = p_period and g.status = 'reserved' and g.reserved_until < now()), 0)
        + coalesce((select sum(g.waived_cost_micros) from public.ai_generations g
                    where g.period_start = p_period and g.waived_cost_micros is not null), 0))::bigint;
$$;

-- ───────────────────── 2. Piezas del plan: campos opcionales ─────────────────────

create or replace function private.campaign_plan_problem(p_plan jsonb, p_campaign public.campaigns)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_key text;
  v_piece jsonb;
  v_reasoning jsonb;
  v_index integer := 0;
  v_date date;
  v_asset jsonb;
  v_tag jsonb;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    return 'El plan no tiene el formato esperado';
  end if;
  if pg_column_size(p_plan) > 262144 then
    return 'El plan es demasiado grande';
  end if;
  for v_key in select jsonb_object_keys(p_plan) loop
    if v_key not in ('objective', 'summary', 'reasoning', 'pieces') then
      return format('El plan trae un campo no previsto: «%s»', left(v_key, 40));
    end if;
  end loop;
  if not private.jsonb_text_ok(p_plan -> 'objective', 1, 600) then
    return 'Falta el objetivo del plan (hasta 600 caracteres)';
  end if;
  if not private.jsonb_text_ok(p_plan -> 'summary', 0, 1500) then
    return 'El resumen del plan no es válido (hasta 1.500 caracteres)';
  end if;

  v_reasoning := p_plan -> 'reasoning';
  if coalesce(jsonb_typeof(v_reasoning), '') <> 'object' then
    return 'Falta el razonamiento del plan';
  end if;
  for v_key in select jsonb_object_keys(v_reasoning) loop
    if v_key not in ('observed', 'dataBacked', 'hypotheses', 'dataNote') then
      return format('El razonamiento trae un campo no previsto: «%s»', left(v_key, 40));
    end if;
  end loop;
  if not (private.jsonb_text_list_ok(v_reasoning -> 'observed', 10, 400)
          and private.jsonb_text_list_ok(v_reasoning -> 'dataBacked', 10, 400)
          and private.jsonb_text_list_ok(v_reasoning -> 'hypotheses', 20, 400)
          and private.jsonb_text_ok(v_reasoning -> 'dataNote', 0, 600)) then
    return 'El razonamiento debe separar lo observado, lo respaldado por datos y las hipótesis (listas de textos breves) y llevar la nota sobre los datos';
  end if;

  if coalesce(jsonb_typeof(p_plan -> 'pieces'), '') <> 'array'
     or jsonb_array_length(p_plan -> 'pieces') not between 1 and 30 then
    return 'El plan debe tener entre 1 y 30 piezas';
  end if;

  for v_piece in select e.v from jsonb_array_elements(p_plan -> 'pieces') e(v) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_piece) <> 'object' then
      return format('La pieza %s no tiene el formato esperado', v_index);
    end if;
    for v_key in select jsonb_object_keys(v_piece) loop
      if v_key not in ('network', 'format', 'date', 'idea', 'caption', 'hashtags', 'assetIds', 'why',
                       'title', 'time', 'aspect', 'headline') then
        return format('La pieza %s trae un campo no previsto: «%s»', v_index, left(v_key, 40));
      end if;
    end loop;
    if coalesce(jsonb_typeof(v_piece -> 'network'), '') <> 'string'
       or not ((v_piece ->> 'network') = any (p_campaign.networks)) then
      return format('La pieza %s va a una red que no es de la campaña', v_index);
    end if;
    if coalesce(jsonb_typeof(v_piece -> 'format'), '') <> 'string'
       or (v_piece ->> 'format') !~ '^[a-z][a-z0-9_]{0,31}$' then
      return format('La pieza %s no tiene un formato válido', v_index);
    end if;
    if coalesce(jsonb_typeof(v_piece -> 'date'), '') <> 'string'
       or (v_piece ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      return format('La pieza %s no tiene una fecha válida', v_index);
    end if;
    begin
      v_date := (v_piece ->> 'date')::date;
    exception when others then
      return format('La pieza %s no tiene una fecha válida', v_index);
    end;
    if v_date < p_campaign.starts_on or v_date > p_campaign.ends_on then
      return format('La pieza %s cae fuera de las fechas de la campaña', v_index);
    end if;
    if not private.jsonb_text_ok(v_piece -> 'idea', 1, 300) then
      return format('La pieza %s necesita una idea (hasta 300 caracteres)', v_index);
    end if;
    if not private.jsonb_text_ok(v_piece -> 'caption', 1, 5000) then
      return format('La pieza %s necesita un texto (hasta 5.000 caracteres)', v_index);
    end if;
    if not private.jsonb_text_ok(v_piece -> 'why', 0, 600) then
      return format('La explicación de la pieza %s no es válida (hasta 600 caracteres)', v_index);
    end if;
    if v_piece ? 'title' and not private.jsonb_text_ok(v_piece -> 'title', 0, 80) then
      return format('El título de la pieza %s no es válido (hasta 80 caracteres)', v_index);
    end if;
    if v_piece ? 'headline' and not private.jsonb_text_ok(v_piece -> 'headline', 0, 120) then
      return format('El titular de la pieza %s no es válido (hasta 120 caracteres)', v_index);
    end if;
    if v_piece ? 'time' and (coalesce(jsonb_typeof(v_piece -> 'time'), '') <> 'string'
                             or (v_piece ->> 'time') !~ '^(|([01][0-9]|2[0-3]):[0-5][0-9])$') then
      return format('La hora de la pieza %s no es válida (HH:MM)', v_index);
    end if;
    if v_piece ? 'aspect' and (coalesce(jsonb_typeof(v_piece -> 'aspect'), '') <> 'string'
                               or (v_piece ->> 'aspect') not in ('', '1:1', '4:5', '9:16', '16:9')) then
      return format('La proporción de la pieza %s no es válida', v_index);
    end if;
    if not private.jsonb_text_list_ok(v_piece -> 'hashtags', 30, 100) then
      return format('Las etiquetas de la pieza %s no son válidas (hasta 30)', v_index);
    end if;
    for v_tag in select e.v from jsonb_array_elements(v_piece -> 'hashtags') e(v) loop
      if (v_tag #>> '{}') = '' or (v_tag #>> '{}') ~ '[[:space:]#]' then
        return format('Las etiquetas de la pieza %s van sin # y sin espacios', v_index);
      end if;
    end loop;
    if not private.jsonb_text_list_ok(v_piece -> 'assetIds', 4, 36) then
      return format('Los recursos de la pieza %s no son válidos (hasta 4)', v_index);
    end if;
    for v_asset in select e.v from jsonb_array_elements(v_piece -> 'assetIds') e(v) loop
      if (v_asset #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not exists (
           select 1 from public.media_assets m
           where m.id = (v_asset #>> '{}')::uuid and m.brand_id = p_campaign.brand_id
         ) then
        return format('La pieza %s sugiere un recurso que no es de esta marca', v_index);
      end if;
    end loop;
  end loop;
  return null;
end $$;

revoke all on function private.campaign_plan_problem(jsonb, public.campaigns) from public, anon, authenticated;
