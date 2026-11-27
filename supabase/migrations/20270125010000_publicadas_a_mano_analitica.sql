-- Lo publicado a mano («Terminar en Instagram», 20270121010000) se mide y sale en Resultados
-- (docs/editor-reels.md §12; rama f67).
--
-- Hasta ahora el capturador de métricas solo medía lo que la plataforma publicó por la API
-- (`scheduled_publications`), así que un reel terminado a mano no tenía cifras ni salía en
-- Resultados ni en el informe mensual. Aquí:
--
--   * `private.manual_publication_media(cuenta)`: los reels publicados a mano que se
--     reconocen en una cuenta, con su identificador de Instagram. Se reconocen por la
--     publicación emparejada (`imported_media_id`) o, si se marcó «Ya lo publiqué» con el
--     enlace, por el código del enlace (`/reel/<código>/`) entre las publicaciones leídas de
--     la cuenta (`social_imported_media`: «Buscar en Instagram» o «Importar publicaciones»).
--     Sin enlace, o con un enlace que aún no se ha leído de la cuenta, no hay nada que medir.
--     Pendiente NO es publicado: solo cuentan las de estado `published`.
--   * `media_metrics_daily.manual_publication_id`: de qué entrega a mano es la cifra (la
--     columna `publication_id`, que apunta a `scheduled_publications`, queda vacía).
--   * `analytics_capture_begin` y `analytics_record_capture` también miden esos reels.
--   * `analytics_media_summary` (con la columna nueva `manual`) y el informe mensual
--     (`analytics_report_source`) los enseñan con el título de su pieza y su enlace.
--
-- Vuelta atrás: supabase/rollbacks/20270125010000_publicadas_a_mano_analitica.sql.

alter table public.media_metrics_daily
  add column manual_publication_id uuid references public.manual_publications (id) on delete set null;
create index media_metrics_daily_manual_idx on public.media_metrics_daily (manual_publication_id);

-- Código de una publicación en su enlace de Instagram (/p/, /reel/, /reels/ o /tv/); null si no lo lleva.
create function private.instagram_shortcode(p_url text)
returns text
language sql immutable set search_path = '' as $$
  select substring(p_url from '^https://(?:www\.)?instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:p|reels?|tv)/([A-Za-z0-9_-]+)');
$$;

-- Reels publicados a mano que se reconocen en una cuenta: entrega, identificador en Instagram y fecha.
create function private.manual_publication_media(p_account_id uuid)
returns table (manual_publication_id uuid, external_id text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select distinct on (m.id) m.id, s.external_id, coalesce(s.published_at, m.published_at)
  from public.manual_publications m
  join public.social_imported_media s
    on s.social_account_id = p_account_id and s.brand_id = m.brand_id
   and ((m.imported_media_id is not null and s.id = m.imported_media_id)
        or (m.imported_media_id is null and m.external_url is not null
            and private.instagram_shortcode(s.permalink) = private.instagram_shortcode(m.external_url)))
  where m.status = 'published'
    -- Lo que ya publicó la plataforma no se mide dos veces.
    and not exists (select 1 from public.scheduled_publications p
                    where p.brand_id = m.brand_id and p.external_id = s.external_id)
  order by m.id, s.published_at desc nulls last;
$$;

create or replace function public.analytics_capture_begin(p_account_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_account public.social_accounts;
begin
  select * into v_account from public.social_accounts a where a.id = p_account_id;
  if not found then
    return jsonb_build_object('outcome', 'skip', 'reason', 'gone');
  end if;
  if v_account.status <> 'active' then
    return jsonb_build_object('outcome', 'skip', 'reason', v_account.status);
  end if;
  if v_account.network <> 'instagram' then
    return jsonb_build_object('outcome', 'skip', 'reason', 'unsupported_network');
  end if;
  return jsonb_build_object(
    'outcome', 'ready',
    'account', jsonb_build_object('id', v_account.id, 'brand_id', v_account.brand_id,
                                  'organization_id', v_account.organization_id, 'network', v_account.network,
                                  'external_id', v_account.external_id, 'token_expires_at', v_account.token_expires_at),
    'last_metric_date', (select max(m.metric_date) from public.account_metrics_daily m
                         where m.social_account_id = v_account.id
                           and m.metric_id <> 'instagram.account.followers'),
    -- Las publicadas por la plataforma y, desde 20270125010000, los reels publicados a mano
    -- («Terminar en Instagram») que se reconocen en esta cuenta.
    'media', coalesce((
      select jsonb_agg(x.item order by x.published_at desc)
      from (
        select jsonb_build_object('publication_id', p.id, 'external_id', p.external_id, 'format', p.format,
                                  'published_at', p.published_at) as item, p.published_at
        from public.scheduled_publications p
        where p.social_account_id = v_account.id and p.status = 'published'
          and p.published_at > now() - interval '60 days'
        union all
        select jsonb_build_object('publication_id', null, 'manual_publication_id', m.manual_publication_id,
                                  'external_id', m.external_id, 'format', 'reel', 'published_at', m.published_at),
               m.published_at
        from private.manual_publication_media(v_account.id) m
        where m.published_at > now() - interval '60 days'
      ) x
    ), '[]'::jsonb),
    'metrics', (
      select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'scope', d.scope, 'api_name', d.api_name,
                                                   'api_source', d.api_source, 'media_types', d.media_types)
                                order by d.sort), '[]'::jsonb)
      from public.analytics_metric_definitions d
      where d.network = v_account.network and d.status = 'captured'
    )
  );
