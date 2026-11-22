-- Bajar a un plan sin publicación detiene lo ya programado (docs/publicacion.md,
-- «Si el plan deja de incluir la publicación»).
--
-- Antes: el plan solo se miraba al conectar una cuenta o al programar en una
-- cuenta (20261119710000). Si una organización bajaba a un plan sin
-- publicación, lo que ya estaba armado seguía saliendo.
--
-- Ahora:
--   * Motivo nuevo de «Detenida»: `plan_no_publishing`.
--   * `private.publication_hold_reason` (el único sitio donde se define «lista
--     para publicar») lo devuelve si el plan de la organización no tiene la
--     función `publishing`. Como lo comprueban también `social_publication_begin`
--     y la guarda de `scheduled_publications`, ni el reloj ni «Publicar ahora»
--     publican sin plan, aunque nada hubiera reevaluado el calendario.
--   * Cambiar de plan (suscripción) o cambiar las funciones de un plan
--     reevalúa las publicaciones de las organizaciones afectadas: las armadas
--     pasan a «planned» con el motivo, y al volver a un plan con publicación se
--     rearman solas (siguen aprobadas y con su exportación).
--   * Lo que ya se está publicando (`publishing`) termina; lo publicado no cambia.
-- Vuelta atrás: supabase/rollbacks/20261218030000_plan_stops_publishing.sql.

alter table public.scheduled_publications drop constraint scheduled_publications_hold_reason_check;
alter table public.scheduled_publications
  add constraint scheduled_publications_hold_reason_check
    check (hold_reason in ('not_approved', 'content_changed', 'content_archived', 'no_account',
                           'account_disconnected', 'account_needs_reauth', 'no_media',
                           'invalid_media', 'unsupported_format', 'plan_no_publishing'));

create or replace function private.publication_hold_reason(p_pub public.scheduled_publications) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item public.content_items;
  v_account public.social_accounts;
begin
  select * into v_item from public.content_items c where c.id = p_pub.content_id;
  if not found then
    return 'content_changed';
  end if;
  if v_item.archived_at is not null then
    return 'content_archived';
  end if;
  if v_item.status <> 'approved' then
    return 'not_approved';
  end if;
  if p_pub.content_version is null or p_pub.content_version <> v_item.current_version
     or (p_pub.network, p_pub.format) is distinct from (v_item.network, v_item.format) then
    return 'content_changed';
  end if;
  if not private.publication_format_supported(v_item.network, v_item.format) then
    return 'unsupported_format';
  end if;
  if not private.org_has_feature(p_pub.organization_id, 'publishing') then
    return 'plan_no_publishing';
  end if;
  if p_pub.social_account_id is null then
    return 'no_account';
  end if;
  select * into v_account from public.social_accounts a where a.id = p_pub.social_account_id;
  if not found or v_account.network <> v_item.network then
    return 'no_account';
  end if;
  if v_account.status = 'disconnected' then
    return 'account_disconnected';
  end if;
  if v_account.status = 'needs_reauth' then
    return 'account_needs_reauth';
  end if;
  return private.publication_media_problem(p_pub.brand_id, p_pub.content_id, p_pub.content_version, p_pub.format,
                                           p_pub.media_asset_ids);
end $$;

-- Reevalúa las publicaciones en el calendario (planned o scheduled) de una organización.
create function private.publication_refresh_org(p_organization_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id from public.scheduled_publications p
    where p.organization_id = p_organization_id and p.status in ('planned', 'scheduled')
  loop
    perform private.publication_refresh(p_publication_id => v_id);
  end loop;
end $$;

create function private.subscriptions_publications_refresh() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.publication_refresh_org(new.organization_id);
  return null;
end $$;

create trigger subscriptions_publications_refresh after insert or update of plan_id, status on public.subscriptions
  for each row execute function private.subscriptions_publications_refresh();

-- Cambian las funciones de un plan (o cuál es el de por defecto): afecta a quien lo tenga.
create function private.plans_publications_refresh() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  for v_org in
    select distinct p.organization_id from public.scheduled_publications p where p.status in ('planned', 'scheduled')
  loop
    perform private.publication_refresh_org(v_org);
  end loop;
  return null;
end $$;

create trigger plans_publications_refresh after update of features, is_default on public.plans
  for each statement execute function private.plans_publications_refresh();

revoke all on function private.publication_refresh_org(uuid) from public, anon, authenticated;
revoke all on function private.subscriptions_publications_refresh() from public, anon, authenticated;
revoke all on function private.plans_publications_refresh() from public, anon, authenticated;
