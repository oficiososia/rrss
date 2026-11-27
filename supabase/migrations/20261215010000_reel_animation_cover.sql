-- Editor de reels: ritmo, textos animados, movimientos de cámara y portada.
--
-- Amplía el plan v2 de forma compatible (los montajes guardados siguen siendo
-- válidos; todo lo nuevo es opcional):
--
--  * Texto: `animation` { in, out, seconds? } (entrada y salida del texto).
--  * Foto: `motion` admite también subir y bajar la cámara (lo valida el
--    trabajador) y `motionAmount` fija la intensidad.
--  * Reel: `cover` { type: 'frame', at } | { type: 'photo', path } (portada).
--    Si el plan trae portada, la base de datos pone `output.posterPath` y el
--    trabajador deja ahí un JPEG. Al terminar el trabajo, un disparador nuevo
--    (`jobs_publish_reel_cover`) lo da de alta como imagen en la biblioteca
--    (carpeta «Reels») con su procedencia (`role: 'cover'`, `cover_of_path` =
--    ruta del vídeo, pieza y versión) y lo añade a `jobs.result.poster`
--    (con `asset_id`). `jobs.result.assets` sigue empezando por el vídeo.
--
-- No toca `request_media_job` ni `jobs_publish_media_assets`: el disparador
-- nuevo corre después (orden alfabético) y solo mira reels con portada.
-- La publicación en redes todavía NO envía la portada (docs/editor-reels.md §8).

-- ─────────────────── Plan v2 ───────────────────

create or replace function private.media_reel_plan_v2(p_brand_id uuid, p_plan jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_cue jsonb;
  v_index integer := 0;
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
    if v_item ->> 'type' = 'photo' then
      if not private.jsonb_only_keys(v_item, array['id', 'type', 'path', 'focalPoint', 'blur', 'transition',
                                                   'seconds', 'motion', 'motionAmount']) then
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
      if not private.jsonb_only_keys(v_item, array['id', 'text', 'start', 'end', 'position', 'style', 'animation'])
         or jsonb_typeof(v_item -> 'text') is distinct from 'string' then
        raise exception 'Texto %: campos no admitidos', v_index using errcode = '22023';
      end if;
      if v_item ? 'animation' and not private.jsonb_only_keys(v_item -> 'animation', array['in', 'out', 'seconds']) then
        raise exception 'Texto %: animación no admitida', v_index using errcode = '22023';
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

-- ─────────────────── Carga del reel ───────────────────

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
              || case when jsonb_typeof(v_plan -> 'cover') = 'object'
                      then jsonb_build_object('posterPath', format('%s/%s/reels/%s-cover.jpg', p_org, p_brand_id, p_file))
                      else '{}'::jsonb end
  );
  if v_content is not null then
    v_payload := v_payload || jsonb_build_object('content', v_content);
  end if;
  return v_payload;
end $$;

-- ─────────────────── Portada a la biblioteca ───────────────────

create function private.jobs_publish_reel_cover() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_path text := new.payload #>> '{output,posterPath}';
  v_poster jsonb := new.result -> 'poster';
  v_asset uuid;
begin
  if v_path is null or jsonb_typeof(v_poster) is distinct from 'object' or v_poster ->> 'path' is distinct from v_path then
    return new;
  end if;

  insert into public.media_assets (brand_id, organization_id, kind, origin, storage_path, file_name, mime_type,
                                   bytes, width, height, folder, created_by, provenance)
  values (
    new.brand_id, new.organization_id, 'image', 'generated', v_path,
    format('portada-reel-%s.jpg', to_char(now() at time zone 'utc', 'YYYYMMDD-HH24MISS')),
    'image/jpeg',
    (v_poster ->> 'bytes')::bigint,
    nullif(v_poster ->> 'width', '')::integer,
    nullif(v_poster ->> 'height', '')::integer,
    'Reels',
    new.created_by,
    jsonb_strip_nulls(jsonb_build_object(
      'type', 'media_job',
      'kind', new.kind,
      'job_id', new.id,
      'role', 'cover',
      'cover_source', v_poster ->> 'source',
      'cover_at_seconds', v_poster -> 'atSeconds',
      'cover_of_path', new.payload #>> '{output,path}',
      'content_id', new.payload #>> '{content,id}',
      'content_version', new.payload #> '{content,version}'
    ))
  )
  on conflict (storage_path) do nothing
  returning id into v_asset;
  if v_asset is null then
    select a.id into v_asset from public.media_assets a where a.storage_path = v_path;
  end if;
  new.result := new.result || jsonb_build_object('poster', v_poster || jsonb_build_object('asset_id', v_asset));
  return new;
end $$;

-- «jobs_publish_media_assets» < «jobs_publish_reel_cover»: corre después y ya tiene `result.assets`.
create trigger jobs_publish_reel_cover before update of status on public.jobs
  for each row
  when (new.status = 'succeeded' and old.status is distinct from new.status and new.brand_id is not null
        and new.kind = 'media.reel.template')
  execute function private.jobs_publish_reel_cover();

revoke all on function private.media_reel_plan_v2(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.media_reel_payload(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function private.jobs_publish_reel_cover() from public, anon, authenticated;