end $$;

create or replace function public.analytics_record_capture(
  p_account_id uuid,
  p_job_id uuid,
  p_status text,
  p_started_at timestamptz,
  p_window_from date,
  p_window_to date,
  p_account_rows jsonb,
  p_media_rows jsonb,
  p_unavailable jsonb default '[]'::jsonb,
  p_api_calls integer default 0,
  p_error_code text default null,
  p_error_message text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.social_accounts;
  v_row jsonb;
  v_def public.analytics_metric_definitions;
  v_pub public.scheduled_publications;
  v_manual uuid;
  v_media_published timestamptz;
  v_date date;
  v_value numeric;
  v_today date := (now() at time zone 'UTC')::date;
  v_account_rows integer := 0;
  v_media_rows integer := 0;
  v_run uuid;
begin
  if p_status is null or p_status not in ('succeeded', 'partial', 'failed', 'skipped') then
    raise exception 'Estado de captura no válido' using errcode = '22023';
  end if;
  select * into v_account from public.social_accounts a where a.id = p_account_id;
  if not found then
    raise exception 'La cuenta no existe' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_account_rows, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_media_rows, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_unavailable, '[]'::jsonb)) <> 'array' then
    raise exception 'Las cifras llegan como listas' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_account_rows, '[]'::jsonb)) > 5000
     or jsonb_array_length(coalesce(p_media_rows, '[]'::jsonb)) > 5000 then
    raise exception 'Demasiadas cifras en una pasada' using errcode = '22023';
  end if;

  for v_row in select e.value from jsonb_array_elements(coalesce(p_account_rows, '[]'::jsonb)) e loop
    select * into v_def from public.analytics_metric_definitions d
    where d.id = v_row ->> 'metric_id' and d.scope = 'account' and d.status = 'captured'
      and d.network = v_account.network;
    if not found then
      raise exception 'Métrica de cuenta no admitida: %', coalesce(v_row ->> 'metric_id', '(vacía)') using errcode = '22023';
    end if;
    v_date := (v_row ->> 'date')::date;
    v_value := (v_row ->> 'value')::numeric;
    if v_date is null or v_date > v_today or v_date < v_today - 730 then
      raise exception 'Fecha fuera de rango: %', v_row ->> 'date' using errcode = '22023';
    end if;
    if v_value is null or v_value < 0 then
      raise exception 'Cifra no válida en %', v_def.id using errcode = '22023';
    end if;
    insert into public.account_metrics_daily (social_account_id, brand_id, organization_id, metric_id, metric_date, value,
                                              provisional)
    values (v_account.id, v_account.brand_id, v_account.organization_id, v_def.id, v_date, v_value,
            private.analytics_is_provisional(v_def.aggregation, v_def.delay_hours, v_date, null, now()))
    on conflict (social_account_id, metric_id, metric_date) do update
      set value = excluded.value, captured_at = now(),
          capture_count = public.account_metrics_daily.capture_count + 1,
          provisional = excluded.provisional;
    v_account_rows := v_account_rows + 1;
  end loop;

  for v_row in select e.value from jsonb_array_elements(coalesce(p_media_rows, '[]'::jsonb)) e loop
    select * into v_def from public.analytics_metric_definitions d
    where d.id = v_row ->> 'metric_id' and d.scope = 'media' and d.status = 'captured'
      and d.network = v_account.network;
    if not found then
      raise exception 'Métrica de publicación no admitida: %', coalesce(v_row ->> 'metric_id', '(vacía)')
        using errcode = '22023';
    end if;
    v_manual := null;
    select * into v_pub from public.scheduled_publications p
    where p.social_account_id = v_account.id and p.status = 'published' and p.external_id = v_row ->> 'external_id';
    if not found then
      -- Un reel publicado a mano en esta cuenta («Terminar en Instagram»): se mide igual, sin publicación
      -- de la plataforma.
      select m.manual_publication_id, m.published_at into v_manual, v_media_published
      from private.manual_publication_media(v_account.id) m
      where m.external_id = v_row ->> 'external_id'
      limit 1;
      if v_manual is null then
        raise exception 'La publicación % no es de esta cuenta o no la hizo la plataforma', v_row ->> 'external_id'
          using errcode = '22023';
      end if;
      v_pub := null;
      v_pub.format := 'reel';
      v_pub.external_id := v_row ->> 'external_id';
      v_pub.published_at := v_media_published;
    end if;
    if not (case when v_pub.format = 'reel' then 'REELS' else 'FEED' end) = any (v_def.media_types) then
      raise exception 'La métrica % no se aplica a esta publicación', v_def.id using errcode = '22023';
    end if;
    v_date := (v_row ->> 'date')::date;
    v_value := (v_row ->> 'value')::numeric;
    if v_date is null or v_date > v_today or v_date < v_today - 730 then
      raise exception 'Fecha fuera de rango: %', v_row ->> 'date' using errcode = '22023';
    end if;
    if v_value is null or v_value < 0 then
      raise exception 'Cifra no válida en %', v_def.id using errcode = '22023';
    end if;
    insert into public.media_metrics_daily (social_account_id, brand_id, organization_id, publication_id,
                                            manual_publication_id, external_media_id, media_product_type,
                                            published_at, metric_id, metric_date, value, provisional)
    values (v_account.id, v_account.brand_id, v_account.organization_id, v_pub.id, v_manual, v_pub.external_id,
            case when v_pub.format = 'reel' then 'REELS' else 'FEED' end, v_pub.published_at, v_def.id, v_date,
            v_value,
            private.analytics_is_provisional(v_def.aggregation, v_def.delay_hours, v_date, v_pub.published_at, now()))
    on conflict (social_account_id, external_media_id, metric_id, metric_date) do update
      set value = excluded.value, captured_at = now(),
          capture_count = public.media_metrics_daily.capture_count + 1,
          provisional = excluded.provisional, publication_id = excluded.publication_id,
          manual_publication_id = excluded.manual_publication_id;
    v_media_rows := v_media_rows + 1;
  end loop;

  insert into public.analytics_capture_runs (social_account_id, brand_id, organization_id, job_id, status, window_from,
                                             window_to, api_calls, account_rows, media_rows, unavailable, error_code,
                                             error_message, started_at, finished_at)
  values (v_account.id, v_account.brand_id, v_account.organization_id, p_job_id, p_status, p_window_from, p_window_to,
          greatest(coalesce(p_api_calls, 0), 0), v_account_rows, v_media_rows,
          coalesce((select jsonb_agg(jsonb_build_object('metric_id', left(u.value ->> 'metric_id', 120),
                                                        'reason', left(u.value ->> 'reason', 60),
                                                        'message', left(u.value ->> 'message', 300)))
                    from (select e.value from jsonb_array_elements(coalesce(p_unavailable, '[]'::jsonb)) e limit 100) u),
                   '[]'::jsonb),
          left(p_error_code, 100), left(p_error_message, 1000), coalesce(p_started_at, now()), now())
  returning id into v_run;

  return jsonb_build_object('run_id', v_run, 'account_rows', v_account_rows, 'media_rows', v_media_rows);
