-- Vuelta atrás de 20270113010000_reels_calidad.sql.
--
-- Devuelve la validación del plan v2 a la de 20261228010000 (sin `subjectMaskPath`,
-- `role`, `outro` ni `grade`). Los montajes guardados con esos campos siguen en las
-- piezas, sin poder encargarse hasta volver a aplicar la migración.

create or replace function private.media_reel_plan_v2(p_brand_id uuid, p_plan jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_cue jsonb;
  v_index integer := 0;
  v_filters constant text[] := array['bw', 'sepia', 'vivid', 'warm', 'cool', 'fade', 'drama'];
begin
  -- Sin `fontPath`: la tipografía por defecto la pone la base de datos (jobs_reel_brand_font).
  if not private.jsonb_only_keys(p_plan, array['version', 'clips', 'texts', 'subtitles', 'music', 'cover']) then
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
    -- Filtro de color: uno de los de la lista (los mismos nombres que los filtros rápidos de las fotos).
    if v_item ? 'filter' and (jsonb_typeof(v_item -> 'filter') is distinct from 'string'
                              or not (v_item ->> 'filter' = any (v_filters))) then
      raise exception 'Pieza %: filtro de color no admitido', v_index using errcode = '22023';
    end if;
    if v_item ->> 'type' = 'photo' then
      if not private.jsonb_only_keys(v_item, array['id', 'type', 'path', 'focalPoint', 'blur', 'transition',
                                                   'seconds', 'motion', 'motionAmount', 'filter']) then
        raise exception 'Pieza %: campos no admitidos', v_index using errcode = '22023';
      end if;
      perform private.media_job_input(p_brand_id, v_item -> 'path', array['image', 'logo']::public.asset_kind[],
                                      format('Pieza %s', v_index));
    elsif v_item ->> 'type' = 'video' then
      if not private.jsonb_only_keys(v_item, array['id', 'type', 'path', 'focalPoint', 'blur', 'transition',
                                                   'in', 'out', 'volume', 'subtitles', 'speed', 'filter']) then
        raise exception 'Pieza %: campos no admitidos', v_index using errcode = '22023';
      end if;
      -- Velocidad del clip: de la mitad al doble.
      if v_item ? 'speed' and (jsonb_typeof(v_item -> 'speed') is distinct from 'number'
                               or (v_item ->> 'speed')::numeric not between 0.5 and 2) then
        raise exception 'Pieza %: la velocidad va de 0,5 a 2', v_index using errcode = '22023';
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
      if not private.jsonb_only_keys(v_item, array['id', 'text', 'start', 'end', 'position', 'style', 'animation',
                                                   'offset'])
         or jsonb_typeof(v_item -> 'text') is distinct from 'string' then
        raise exception 'Texto %: campos no admitidos', v_index using errcode = '22023';
      end if;
      if v_item ? 'animation' and not private.jsonb_only_keys(v_item -> 'animation', array['in', 'out', 'seconds']) then
        raise exception 'Texto %: animación no admitida', v_index using errcode = '22023';
      end if;
      -- Colocado a mano: desplazamiento desde su sitio, como fracción del lienzo.
      if v_item ? 'offset' and (
           not private.jsonb_only_keys(v_item -> 'offset', array['x', 'y'])
           or jsonb_typeof(v_item #> '{offset,x}') is distinct from 'number'
           or jsonb_typeof(v_item #> '{offset,y}') is distinct from 'number'
           or (v_item #>> '{offset,x}')::numeric not between -0.5 and 0.5
           or (v_item #>> '{offset,y}')::numeric not between -0.5 and 0.5) then
        raise exception 'Texto %: posición no admitida', v_index using errcode = '22023';
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

  -- Portada: un fotograma (segundo del reel) o una imagen de la biblioteca de la marca.
  if p_plan ? 'cover' then
    if p_plan #>> '{cover,type}' = 'frame' then
      if not private.jsonb_only_keys(p_plan -> 'cover', array['type', 'at'])
         or jsonb_typeof(p_plan #> '{cover,at}') is distinct from 'number'
         or (p_plan #>> '{cover,at}')::numeric not between 0 and 90 then
        raise exception 'Portada: el fotograma tiene que estar entre 0 y 90 s' using errcode = '22023';
      end if;
    elsif p_plan #>> '{cover,type}' = 'photo' then
      if not private.jsonb_only_keys(p_plan -> 'cover', array['type', 'path']) then
        raise exception 'Portada: campos no admitidos' using errcode = '22023';
      end if;
      perform private.media_job_input(p_brand_id, p_plan #> '{cover,path}', array['image', 'logo']::public.asset_kind[],
                                      'Portada');
    else
      raise exception 'Portada: elige un fotograma o una foto' using errcode = '22023';
    end if;
  end if;

  return p_plan;
end $$;
