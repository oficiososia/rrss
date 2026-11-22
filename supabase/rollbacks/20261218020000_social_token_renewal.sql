-- Vuelta atrás de 20261218020000_social_token_renewal.sql.
-- Devuelve el reloj del publicador a su versión de 20261119040000 (sin mirar
-- cuentas por renovar) y quita las funciones y columnas de la renovación. Los
-- tokens ya renovados se quedan como están (siguen cifrados y válidos).

create or replace function private.social_publish_dispatch() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
  v_request bigint;
begin
  perform public.social_enqueue_due_publications(100);

  if not exists (
    select 1 from public.jobs j
    where j.kind = 'social.publish'
      and ((j.status = 'queued' and j.run_after <= now()) or (j.status = 'running' and j.locked_until < now()))
  ) and not exists (
    select 1 from public.social_accounts a
    where a.status = 'active' and (a.token_checked_at is null or a.token_checked_at < now() - interval '24 hours')
  ) then
    return null;
  end if;

  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    raise warning 'social_publish_dispatch: faltan Vault o pg_net; no se llama a social-publish';
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'rrss_project_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_key using 'rrss_service_role_key';
  if v_url is null or v_key is null then
    raise warning 'social_publish_dispatch: faltan los secretos rrss_project_url o rrss_service_role_key en Vault';
    return null;
  end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
    into v_request
    using rtrim(v_url, '/') || '/functions/v1/social-publish',
          jsonb_build_object('source', 'pg_cron'),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
          120000;
  return v_request;
end $$;

drop trigger if exists social_accounts_reset_renewal on public.social_accounts;
drop function if exists private.social_accounts_reset_renewal();
drop function if exists public.social_account_renewal_failed(uuid, text);
drop function if exists public.social_account_renew(uuid, text, text, text, timestamptz);
drop function if exists public.social_accounts_to_renew(integer, integer);

alter table public.social_accounts
  drop column if exists renewal_error,
  drop column if exists renewal_attempted_at,
  drop column if exists token_renewed_at;