end $$;

drop function public.analytics_media_summary(uuid, timestamptz, timestamptz);
create function public.analytics_media_summary(p_brand_id uuid, p_from timestamptz, p_to timestamptz)
returns table (
  publication_id uuid,
  content_id uuid,
  title text,
  format text,
  network text,
  media_product_type text,
  external_media_id text,
  external_url text,
  published_at timestamptz,
  last_captured_at timestamptz,
  provisional boolean,
  metrics jsonb,
  manual boolean
)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select distinct on (m.external_media_id, m.metric_id)
      m.external_media_id, m.metric_id, m.value, m.captured_at, m.provisional, m.publication_id,
      m.manual_publication_id, m.media_product_type, m.published_at
    from public.media_metrics_daily m
    where m.brand_id = p_brand_id and m.published_at >= p_from and m.published_at < p_to
    order by m.external_media_id, m.metric_id, m.metric_date desc
  )
  -- `publication_id`: la publicación de la plataforma o, si se publicó a mano, la de `manual_publications`.
  select coalesce(l.publication_id, l.manual_publication_id), coalesce(p.content_id, mp.content_id),
         coalesce(c.title, '(pieza borrada)'), coalesce(p.format, case when mp.id is not null then 'reel' end, ''),
         coalesce(p.network, 'instagram'), l.media_product_type, l.external_media_id,
         coalesce(p.external_url, mp.external_url),
         min(l.published_at), max(l.captured_at), bool_or(l.provisional),
         jsonb_object_agg(l.metric_id, l.value), mp.id is not null
  from latest l
  left join public.scheduled_publications p on p.id = l.publication_id
  left join public.manual_publications mp on mp.id = l.manual_publication_id
  left join public.content_items c on c.id = coalesce(p.content_id, mp.content_id)
  group by l.publication_id, l.manual_publication_id, p.content_id, mp.content_id, c.title, p.format, mp.id,
           p.network, l.media_product_type, l.external_media_id, p.external_url, mp.external_url
  order by min(l.published_at) desc;
