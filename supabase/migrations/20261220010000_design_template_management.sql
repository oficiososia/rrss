-- Gestión de las plantillas de la marca: renombrar y duplicar (docs/ESTADO.md, «Plantillas de la marca»).
--
-- Hasta ahora una plantilla se podía entregar (`deliver_design_templates`) o borrar
-- (`delete_design_template`). La vista de gestión de la sección Marca añade dos operaciones
-- pequeñas, las dos solo para quien EDITA la marca y sin tocar el documento ni el análisis:
--
--   * `rename_design_template(id, nombre)`: cambia solo el nombre (1 a 120 caracteres).
--   * `duplicate_design_template(id)`: crea una copia con otra clave, el nombre «… (copia)» y
--     origen `editor` (es una copia hecha aquí, así se puede renombrar y borrar como las demás).
--     Cuenta para el tope de 50 plantillas del editor por marca.
--
-- Sin tablas ni columnas nuevas; la RLS de la tabla no cambia (solo lectura; se escribe por funciones).
-- Vuelta atrás: supabase/rollbacks/20261220010000_design_template_management.sql

create function public.rename_design_template(p_template_id uuid, p_name text)
returns public.brand_design_templates
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_brand uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_row public.brand_design_templates;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  select t.brand_id into v_brand from public.brand_design_templates t where t.id = p_template_id;
  if not found or not private.user_has_brand_capability(v_uid, v_brand, 'edit') then
    raise exception 'Solo quien edita la marca puede renombrar sus plantillas' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'El nombre de la plantilla debe tener entre 1 y 120 caracteres' using errcode = '22023';
  end if;
  update public.brand_design_templates t set name = v_name where t.id = p_template_id returning * into v_row;
  return v_row;
end $$;

create function public.duplicate_design_template(p_template_id uuid)
returns public.brand_design_templates
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_src public.brand_design_templates;
  v_row public.brand_design_templates;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  select * into v_src from public.brand_design_templates t where t.id = p_template_id;
  if not found or not private.user_has_brand_capability(v_uid, v_src.brand_id, 'edit') then
    raise exception 'Solo quien edita la marca puede duplicar sus plantillas' using errcode = '42501';
  end if;
  -- Mismo tope que `deliver_design_templates` para las hechas aquí.
  if (select count(*) from public.brand_design_templates t
      where t.brand_id = v_src.brand_id and t.source = 'editor') >= 50 then
    raise exception 'La marca ya tiene 50 plantillas guardadas desde el editor: borra alguna antes' using errcode = 'P0001';
  end if;
  insert into public.brand_design_templates (brand_id, organization_id, template_key, name, network, format,
                                             document, analysis, source, created_by)
  values (v_src.brand_id, v_src.organization_id,
          'copia-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
          left(v_src.name, 109) || ' (copia)', v_src.network, v_src.format,
          v_src.document, v_src.analysis, 'editor', v_uid)
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.rename_design_template(uuid, text) from public, anon, authenticated;
revoke all on function public.duplicate_design_template(uuid) from public, anon, authenticated;
grant execute on function public.rename_design_template(uuid, text) to authenticated;
grant execute on function public.duplicate_design_template(uuid) to authenticated;
