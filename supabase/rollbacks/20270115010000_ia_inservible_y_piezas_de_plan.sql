-- Vuelta atrás de 20270115010000_ia_inservible_y_piezas_de_plan.sql: devuelve
-- `private.campaign_plan_problem` (20261119510000) y `private.ai_global_committed`
-- (20261219010000) a como estaban, y quita `ai_waive_generation` y la columna
-- `ai_generations.waived_cost_micros` (se pierde el coste apuntado de las respuestas no cobradas).

drop function if exists public.ai_waive_generation(uuid, bigint, jsonb, jsonb, integer, text, text, text);

create or replace function private.ai_global_committed(p_period date) returns bigint
language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(u.reserved_delta_micros + u.cost_delta_micros)
                    from public.ai_usage u where u.period_start = p_period), 0)
        - coalesce((select sum(g.reserved_micros) from public.ai_generations g
                    where g.period_start = p_period and g.status = 'reserved' and g.reserved_until < now()), 0))::bigint;
$$;

alter table public.ai_generations drop column if exists waived_cost_micros;

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
      if v_key not in ('network', 'format', 'date', 'idea', 'caption', 'hashtags', 'assetIds', 'why') then
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