$$;

create or replace function public.analytics_report_source(p_report_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_report public.analytics_reports;
  v_from date;
  v_to date;
  v_prev date;
  v_profile jsonb;
  v_logo jsonb;
begin
  select * into v_report from public.analytics_reports r where r.id = p_report_id;
  if not found then
    raise exception 'El informe no existe' using errcode = 'P0001';
  end if;
  v_from := v_report.period_start;
  v_to := (v_from + interval '1 month')::date;
  v_prev := (v_from - interval '1 month')::date;
  select p.data into v_profile from public.brand_profiles p where p.brand_id = v_report.brand_id and p.status = 'active';
  select jsonb_build_object('path', a.storage_path, 'mime_type', a.mime_type) into v_logo
  from jsonb_array_elements_text(coalesce(v_profile #> '{visual,logoAssetIds}', '[]'::jsonb)) with ordinality l(id, ord)
  join public.media_assets a on a.id::text = l.id and a.brand_id = v_report.brand_id
  where a.mime_type in ('image/png', 'image/jpeg')
  order by l.ord limit 1;

  return jsonb_build_object(
    'report', jsonb_build_object('id', v_report.id, 'revision', v_report.revision, 'status', v_report.status,
                                 'source', v_report.source),
    'brand', (select jsonb_build_object('id', b.id, 'name', b.name, 'timezone', b.timezone) from public.brands b
              where b.id = v_report.brand_id),
    'period', jsonb_build_object('start', v_from, 'end', v_to, 'previous_start', v_prev),
    'visual', jsonb_build_object('colors', coalesce(v_profile #> '{visual,colors}', '[]'::jsonb), 'logo', v_logo),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'network', a.network, 'username', a.username,
                                                             'status', a.status) order by a.created_at)
                          from public.social_accounts a where a.brand_id = v_report.brand_id), '[]'::jsonb),
    'definitions', (select jsonb_agg(to_jsonb(d) order by d.sort) from public.analytics_metric_definitions d),
    'account_metrics', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', m.social_account_id, 'metric_id', m.metric_id,
                                          'date', m.metric_date, 'value', m.value, 'provisional', m.provisional)
                       order by m.metric_date, m.metric_id)
      from public.account_metrics_daily m
      where m.brand_id = v_report.brand_id and m.metric_date >= v_prev and m.metric_date < v_to), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(x order by x ->> 'published_at') from (
        select jsonb_build_object(
                 'publication_id', coalesce(l.publication_id, l.manual_publication_id),
                 'external_media_id', l.external_media_id,
                 'title', coalesce(c.title, '(pieza borrada)'),
                 'format', coalesce(p.format, case when mp.id is not null then 'reel' end, ''),
                 'network', coalesce(p.network, 'instagram'), 'media_product_type', l.media_product_type,
                 'published_at', min(l.published_at), 'external_url', coalesce(p.external_url, mp.external_url),
                 'provisional', bool_or(l.provisional), 'metrics', jsonb_object_agg(l.metric_id, l.value),
                 'manual', mp.id is not null) as x
        from (
          select distinct on (m.external_media_id, m.metric_id) m.*
          from public.media_metrics_daily m
          where m.brand_id = v_report.brand_id and m.published_at >= v_prev and m.published_at < v_to
            -- La cifra a fin de mes (o la última anterior), no la de hoy.
            and m.metric_date < (v_to + 3)
          order by m.external_media_id, m.metric_id, m.metric_date desc
        ) l
        left join public.scheduled_publications p on p.id = l.publication_id
        left join public.manual_publications mp on mp.id = l.manual_publication_id
        left join public.content_items c on c.id = coalesce(p.content_id, mp.content_id)
        group by l.publication_id, l.manual_publication_id, l.external_media_id, c.title, p.format, mp.id, p.network,
                 l.media_product_type, p.external_url, mp.external_url
      ) s), '[]'::jsonb),
    'unavailable', coalesce((
      select jsonb_agg(jsonb_build_object('metric_id', u.metric_id, 'reason', u.reason, 'message', u.message,
                                          'times', u.times))
      from (
        select e.value ->> 'metric_id' as metric_id, e.value ->> 'reason' as reason,
               max(e.value ->> 'message') as message, count(*) as times
        from public.analytics_capture_runs r
        cross join jsonb_array_elements(r.unavailable) e
        where r.brand_id = v_report.brand_id and r.started_at >= v_from and r.started_at < v_to + 3
        group by 1, 2
      ) u), '[]'::jsonb),
    'capture_errors', coalesce((
      select jsonb_agg(jsonb_build_object('error_code', r.error_code, 'message', r.error_message, 'times', r.times))
      from (select r.error_code, max(r.error_message) as error_message, count(*) as times
            from public.analytics_capture_runs r
            where r.brand_id = v_report.brand_id and r.started_at >= v_from and r.started_at < v_to + 3
              and r.error_code is not null
            group by r.error_code) r), '[]'::jsonb)
  );
end $$;

revoke all on function private.instagram_shortcode(text) from public, anon, authenticated;
revoke all on function private.manual_publication_media(uuid) from public, anon, authenticated;
revoke all on function public.analytics_media_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_media_summary(uuid, timestamptz, timestamptz) to authenticated;
