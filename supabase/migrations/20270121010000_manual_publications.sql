-- «Terminar en Instagram (para poner música)» desde el editor de reels (docs/editor-reels.md §12).
--
-- La API de Instagram no crea borradores ni añade canciones de su biblioteca, así
-- que un reel se puede terminar a mano: el vídeo montado y su pie van al móvil,
-- allí se abre Instagram, se pone la música y se publica. Esta tabla recuerda
-- que una pieza se entregó así y si ya salió.
--
--   * `manual_publications`: una fila por pieza entregada para publicar a mano.
--     Estados: pending («Pendiente de publicar en Instagram») → published, o
--     cancelled. Pendiente NO es publicado: solo pasa a «published» cuando la
--     persona dice «Ya lo publiqué» (con el enlace si lo tiene) o cuando la app
--     encuentra la publicación entre las que lee de la cuenta conectada
--     (`social_imported_media`, la misma tabla de «Importar publicaciones»).
--   * No es `scheduled_publications`: ahí «published» exige el identificador que
--     devuelve la red al publicar por la API, y aquí la red no publica nada. Por
--     eso son tablas distintas y la regla dura de aquella no cambia.
--   * Solo se entrega lo aprobado (la versión vigente, sin archivar), igual que
--     solo se publica lo aprobado. Una pieza o se publica por la API o se entrega
--     a mano, no las dos cosas a la vez: cada lado rechaza al otro mientras esté
--     activo (sin cancelar).
--   * Las personas no escriben la tabla: todo pasa por funciones que comprueban
--     la capacidad `edit` sobre la marca (como programar).

-- ───────────────────────────── Tabla ─────────────────────────────

