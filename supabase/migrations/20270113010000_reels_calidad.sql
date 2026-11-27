-- Reels con calidad de profesional (docs/reels-calidad.md).
--
-- Amplía el plan v2 de forma compatible: todo lo nuevo es opcional y los
-- montajes guardados y los encargos anteriores siguen siendo válidos. Ningún
-- campo admite null (`request_media_job` pasa la petición por
-- jsonb_strip_nulls: «sin valor» es campo ausente).
--
--   * Foto: `subjectMaskPath`, la máscara del sujeto (PNG de «Quitar el fondo» de
--     esa foto, de la marca). El trabajador encuadra y mueve la cámara sobre ella.
--   * Texto: `role` (headline, label, price, cta): tamaño mínimo, líneas y
--     animación por defecto de cada papel.
--   * Reel: `outro`, el cierre con la marca (llamada, usuario, dirección,
--     logotipo de la marca y colores, de 1,5 a 3 s), y `grade` (natural, warm,
--     none), la gradación de color de todo el reel.
--
-- Vuelta atrás: supabase/rollbacks/20270113010000_reels_calidad.sql.

create or replace function private.media_reel_plan_v2(p_brand_id uuid, p_plan jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_cue jsonb;
  v_index integer := 0;
  v_filters constant text[] := array['bw', 'sepia', 'vivid', 'warm', 'cool', 'fade', 'drama'];
  v_roles constant text[] := array['headline', 'label', 'price', 'cta'];
  v_outro jsonb;
  v_key text;
begin
  -- Sin `fontPath`: la tipografía por defecto la pone la base de datos (jobs_reel_brand_font).
  if not private.jsonb_only_keys(p_plan, array['version', 'clips', 'texts', 'subtitles', 'music', 'cover', 'outro',
                                                'grade']) then
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
                                                   'seconds', 'motion', 'motionAmount', 'filter',
                                                   'subjectMaskPath']) then
        raise exception 'Pieza %: campos no admitidos', v_index using errcode = '22023';
      end if;
      -- Máscara del sujeto (PNG de «Quitar el fondo»): una imagen de ESTA marca.
      if v_item ? 'subjectMaskPath' then
        perform private.media_job_input(p_brand_id, v_item -> 'subjectMaskPath', array['image']::public.asset_kind[],
                                        format('Máscara de la pieza %s', v_index));
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
                                                   'offset', 'role'])
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
      -- Papel del texto: titular, rótulo, precio o llamada final.
      if v_item ? 'role' and (jsonb_typeof(v_item -> 'role') is distinct from 'string'
                              or not (v_item ->> 'role' = any (v_roles))) then
        raise exception 'Texto %: papel no admitido', v_index using errcode = '22023';
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

  -- Gradación de color de todo el reel.
  if p_plan ? 'grade' and (jsonb_typeof(p_plan -> 'grade') is distinct from 'string'
                           or not (p_plan ->> 'grade' = any (array['natural', 'warm', 'none']))) then
    raise exception 'Gradación de color no admitida' using errcode = '22023';
  end if;

  -- Cierre con la marca: llamada, usuario, dirección, logotipo de la marca y colores.
  if p_plan ? 'outro' then
    v_outro := p_plan -> 'outro';
    if jsonb_typeof(v_outro) is distinct from 'object'
       or not private.jsonb_only_keys(v_outro, array['seconds', 'cta', 'handle', 'address', 'logoPath', 'background',
                                                     'accent', 'accentText']) then
      raise exception 'Cierre: campos no admitidos' using errcode = '22023';
    end if;
    if jsonb_typeof(v_outro -> 'cta') is distinct from 'string' or char_length(v_outro ->> 'cta') not between 1 and 60 then
      raise exception 'Cierre: la llamada lleva de 1 a 60 caracteres' using errcode = '22023';
    end if;
    if v_outro ? 'seconds' and (jsonb_typeof(v_outro -> 'seconds') is distinct from 'number'
                                or (v_outro ->> 'seconds')::numeric not between 1.5 and 3) then
      raise exception 'Cierre: dura de 1,5 a 3 s' using errcode = '22023';
    end if;
    if v_outro ? 'handle' and (jsonb_typeof(v_outro -> 'handle') is distinct from 'string'
                               or char_length(v_outro ->> 'handle') not between 1 and 60) then
      raise exception 'Cierre: el usuario lleva de 1 a 60 caracteres' using errcode = '22023';
    end if;
    if v_outro ? 'address' and (jsonb_typeof(v_outro -> 'address') is distinct from 'string'
                                or char_length(v_outro ->> 'address') not between 1 and 120) then
      raise exception 'Cierre: la dirección lleva de 1 a 120 caracteres' using errcode = '22023';
    end if;
    foreach v_key in array array['background', 'accent', 'accentText'] loop
      if v_outro ? v_key and (jsonb_typeof(v_outro -> v_key) is distinct from 'string'
                              or (v_outro ->> v_key) !~ '^#[0-9a-fA-F]{6}$') then
        raise exception 'Cierre: color no válido' using errcode = '22023';
      end if;
    end loop;
    if v_outro ? 'logoPath' then
      perform private.media_job_input(p_brand_id, v_outro -> 'logoPath', array['image', 'logo']::public.asset_kind[],
                                      'Logotipo del cierre');
    end if;
  end if;

  return p_plan;
end $$;
