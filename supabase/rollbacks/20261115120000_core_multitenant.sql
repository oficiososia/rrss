-- Vuelta atrás de 20261115120000_core_multitenant.sql.
-- DESTRUCTIVA: elimina todas las tablas del núcleo y sus datos. Solo tiene
-- sentido en un entorno recién creado; en uno con datos, antes hay que
-- exportarlos. Aplicar primero la vuelta atrás de la migración de storage.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_email_changed on auth.users;

drop function if exists public.admin_list_organizations();
drop function if exists public.save_brand_profile(uuid, jsonb, jsonb, text);
drop function if exists public.accept_invitation(text);
drop function if exists public.get_invitation(text);
drop function if exists public.revoke_invitation(uuid);
drop function if exists public.create_invitation(uuid, text, public.org_role, uuid, public.brand_role);
drop function if exists public.remove_member(uuid, uuid);
drop function if exists public.set_member_role(uuid, uuid, public.org_role);
drop function if exists public.create_organization(text, public.org_kind);

drop table if exists public.audit_logs, public.invitations, public.media_assets, public.brand_knowledge_sources,
  public.brand_profiles, public.brand_members, public.brands, public.organization_members,
  public.organizations, public.platform_admins, public.profiles cascade;

drop function if exists private.audit();
drop function if exists private.keep_one_owner();
drop function if exists private.handle_auth_user();
drop function if exists private.touch_updated_at();
drop function if exists private.visible_user_ids();
drop function if exists private.brand_ids_with(text);
drop function if exists private.brand_role_grants(public.brand_role, text);
drop function if exists private.my_admin_org_ids();
drop function if exists private.my_org_ids();
drop function if exists private.is_platform_admin();

drop type if exists public.asset_origin, public.asset_kind, public.source_status, public.source_kind,
  public.profile_status, public.brand_status, public.brand_role, public.org_role, public.org_kind;

-- Se restauran los privilegios por defecto que la migración retiró.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