create table public.manual_publications (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  organization_id uuid not null,
  content_id uuid not null,
  -- Versión aprobada que se entregó.
  content_version integer not null check (content_version > 0),
  -- El vídeo montado que se mandó al móvil.
  media_asset_id uuid not null,
  -- El pie (con los hashtags) que se copió: sirve para reconocer la publicación.
  caption text not null default '' check (char_length(caption) <= 5000),
  status text not null default 'pending' check (status in ('pending', 'published', 'cancelled')),
  -- Cuándo se mandó al móvil (la última vez).
  handed_off_at timestamptz not null default now(),
  published_at timestamptz,
  -- manual: «Ya lo publiqué» · import: encontrada entre las publicaciones de la cuenta.
  match_source text check (match_source in ('manual', 'import')),
  imported_media_id uuid references public.social_imported_media (id) on delete set null,
  external_id text check (external_id is null or char_length(external_id) between 1 and 100),
  external_url text check (external_url is null or (char_length(external_url) <= 500
                           and external_url ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_./?=&%-]+$')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade,
  foreign key (content_id, brand_id, organization_id)
    references public.content_items (id, brand_id, organization_id) on delete cascade,
  foreign key (content_id, content_version) references public.content_versions (content_id, version) on delete cascade,
  foreign key (media_asset_id) references public.media_assets (id) on delete cascade,
  -- «Publicada» solo con cuándo y cómo se supo; lo pendiente o cancelado no tiene nada de eso.
  check ((status = 'published') = (published_at is not null and match_source is not null)),
  check (status = 'published' or (external_id is null and external_url is null and imported_media_id is null)),
  -- Encontrada en la cuenta = con el identificador de la red.
  check (match_source is distinct from 'import' or external_id is not null)
);
create index manual_publications_brand_idx on public.manual_publications (brand_id, handed_off_at desc);
-- Una pieza se entrega una vez (salvo cancelada).
create unique index manual_publications_one_per_content_idx on public.manual_publications (content_id)
  where status <> 'cancelled';
-- Una publicación de Instagram es de una sola pieza.
create unique index manual_publications_imported_idx on public.manual_publications (imported_media_id)
  where imported_media_id is not null;

-- ───────────────────────── Seguridad a nivel de fila ─────────────────────────

alter table public.manual_publications enable row level security;

-- La ve quien ve la marca. Sin políticas de escritura.
create policy manual_publications_select on public.manual_publications for select to authenticated
  using (brand_id in (select private.brand_ids_with('view')));

-- ─────────────────────────── Funciones internas ───────────────────────────

-- Bloquea la entrega y comprueba que quien llama edita su marca.
create function private.manual_publication_lock_for_edit(p_id uuid)
returns public.manual_publications
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.manual_publications;
begin
  select * into v_row from public.manual_publications m
  where m.id = p_id and m.brand_id in (select private.brand_ids_with('edit'))
  for update;
  if not found then
    raise exception 'No tienes permiso para cambiar esta publicación' using errcode = '42501';
  end if;
  return v_row;
end $$;

-- Una pieza que se está publicando por la API no se entrega también a mano (y al revés).
create function private.scheduled_publications_manual_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'cancelled' and exists (
    select 1 from public.manual_publications m where m.content_id = new.content_id and m.status <> 'cancelled'
  ) then
    raise exception 'Este reel se terminó en Instagram a mano: no se programa también desde aquí'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger scheduled_publications_manual_guard before insert on public.scheduled_publications
  for each row execute function private.scheduled_publications_manual_guard();

-- ──────────────────────────── RPC para personas ────────────────────────────

-- Entrega un reel aprobado para terminarlo en Instagram: queda «Pendiente de
-- publicar en Instagram». Si ya estaba pendiente, se actualiza (otro vídeo, otro
-- pie, otra hora). Capacidad `edit`.
create function public.start_manual_publication(p_content_id uuid, p_media_asset_id uuid, p_caption text default '')
returns public.manual_publications
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.content_items;
  v_row public.manual_publications;
begin
  select * into v_item from public.content_items c
  where c.id = p_content_id and c.brand_id in (select private.brand_ids_with('edit'));
  if not found then
    raise exception 'No tienes permiso para publicar este contenido' using errcode = '42501';
  end if;
  if v_item.archived_at is not null then
    raise exception 'El contenido está archivado: recupéralo antes de publicarlo' using errcode = 'P0001';
  end if;
  if v_item.network <> 'instagram' or v_item.format <> 'reel' then
    raise exception 'Solo los reels de Instagram se terminan en Instagram' using errcode = '22023';
  end if;
  -- Lo que no está aprobado no sale de aquí (tampoco a mano).
  if v_item.status <> 'approved' then
    raise exception 'Lo que no está aprobado no se publica' using errcode = 'PB001';
  end if;
  if not exists (
    select 1 from public.media_assets a
    where a.id = p_media_asset_id and a.brand_id = v_item.brand_id and a.kind = 'video'
      and a.mime_type in ('video/mp4', 'video/quicktime')
  ) then
    raise exception 'El vídeo tiene que ser un MP4 de la biblioteca de esta marca' using errcode = '22023';
  end if;
  if char_length(coalesce(p_caption, '')) > 5000 then
    raise exception 'El pie es demasiado largo' using errcode = '22023';
  end if;
  if exists (select 1 from public.scheduled_publications p where p.content_id = v_item.id and p.status <> 'cancelled') then
    raise exception 'Este reel ya está en el calendario: cancela esa publicación antes de terminarlo a mano'
      using errcode = 'P0001';
  end if;

  select * into v_row from public.manual_publications m
  where m.content_id = v_item.id and m.status <> 'cancelled' for update;
  if found and v_row.status = 'published' then
    raise exception 'Este reel ya está publicado en Instagram' using errcode = 'P0001';
  end if;

  if found then
    update public.manual_publications m
    set content_version = v_item.current_version, media_asset_id = p_media_asset_id,
        caption = coalesce(p_caption, ''), handed_off_at = now()
    where m.id = v_row.id
    returning * into v_row;
  else
    insert into public.manual_publications (brand_id, organization_id, content_id, content_version, media_asset_id,
                                            caption)
    values (v_item.brand_id, v_item.organization_id, v_item.id, v_item.current_version, p_media_asset_id,
            coalesce(p_caption, ''))
    returning * into v_row;
  end if;
  return v_row;
end $$;

-- «Ya lo publiqué», con el enlace del reel si se tiene. Vale también para poner
-- o cambiar el enlace de uno marcado a mano. Capacidad `edit`.
create function public.confirm_manual_publication(p_id uuid, p_url text default null)
returns public.manual_publications
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.manual_publications;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  v_row := private.manual_publication_lock_for_edit(p_id);
  if not (v_row.status = 'pending' or (v_row.status = 'published' and v_row.match_source = 'manual')) then
    raise exception 'Esta publicación ya no se puede cambiar' using errcode = 'P0001';
  end if;
  if v_url is not null and (char_length(v_url) > 500
                            or v_url !~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_./?=&%-]+$') then
    raise exception 'El enlace tiene que ser de instagram.com' using errcode = '22023';
  end if;
  update public.manual_publications m
  set status = 'published', match_source = 'manual', external_url = v_url,
      published_at = coalesce(m.published_at, now())
  where m.id = v_row.id
  returning * into v_row;
  return v_row;
end $$;

-- La app la encontró entre las publicaciones leídas de la cuenta: queda
-- publicada con su enlace, su identificador y su fecha. Vale para una pendiente
-- o para una marcada a mano sin enlace. La publicación tiene que ser un vídeo de
-- una cuenta de la marca, posterior a la entrega y de ninguna otra pieza.
create function public.match_manual_publication(p_id uuid, p_imported_media_id uuid)
returns public.manual_publications
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.manual_publications;
  v_media public.social_imported_media;
begin
  v_row := private.manual_publication_lock_for_edit(p_id);
  if not (v_row.status = 'pending' or (v_row.status = 'published' and v_row.match_source = 'manual'
                                       and v_row.external_url is null)) then
    raise exception 'Esta publicación ya no se puede cambiar' using errcode = 'P0001';
  end if;
  select * into v_media from public.social_imported_media s
  where s.id = p_imported_media_id and s.brand_id = v_row.brand_id;
  if not found then
    raise exception 'Esa publicación no es de una cuenta de esta marca' using errcode = '22023';
  end if;
  if not (v_media.media_type = 'VIDEO' or v_media.media_product_type = 'REELS') then
    raise exception 'Esa publicación no es un vídeo' using errcode = '22023';
  end if;
  if v_media.published_at is null or v_media.published_at < v_row.handed_off_at - interval '10 minutes' then
    raise exception 'Esa publicación es anterior a mandar el reel al móvil' using errcode = '22023';
  end if;
  if exists (select 1 from public.manual_publications m
             where m.imported_media_id = v_media.id and m.id <> v_row.id)
     or exists (select 1 from public.scheduled_publications p
                where p.brand_id = v_row.brand_id and p.external_id = v_media.external_id) then
    raise exception 'Esa publicación ya es de otra pieza' using errcode = 'P0001';
  end if;
  update public.manual_publications m
  set status = 'published', match_source = 'import', imported_media_id = v_media.id,
      external_id = v_media.external_id,
      external_url = case when v_media.permalink ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_./?=&%-]+$'
                               and char_length(v_media.permalink) <= 500
                          then v_media.permalink end,
      published_at = v_media.published_at
  where m.id = v_row.id
  returning * into v_row;
  return v_row;
