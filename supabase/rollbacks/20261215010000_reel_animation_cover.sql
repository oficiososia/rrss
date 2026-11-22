-- Vuelta atrás de 20261215010000_reel_animation_cover.sql.
--
-- Quita el disparador de la portada y devuelve la validación del plan y la
-- carga del reel a las de 20261207010000 (sin `animation`, `motionAmount` ni
-- `cover`). No borra nada: las portadas ya guardadas se quedan en la
-- biblioteca y los montajes guardados con animación o portada siguen en las
-- piezas (sin poder encargarse hasta volver a aplicar la migración).

drop trigger if exists jobs_publish_reel_cover on public.jobs;
drop function if exists private.jobs_publish_reel_cover();

create or replace function private.media_reel_plan_v2(p_brand_id uuid, p_plan jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_cue jsonb;
  v_index integer := 0;
begin
  -- Sin `fontPath`: la tipografía por defecto la pone la base de datos (jobs_reel_brand_font).
  if not private.jsonb_only_keys(p_plan, array['version', 'clips', 'texts', 'subtitles', 'music']) then
    raise exception 'El plan del reel solo admite clips, textos, subtítulos y música' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plan -> 'clips') is distinct from 'array'
     or jsonb_array_length(p_plan -> 'clips') not between 1 and 30 then
    raise exception 'Elige entre 1 y 30 fotos o clips' using errcode = '22023';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_plan -> 'clips') e loop
    v_index := v_index + 1;
    if v_item ? 'blur' and (jsonb_typeof(v_item -> 'blur') is distinct from 'number'
                            or (v_item ->> 'blur')::numeric not between 0 and 100) then
      raise exception 'Pieza %: el desenfoque va de 0 a 100', v_index using errcode = '22023';
    end if;
    if v_item ->> 'type' = 'photo' then
      if not private.jsonb_only_keys(v_item, array['id', 'type', 'path', 'focalPoint', 'blur', 'transition',
                                                   'seconds', 'motion']) then
        raise exception 'Pieza %: campos no admitidos', v_index using errcode = '22023';
      end if;
      perform private.media_job_input(p_brand_id, v_item -> 'path', array['image', 'logo']::public.asset_kind[],
                                      format('Pieza %s', v_index));
    elsif v_item ->> 'type' = 'video' then
      if not private.jsonb_only_keys(v_item, array['id', 'type', 'path', 'focalPoint', 'blur', 'transition',
                                                   'in', 'out', 'volume', 'subtitles']) then
        raise exception 'Pieza %: campos no admitidos', v_index using errcode = '22023';
      end if;
      perform private.media_job_input(p_brand_id, v_item -> 'path', array['video']::public.asset_kind[],
                                      format('Pieza %s', v_index));
      if v_item ? 'subtitles' then
        if jsonb_typeof(v_item -> 'subtitles') is distinct from 'array'
           or jsonb_array_length(v_item -> 'subtitles') > 200 then
          raise exception 'Pieza %: como mucho 200 subtítulos', v_index using errcode = '22023';
        end if;
        for v_cue in select c.value from jsonb_array_elements(v_item -> 'subtitles') c loop
          if not private.jsonb_only_keys(v_cue, array['start', 'end', 'text'])
             or jsonb_typeof(v_cue -> 'text') is distinct from 'string'
             or char_length(v_cue ->> 'text') not between 1 and 200 then
            raise exception 'Pieza %: subtítulo no válido', v_index using errcode = '22023';
          end if;
        end loop;
      end if;
    else
      raise exception 'Pieza %: solo se admiten fotos y clips', v_index using errcode = '22023';
    end if;
  end loop;

  if p_plan ? 'texts' then
    if jsonb_typeof(p_plan -> 'texts') is distinct from 'array' or jsonb_array_length(p_plan -> 'texts') > 30 then
      raise exception 'Como mucho 30 textos' using errcode = '22023';
    end if;
    v_index := 0;
    for v_item in select e.value from jsonb_array_elements(p_plan -> 'texts') e loop
      v_index := v_index + 1;
      if not private.jsonb_only_keys(v_item, array['id', 'text', 'start', 'end', 'position', 'style'])
         or jsonb_typeof(v_item -> 'text') is distinct from 'string' then
        raise exception 'Texto %: campos no admitidos', v_index using errcode = '22023';
      end if;
      perform private.media_reel_text_style(p_brand_id, v_item -> 'style', format('Texto %s', v_index));
    end loop;
  end if;

  if p_plan ? 'subtitles' then
    if not private.jsonb_only_keys(p_plan -> 'subtitles', array['enabled', 'position', 'style']) then
      raise exception 'Subtítulos: campos no admitidos' using errcode = '22023';
    end if;
    perform private.media_reel_text_style(p_brand_id, p_plan #> '{subtitles,style}', 'Subtítulos');
  end if;

  if p_plan ? 'music' then
    if not private.jsonb_only_keys(p_plan -> 'music', array['path', 'startAt', 'volume', 'fadeInSeconds',
                                                            'fadeOutSeconds', 'license']) then
      raise exception 'Música: campos no admitidos' using errcode = '22023';
    end if;
    -- La licencia es responsabilidad de la marca: sin confirmarla no se monta.
    if (p_plan #> '{music,license,confirmed}') is distinct from 'true'::jsonb then
      raise exception 'Confirma que la marca tiene licencia para usar la música' using errcode = '22023';
    end if;
    perform private.media_job_input(p_brand_id, p_plan #> '{music,path}', array['audio']::public.asset_kind[], 'Música');
  end if;

  return p_plan;
end $$;

create or replace function private.media_reel_payload(p_org uuid, p_brand_id uuid, p_input jsonb, p_file text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_template jsonb := p_input -> 'template';
  v_plan jsonb := p_input -> 'plan';
  v_content jsonb := p_input -> 'content';
  v_item jsonb;
  v_index integer := 0;
  v_payload jsonb;
begin
  if not private.jsonb_only_keys(p_input, array['template', 'plan', 'content']) then
    raise exception 'El encargo del reel solo admite la plantilla, el plan y la pieza' using errcode = '22023';
  end if;
  if not private.jsonb_only_keys(v_template, array['id'])
     or jsonb_typeof(v_template -> 'id') is distinct from 'string'
     or (v_template ->> 'id') !~ '^[a-z][a-z0-9-]{1,40}$' then
    raise exception 'Elige una de las plantillas disponibles' using errcode = '22023';
  end if;

  -- La pieza: un reel vivo de ESTA marca, con esa versión guardada.
  if v_content is not null then
    if not private.jsonb_only_keys(v_content, array['id', 'version'])
       or jsonb_typeof(v_content -> 'id') is distinct from 'string'
       or (v_content ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_content -> 'version') is distinct from 'number'
       or not exists (
         select 1
         from public.content_items c
         join public.content_versions v on v.content_id = c.id and v.version = (v_content ->> 'version')::numeric
         where c.id = (v_content ->> 'id')::uuid and c.brand_id = p_brand_id and c.format = 'reel'
           and c.archived_at is null
       ) then
      raise exception 'La pieza del montaje no es un reel de esta marca con esa versión' using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(v_plan) = 'object' and v_plan -> 'version' = '2'::jsonb then
    v_plan := private.media_reel_plan_v2(p_brand_id, v_plan);
  else
    if not private.jsonb_only_keys(v_plan, array['media', 'texts', 'music']) then
      raise exception 'El plan del reel solo admite fotos y clips, textos y música' using errcode = '22023';
    end if;

    if jsonb_typeof(v_plan -> 'media') is distinct from 'array'
       or jsonb_array_length(v_plan -> 'media') not between 1 and 20 then
      raise exception 'Elige entre 1 y 20 fotos o clips' using errcode = '22023';
    end if;
    for v_item in select e.value from jsonb_array_elements(v_plan -> 'media') e loop
      v_index := v_index + 1;
      if not private.jsonb_only_keys(v_item, array['type', 'path', 'focalPoint', 'startAt', 'seconds', 'blur']) then
        raise exception 'Pieza %: campos no admitidos', v_index using errcode = '22023';
      end if;
      if v_item ? 'blur' and (jsonb_typeof(v_item -> 'blur') is distinct from 'number'
                              or (v_item ->> 'blur')::numeric not between 0 and 100) then
        raise exception 'Pieza %: el desenfoque va de 0 a 100', v_index using errcode = '22023';
      end if;
      if v_item ->> 'type' = 'photo' then
        perform private.media_job_input(p_brand_id, v_item -> 'path', array['image', 'logo']::public.asset_kind[],
                                        format('Pieza %s', v_index));
      elsif v_item ->> 'type' = 'video' then
        perform private.media_job_input(p_brand_id, v_item -> 'path', array['video']::public.asset_kind[],
                                        format('Pieza %s', v_index));
      else
        raise exception 'Pieza %: solo se admiten fotos y clips', v_index using errcode = '22023';
      end if;
    end loop;

    if v_plan ? 'texts' then
      if jsonb_typeof(v_plan -> 'texts') is distinct from 'array' or jsonb_array_length(v_plan -> 'texts') > 20 then
        raise exception 'Como mucho 20 textos' using errcode = '22023';
      end if;
      v_index := 0;
      for v_item in select e.value from jsonb_array_elements(v_plan -> 'texts') e loop
        v_index := v_index + 1;
        if not private.jsonb_only_keys(v_item, array['text', 'start', 'end', 'position'])
           or jsonb_typeof(v_item -> 'text') is distinct from 'string' then
          raise exception 'Texto %: campos no admitidos', v_index using errcode = '22023';
        end if;
      end loop;
    end if;

    if v_plan ? 'music' then
      if not private.jsonb_only_keys(v_plan -> 'music', array['path', 'startAt', 'volume']) then
        raise exception 'Música: campos no admitidos' using errcode = '22023';
      end if;
      perform private.media_job_input(p_brand_id, v_plan #> '{music,path}', array['audio']::public.asset_kind[], 'Música');
    end if;
  end if;

  v_payload := jsonb_build_object(
    'template', v_template,
    'plan', v_plan,
    'output', jsonb_build_object('path', format('%s/%s/reels/%s.mp4', p_org, p_brand_id, p_file))
  );
  if v_content is not null then
    v_payload := v_payload || jsonb_build_object('content', v_content);
  end if;
  return v_payload;
end $$;

revoke all on function private.media_reel_plan_v2(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.media_reel_payload(uuid, uuid, jsonb, text) from public, anon, authenticated;
