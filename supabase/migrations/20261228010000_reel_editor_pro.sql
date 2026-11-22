-- Editor de reels «como los de móvil» (docs/editor-reels.md §10).
--
-- 1. Amplía el plan v2 de forma compatible (todo lo nuevo es opcional; los
--    montajes guardados y los encargos anteriores siguen siendo válidos):
--      * Clip: `speed` (0,5 a 2). El tramo dura (out − in) / speed.
--      * Clip y foto: `filter` (bw, sepia, vivid, warm, cool, fade, drama).
--      * Texto: `offset` { x, y } (−0,5 a 0,5): colocado a mano en la vista previa.
--    Dividir un clip, sustituirlo, duplicarlo o silenciarlo no necesitan campos
--    nuevos. Ningún campo admite null: `request_media_job` pasa la petición por
--    jsonb_strip_nulls, así que «sin valor» es campo ausente.
--
-- 2. Borrador automático del editor: `reel_drafts`, UNA fila por pieza de
--    formato reel con el montaje a medio hacer. El editor la escribe solo
--    (cada pocos segundos, con `save_reel_draft`) para que nada se pierda si se
--    sale sin «Guardar versión». No es una versión: no entra en el historial,
--    no se puede montar ni aprobar. Al guardar una versión, el borrador se
--    borra (disparador). Lo ve y lo escribe quien edita la marca.
--
-- Vuelta atrás: supabase/rollbacks/20261228010000_reel_editor_pro.sql.

-- ─────────────────── Plan v2 ───────────────────

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

-- ─────────────────── Borrador automático ───────────────────

create table public.reel_drafts (
  content_id uuid primary key references public.content_items (id) on delete cascade,
  brand_id uuid not null,
  organization_id uuid not null,
  -- El proyecto de reel tal cual estaba en el editor (puede estar incompleto).
  data jsonb not null check (
    jsonb_typeof(data) = 'object'
    and data ->> 'kind' = 'reel'
    and jsonb_typeof(data -> 'plan') = 'object'
    and pg_column_size(data) <= 262144
  ),
  -- Versión de la pieza sobre la que se trabajaba (0 = todavía sin versiones).
  base_version integer not null check (base_version >= 0),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade
);
create index reel_drafts_brand_idx on public.reel_drafts (brand_id);

alter table public.reel_drafts enable row level security;

-- Lo ve quien edita la marca (es trabajo a medias, no contenido para revisar). Sin políticas de escritura.
create policy reel_drafts_select on public.reel_drafts for select to authenticated
  using (brand_id in (select private.brand_ids_with('edit')));

-- Guarda (o sustituye) el borrador de una pieza de formato reel. Quien edita la marca.
create function public.save_reel_draft(p_content_id uuid, p_data jsonb, p_base_version integer)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.content_items;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  select * into v_item from public.content_items c where c.id = p_content_id;
  if not found or not private.user_has_brand_capability(v_uid, v_item.brand_id, 'edit') then
    raise exception 'Solo quien edita la marca puede guardar el borrador de un reel' using errcode = '42501';
  end if;
  if v_item.format <> 'reel' then
    raise exception 'Solo las piezas de formato reel tienen borrador de montaje' using errcode = '22023';
  end if;
  if v_item.archived_at is not null then
    raise exception 'El contenido está archivado' using errcode = '22023';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or p_data ->> 'kind' is distinct from 'reel'
     or jsonb_typeof(p_data -> 'plan') is distinct from 'object' then
    raise exception 'El borrador no es un montaje de reel' using errcode = '22023';
  end if;
  if pg_column_size(p_data) > 262144 then
    raise exception 'El borrador del reel es demasiado grande' using errcode = '22023';
  end if;
  if p_base_version is null or p_base_version < 0 then
    raise exception 'Indica sobre qué versión se trabaja' using errcode = '22023';
  end if;
  insert into public.reel_drafts (content_id, brand_id, organization_id, data, base_version, updated_by, updated_at)
  values (p_content_id, v_item.brand_id, v_item.organization_id, p_data, p_base_version, v_uid, now())
  on conflict (content_id) do update
    set data = excluded.data, base_version = excluded.base_version, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
  returning updated_at into v_at;
  return v_at;
end $$;

-- Descarta el borrador de una pieza. Quien edita la marca. Si no había, no hace nada.
create function public.discard_reel_draft(p_content_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_brand uuid;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  select c.brand_id into v_brand from public.content_items c where c.id = p_content_id;
  if not found or not private.user_has_brand_capability(v_uid, v_brand, 'edit') then
    raise exception 'Solo quien edita la marca puede descartar el borrador de un reel' using errcode = '42501';
  end if;
  delete from public.reel_drafts d where d.content_id = p_content_id;
end $$;

-- Una versión guardada deja sin sentido el borrador anterior: se borra.
create function private.reel_drafts_clear_on_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.reel_drafts d where d.content_id = new.content_id;
  return new;
end $$;

create trigger content_versions_clear_reel_draft after insert on public.content_versions
  for each row execute function private.reel_drafts_clear_on_version();

-- ───────────────────────────── Privilegios ─────────────────────────────

revoke all on public.reel_drafts from public, anon, authenticated;
grant select on public.reel_drafts to authenticated, service_role;

revoke all on function public.save_reel_draft(uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.discard_reel_draft(uuid) from public, anon, authenticated;
revoke all on function private.reel_drafts_clear_on_version() from public, anon, authenticated;
grant execute on function public.save_reel_draft(uuid, jsonb, integer) to authenticated;
grant execute on function public.discard_reel_draft(uuid) to authenticated;