end $$;

-- «Ya no lo voy a publicar así»: la entrega pendiente se cancela (lo publicado no). Capacidad `edit`.
create function public.cancel_manual_publication(p_id uuid)
returns public.manual_publications
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.manual_publications;
begin
  v_row := private.manual_publication_lock_for_edit(p_id);
  if v_row.status <> 'pending' then
    raise exception 'Solo se cancela lo que está pendiente' using errcode = 'P0001';
  end if;
  update public.manual_publications m set status = 'cancelled' where m.id = v_row.id
  returning * into v_row;
  return v_row;
end $$;

-- ─────────────────────── RPC del servidor (clave de servicio) ───────────────────────

-- «Buscar en Instagram» (social-import/recent): comprueba que quien lo pide
-- edita la marca de la cuenta y que la cuenta está conectada, y devuelve lo que
-- hace falta para leer sus últimas publicaciones (sin el token).
create function public.social_recent_claim(p_account_id uuid, p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_account public.social_accounts;
begin
  select * into v_account from public.social_accounts a where a.id = p_account_id;
  if not found or p_user_id is null
     or not private.user_has_brand_capability(p_user_id, v_account.brand_id, 'edit') then
    raise exception 'No tienes permiso para leer las publicaciones de esta cuenta' using errcode = '42501';
  end if;
  if v_account.status <> 'active' then
    raise exception 'La cuenta no está conectada: vuelve a conectarla' using errcode = 'P0001';
  end if;
  if v_account.network <> 'instagram' then
    raise exception 'Por ahora solo se leen publicaciones de Instagram' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_account.id, 'brand_id', v_account.brand_id,
                            'organization_id', v_account.organization_id, 'network', v_account.network,
                            'external_id', v_account.external_id, 'token_expires_at', v_account.token_expires_at);
