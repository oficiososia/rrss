-- Renovar el acceso a Instagram sin volver a conectar, y avisar con antelación
-- si no se puede (docs/publicacion.md, «Renovación del acceso»).
--
-- El token largo del usuario de Meta (unos 60 días) ya se guarda cifrado como
-- `refresh_token_ciphertext`. Antes de que caduque, `social-publish` lo vuelve
-- a cambiar por uno nuevo (`fb_exchange_token`), pide otra vez los tokens de
-- página y guarda lo nuevo. Esta migración pone la parte de base de datos:
--
--   * Tres columnas en `social_accounts` (las ve quien ve la marca, como el
--     resto de la fila): `token_renewed_at` (última renovación conseguida),
--     `renewal_attempted_at` (último intento, para no insistir más de una vez
--     al día) y `renewal_error` (por qué no se pudo; null si todo va bien). La
--     interfaz avisa con ellas a la marca y a la agencia.
--   * `social_accounts_to_renew`: las cuentas conectadas por OAuth cuyo acceso
--     caduca en menos de N días (14 por omisión) y no se han intentado en 24 h.
--   * `social_account_renew`: guarda los tokens nuevos y la caducidad nueva.
--   * `social_account_renewal_failed`: anota que no se pudo y por qué.
--   * `private.social_publish_dispatch` también despierta a `social-publish`
--     cuando hay una cuenta que renovar (antes solo con trabajos o con cuentas
--     por comprobar).
-- Las cuentas conectadas con un token pegado NO se renuevan solas (no tenemos
-- su aplicación de Meta): solo se avisa de su caducidad.
-- Vuelta atrás: supabase/rollbacks/20261218020000_social_token_renewal.sql.

alter table public.social_accounts
  add column token_renewed_at timestamptz,
  add column renewal_attempted_at timestamptz,
  add column renewal_error text check (renewal_error is null or char_length(renewal_error) <= 500);

-- Cuentas que toca renovar (solo la clave de servicio).
create function public.social_accounts_to_renew(p_days integer default 14, p_limit integer default 10)
returns table (id uuid, brand_id uuid, network text, external_id text, token_expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.brand_id, a.network, a.external_id, a.token_expires_at
  from public.social_accounts a
  join private.social_account_secrets s on s.account_id = a.id
  where a.status = 'active'
    and a.connection_method = 'oauth'
    and s.refresh_token_ciphertext is not null
    and a.token_expires_at is not null
    and a.token_expires_at < now() + make_interval(days => greatest(1, least(coalesce(p_days, 14), 60)))
    and (a.renewal_attempted_at is null or a.renewal_attempted_at < now() - interval '24 hours')
  order by a.token_expires_at
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- Guarda los tokens renovados (ya cifrados) y la caducidad nueva.
create function public.social_account_renew(
  p_account_id uuid,
  p_key_id text,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_token_expires_at timestamptz
) returns public.social_accounts
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.social_accounts;
begin
  update public.social_accounts a
  set token_expires_at = p_token_expires_at, token_checked_at = now(), token_renewed_at = now(),
      renewal_attempted_at = now(), renewal_error = null, last_error = null
  where a.id = p_account_id and a.status = 'active'
  returning * into v_account;
  if not found then
    raise exception 'La cuenta no existe o no está activa' using errcode = 'P0001';
  end if;
  update private.social_account_secrets s
  set key_id = p_key_id, access_token_ciphertext = p_access_token_ciphertext,
      refresh_token_ciphertext = p_refresh_token_ciphertext, updated_at = now()
  where s.account_id = p_account_id;
  if not found then
    raise exception 'La cuenta no tiene token guardado' using errcode = 'P0001';
  end if;
  return v_account;
end $$;

-- Anota que la renovación no se pudo, con el motivo en una frase (sin tokens).
create function public.social_account_renewal_failed(p_account_id uuid, p_error text)
returns public.social_accounts
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.social_accounts;
begin
  update public.social_accounts a
  set renewal_attempted_at = now(), renewal_error = left(coalesce(nullif(trim(p_error), ''), 'No se pudo renovar'), 500)
  where a.id = p_account_id and a.status <> 'disconnected'
  returning * into v_account;
  if not found then
    raise exception 'La cuenta no existe o está desconectada' using errcode = 'P0001';
  end if;
  return v_account;
end $$;

-- Volver a conectar deja limpio el estado de renovación.
create function private.social_accounts_reset_renewal() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.connected_at is distinct from old.connected_at then
    new.renewal_error := null;
    new.renewal_attempted_at := null;
  end if;
  return new;
end $$;
create trigger social_accounts_reset_renewal before update of connected_at on public.social_accounts
  for each row execute function private.social_accounts_reset_renewal();

-- El reloj: despierta a la función también si hay cuentas que renovar.
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
  ) and not exists (select 1 from public.social_accounts_to_renew(14, 1)) then
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

revoke all on function public.social_accounts_to_renew(integer, integer) from public, anon, authenticated;
revoke all on function public.social_account_renew(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.social_account_renewal_failed(uuid, text) from public, anon, authenticated;
revoke all on function private.social_accounts_reset_renewal() from public, anon, authenticated;
grant execute on function public.social_accounts_to_renew(integer, integer) to service_role;
grant execute on function public.social_account_renew(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.social_account_renewal_failed(uuid, text) to service_role;
