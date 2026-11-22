-- Modo agencia · quién puede usar la IA de imagen.
--
-- En una marca en modo agencia (`brands.ai_mode = 'agency'`) la IA de texto está
-- cerrada para todos (`ai-generate`, 409 `agency_mode`). La de imagen
-- (`ai-media`) tenía que seguir la misma lógica, pero con una diferencia: quien
-- trabaja PARA la agencia sí la usa, y quien es miembro de la marca (el cliente,
-- con el rol que tenga en la marca) no.
--
-- `ai_brand_access(marca)` dice, con la identidad de quien pregunta, cómo
-- redacta la marca y si esa persona es personal de la agencia o de la
-- plataforma:
--   * superadministrador de la plataforma, o
--   * propietario o administrador de la organización de la marca, si esa
--     organización es de tipo «agencia».
-- Devuelve null si la persona no ve la marca (se responde como si no existiera).
-- Los miembros de la marca por rol (gestor, editor, revisor, cliente, lectura)
-- NO cuentan como personal de la agencia.
--
-- Vuelta atrás: supabase/rollbacks/20261216010000_ai_brand_access.sql

create function public.ai_brand_access(p_brand_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_brand public.brands%rowtype;
  v_staff boolean;
begin
  if v_user is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '42501';
  end if;
  select * into v_brand from public.brands b where b.id = p_brand_id;
  if not found then
    return null;
  end if;
  if not (private.is_platform_admin()
          or v_brand.organization_id in (select private.my_admin_org_ids())
          or v_brand.id in (select private.brand_ids_with('view'))) then
    return null;
  end if;
  v_staff := private.is_platform_admin()
    or exists (
      select 1
      from public.organization_members om
      join public.organizations o on o.id = om.organization_id
      where om.organization_id = v_brand.organization_id
        and om.user_id = v_user
        and om.role in ('owner', 'admin')
        and o.kind = 'agency'
    );
  return jsonb_build_object('ai_mode', v_brand.ai_mode, 'agency_staff', v_staff);
end $$;

revoke all on function public.ai_brand_access(uuid) from public, anon;
grant execute on function public.ai_brand_access(uuid) to authenticated;