end $$;

-- Guarda las últimas publicaciones leídas de la cuenta en `social_imported_media`
-- (como una página de la importación, sin tocar ninguna importación en marcha).
-- Devuelve cuántas se guardaron.
create function public.social_recent_save(p_account_id uuid, p_user_id uuid, p_items jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.social_accounts;
  v_item jsonb;
  v_count integer := 0;
begin
  select * into v_account from public.social_accounts a where a.id = p_account_id;
  if not found or p_user_id is null
     or not private.user_has_brand_capability(p_user_id, v_account.brand_id, 'edit') then
    raise exception 'No tienes permiso para leer las publicaciones de esta cuenta' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'Se guardan entre 0 y 50 publicaciones' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.social_imported_media (social_account_id, brand_id, organization_id, external_id, caption,
                                              media_type, media_product_type, media_url, thumbnail_url, permalink,
                                              published_at, children)
    values (v_account.id, v_account.brand_id, v_account.organization_id, v_item ->> 'id',
            left(v_item ->> 'caption', 5000), coalesce(nullif(v_item ->> 'media_type', ''), 'IMAGE'),
            nullif(v_item ->> 'media_product_type', ''), nullif(v_item ->> 'media_url', ''),
            nullif(v_item ->> 'thumbnail_url', ''), nullif(v_item ->> 'permalink', ''),
            nullif(v_item ->> 'timestamp', '')::timestamptz,
            case when jsonb_typeof(v_item -> 'children') = 'array' then v_item -> 'children' else '[]'::jsonb end)
    on conflict (social_account_id, external_id) do update
      set caption = excluded.caption, media_type = excluded.media_type,
          media_product_type = excluded.media_product_type, media_url = excluded.media_url,
          thumbnail_url = excluded.thumbnail_url, permalink = excluded.permalink,
          published_at = excluded.published_at, children = excluded.children, last_seen_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ─────────────────────────── Disparadores ───────────────────────────

create trigger manual_publications_touch before update on public.manual_publications
  for each row execute function private.touch_updated_at();
create trigger manual_publications_audit
  after insert or update of status or delete on public.manual_publications
  for each row execute function private.audit();

-- ───────────────────────────── Privilegios ─────────────────────────────

revoke all on public.manual_publications from public, anon, authenticated;
grant select on public.manual_publications to authenticated, service_role;

revoke all on function private.manual_publication_lock_for_edit(uuid) from public, anon, authenticated;
revoke all on function private.scheduled_publications_manual_guard() from public, anon, authenticated;
revoke all on function public.start_manual_publication(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_manual_publication(uuid, text) from public, anon, authenticated;
revoke all on function public.match_manual_publication(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_manual_publication(uuid) from public, anon, authenticated;
revoke all on function public.social_recent_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.social_recent_save(uuid, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.start_manual_publication(uuid, uuid, text) to authenticated;
grant execute on function public.confirm_manual_publication(uuid, text) to authenticated;
grant execute on function public.match_manual_publication(uuid, uuid) to authenticated;
grant execute on function public.cancel_manual_publication(uuid) to authenticated;
grant execute on function public.social_recent_claim(uuid, uuid) to service_role;
grant execute on function public.social_recent_save(uuid, uuid, jsonb) to service_role;
