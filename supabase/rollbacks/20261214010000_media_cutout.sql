-- Vuelta atrás de 20261214010000_media_cutout.sql: vuelve a las funciones de antes.
-- Los trabajos `media.cutout` que quedaran en cola se cancelan; los recursos ya creados
-- (PNG en «Ediciones», procedencia `media_job`) se quedan como están.
update public.jobs set status = 'cancelled', locked_by = null, locked_until = null, finished_at = now()
where kind = 'media.cutout' and status in ('queued', 'running');

create or replace function public.request_media_job(
  p_brand_id uuid,
  p_kind text,
  p_input jsonb,
  p_idempotency_key text
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_key text;
  v_job public.jobs;
  v_input jsonb;
  v_payload jsonb;
  v_active integer;
begin
  if v_user is null then
    raise exception 'Inicia sesión para encargar trabajos' using errcode = '42501';
  end if;
  if p_brand_id is null or p_brand_id not in (select private.brand_ids_with('edit')) then
    raise exception 'No tienes permiso para crear medios en esta marca' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('media.reel.template', 'media.image.process') then
    raise exception 'Tipo de trabajo no admitido: %', coalesce(p_kind, '(vacío)') using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'Falta la clave del encargo (entre 8 y 100 caracteres)' using errcode = '22023';
  end if;

  -- Un encargo a la vez por marca: la cuenta de trabajos activos no se adelanta.
  select b.organization_id into v_org from public.brands b where b.id = p_brand_id for update;
  -- La clave lleva la marca: la misma clave en otra marca de la organización es otro encargo.
  v_key := format('media:%s:%s', p_brand_id, p_idempotency_key);

  select * into v_job from public.jobs j where j.organization_id = v_org and j.idempotency_key = v_key;
  if found then
    if v_job.kind <> p_kind or v_job.brand_id is distinct from p_brand_id then
      raise exception 'Esa clave ya se usó para otro encargo' using errcode = '22023';
    end if;
    return v_job;
  end if;

  select count(*) into v_active from public.jobs j
  where j.brand_id = p_brand_id
    and j.kind in ('media.reel.template', 'media.image.process')
    and j.status in ('queued', 'running');
  if v_active >= private.media_jobs_max_active() then
    raise exception 'Hay % trabajos de medios en marcha en esta marca, el máximo a la vez. Espera a que termine alguno.', v_active
      using errcode = 'P0001';
  end if;

  -- Los nulos de JSON cuentan como «no está» (música opcional, etc.).
  v_input := jsonb_strip_nulls(coalesce(p_input, '{}'::jsonb));
  if p_kind = 'media.reel.template' then
    v_payload := private.media_reel_payload(v_org, p_brand_id, v_input, gen_random_uuid()::text);
  else
    v_payload := private.media_image_payload(v_org, p_brand_id, v_input, gen_random_uuid()::text);
  end if;

  return public.enqueue_job(v_org, p_kind, v_payload, v_key, p_brand_id, 0, 3, null, v_user);
end $$;

create or replace function public.cancel_media_job(p_job_id uuid)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs;
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para cancelar trabajos' using errcode = '42501';
  end if;
  select * into v_job from public.jobs j
  where j.id = p_job_id
    and j.kind in ('media.reel.template', 'media.image.process')
    and j.brand_id is not null
    and j.brand_id in (select private.brand_ids_with('edit'))
  for update;
  if not found then
    raise exception 'No tienes permiso para cancelar este trabajo' using errcode = '42501';
  end if;
  if v_job.status not in ('queued', 'running') then
    raise exception 'Este trabajo ya ha terminado: no se puede cancelar' using errcode = 'P0001';
  end if;
  return public.cancel_job(v_job.id);
end $$;

create or replace function private.jobs_plan_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'media.reel.template' then
    perform private.require_plan_feature(new.organization_id, 'reels');
  end if;
  if new.kind in ('media.reel.template', 'media.image.process', 'source.extract') then
    perform private.check_storage_limit(new.organization_id, 0);
  end if;
  return new;
end $$;

create or replace function private.jobs_publish_media_assets() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_assets jsonb := '[]'::jsonb;
  v_asset uuid;
  v_path text;
  v_out jsonb;
  v_item record;
  v_sources jsonb;
  v_provenance jsonb;
  v_source_name text;
  v_format text;
begin
  if (new.kind = 'media.reel.template' and new.payload #>> '{output,path}' is null)
     or (new.kind = 'media.image.process' and jsonb_typeof(new.payload -> 'outputs') is distinct from 'array') then
    return new;
  end if;

  if new.kind = 'media.reel.template' then
    v_path := new.payload #>> '{output,path}';
    v_out := new.result -> 'output';
    if jsonb_typeof(v_out) is distinct from 'object' or v_out ->> 'path' is distinct from v_path then
      raise exception 'El resultado del reel no corresponde a su encargo' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('type', m.value ->> 'type', 'asset_id', a.id,
                                                 'path', m.value ->> 'path')
                              order by m.ordinality), '[]'::jsonb)
      into v_sources
    from jsonb_array_elements(coalesce(new.payload #> '{plan,clips}', new.payload #> '{plan,media}', '[]'::jsonb))
         with ordinality m
    left join public.media_assets a on a.brand_id = new.brand_id and a.storage_path = m.value ->> 'path';

    v_provenance := private.media_job_provenance(
      jsonb_strip_nulls(jsonb_build_object(
        'type', 'media_job',
        'kind', new.kind,
        'job_id', new.id,
        'template_id', new.payload #>> '{template,id}',
        'template_schema_version', new.result #> '{template,schemaVersion}',
        -- Solo en v2: la procedencia de un reel v1 no cambia.
        'plan_version', new.payload #> '{plan,version}',
        'content_id', new.payload #>> '{content,id}',
        'content_version', new.payload #> '{content,version}',
        'music_asset_id', (select a.id from public.media_assets a
                           where a.brand_id = new.brand_id and a.storage_path = new.payload #>> '{plan,music,path}'),
        'music_license', new.payload #> '{plan,music,license}'
      )),
      v_sources);

    insert into public.media_assets (brand_id, organization_id, kind, origin, storage_path, file_name, mime_type,
                                     bytes, width, height, duration_ms, folder, created_by, provenance)
    values (
      new.brand_id, new.organization_id, 'video', 'generated', v_path,
      format('reel-%s-%s.mp4', new.payload #>> '{template,id}', to_char(now() at time zone 'utc', 'YYYYMMDD-HH24MISS')),
      'video/mp4',
      (v_out ->> 'bytes')::bigint,
      (v_out ->> 'width')::integer,
      (v_out ->> 'height')::integer,
      round((v_out ->> 'durationSeconds')::numeric * 1000)::integer,
      'Reels',
      new.created_by,
      v_provenance
    )
    on conflict (storage_path) do nothing
    returning id into v_asset;
    if v_asset is null then
      select a.id into v_asset from public.media_assets a where a.storage_path = v_path;
    end if;
    v_assets := jsonb_build_array(jsonb_build_object('id', v_asset, 'path', v_path, 'kind', 'video'));

  elsif new.kind = 'media.image.process' then
    v_sources := jsonb_build_array(jsonb_build_object(
      'type', 'photo',
      'asset_id', (select a.id from public.media_assets a
                   where a.brand_id = new.brand_id and a.storage_path = new.payload #>> '{source,path}'),
      'path', new.payload #>> '{source,path}'
    ));
    v_source_name := regexp_replace(
      coalesce((select a.file_name from public.media_assets a
                where a.brand_id = new.brand_id and a.storage_path = new.payload #>> '{source,path}'), 'foto'),
      '\.[^.]*$', '');

    for v_item in select e.value as output from jsonb_array_elements(new.payload -> 'outputs') e loop
      v_path := v_item.output ->> 'path';
      select r.value into v_out from jsonb_array_elements(new.result -> 'outputs') r where r.value ->> 'path' = v_path;
      if v_out is null then
        raise exception 'Al resultado del recorte le falta «%»', v_path using errcode = '22023';
      end if;
      v_format := coalesce(v_item.output ->> 'format', 'jpeg');
      insert into public.media_assets (brand_id, organization_id, kind, origin, storage_path, file_name, mime_type,
                                       bytes, width, height, folder, created_by, provenance)
      values (
        new.brand_id, new.organization_id, 'image', 'generated', v_path,
        left(format('%s-%s.%s', v_source_name, replace(v_item.output ->> 'aspect', ':', 'x'),
                    case v_format when 'jpeg' then 'jpg' else v_format end), 255),
        'image/' || v_format,
        (v_out ->> 'bytes')::bigint,
        (v_out ->> 'width')::integer,
        (v_out ->> 'height')::integer,
        'Recortes',
        new.created_by,
        private.media_job_provenance(
          jsonb_strip_nulls(jsonb_build_object(
            'type', 'media_job',
            'kind', new.kind,
            'job_id', new.id,
            'aspect', v_item.output ->> 'aspect',
            'focal_point', new.payload -> 'focalPoint'
          )),
          v_sources)
      )
      on conflict (storage_path) do nothing
      returning id into v_asset;
      if v_asset is null then
        select a.id into v_asset from public.media_assets a where a.storage_path = v_path;
      end if;
      v_assets := v_assets || jsonb_build_array(jsonb_build_object('id', v_asset, 'path', v_path, 'kind', 'image'));
      v_out := null;
    end loop;
  end if;

  new.result := coalesce(new.result, '{}'::jsonb) || jsonb_build_object('assets', v_assets);
  return new;
end $$;

drop trigger jobs_publish_media_assets on public.jobs;
create trigger jobs_publish_media_assets before update of status on public.jobs
  for each row
  when (new.status = 'succeeded' and old.status is distinct from new.status and new.brand_id is not null
        and new.kind in ('media.reel.template', 'media.image.process'))
  execute function private.jobs_publish_media_assets();

drop function if exists private.media_cutout_payload(uuid, uuid, jsonb, text);
