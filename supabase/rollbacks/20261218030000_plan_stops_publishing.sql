-- Vuelta atrás de 20261218030000_plan_stops_publishing.sql.
-- Quita los disparadores del plan y devuelve la regla de «lista para publicar»
-- a la de antes (sin mirar el plan). Lo detenido por el plan se reevalúa con la
-- regla antigua: si lo demás cumple, vuelve a quedar programado.

drop trigger if exists plans_publications_refresh on public.plans;
drop trigger if exists subscriptions_publications_refresh on public.subscriptions;
drop function if exists private.plans_publications_refresh();
drop function if exists private.subscriptions_publications_refresh();
drop function if exists private.publication_refresh_org(uuid);

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

-- El motivo nuevo ya no existe: se anota uno antiguo y se reevalúa con la regla de antes.
alter table public.scheduled_publications drop constraint scheduled_publications_hold_reason_check;
update public.scheduled_publications set hold_reason = 'no_account' where hold_reason = 'plan_no_publishing';
alter table public.scheduled_publications
  add constraint scheduled_publications_hold_reason_check
    check (hold_reason in ('not_approved', 'content_changed', 'content_archived', 'no_account',
                           'account_disconnected', 'account_needs_reauth', 'no_media',
                           'invalid_media', 'unsupported_format'));
select private.publication_refresh();
