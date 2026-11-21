-- Plantillas guardadas desde el editor de piezas.
--
-- Hasta ahora las plantillas de una marca solo llegaban importando publicaciones
-- (`instagram_import`) o entregadas por la agencia (`manual`). Una persona que
-- edita la marca puede ahora guardar el diseño que tiene abierto como plantilla:
--
--   * Nuevo origen `editor` en `brand_design_templates.source`.
--   * `deliver_design_templates` lo acepta con las mismas reglas de las manuales
--     (ejemplos y referencias opcionales) y la misma comprobación de que los
--     recursos del documento son de la biblioteca de la marca; quien la llama
--     necesita poder editar la marca (sin cambios: sigue siendo `edit`).
--   * Tope de 50 plantillas `editor` por marca (volver a guardar con la misma
--     clave la actualiza y no cuenta).
--
-- No hay tablas ni políticas nuevas: la RLS de la tabla (solo lectura para quien ve
-- la marca; escribir, solo por esta función) no cambia.
-- Vuelta atrás: supabase/rollbacks/20261212010000_editor_templates.sql.

alter table public.brand_design_templates drop constraint if exists brand_design_templates_source_check;
alter table public.brand_design_templates
  add constraint brand_design_templates_source_check check (source in ('instagram_import', 'manual', 'editor'));

create or replace function public.deliver_design_templates(p_brand_id uuid, p_templates jsonb)
returns setof public.brand_design_templates
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_item jsonb;
  v_layer jsonb;
  v_example jsonb;
  v_ref jsonb;
  v_source text;
  v_web text;
  v_host text;
  v_asset text;
  v_row public.brand_design_templates;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  if p_brand_id is null or not private.user_has_brand_capability(v_uid, p_brand_id, 'edit') then
    raise exception 'Solo quien edita la marca puede entregar plantillas' using errcode = '42501';
  end if;
  select b.organization_id, lower(substring(b.website from '^https?://([^/:?#@]+)'))
    into v_org, v_web from public.brands b where b.id = p_brand_id;
  v_web := regexp_replace(coalesce(v_web, ''), '^www\.', '');
  if p_templates is null or jsonb_typeof(p_templates) <> 'array'
     or jsonb_array_length(p_templates) not between 1 and 12 then
    raise exception 'Hay que entregar entre 1 y 12 plantillas' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_templates) loop
    if jsonb_typeof(v_item -> 'document') <> 'object' or jsonb_typeof(v_item -> 'analysis') <> 'object' then
      raise exception 'Cada plantilla necesita un documento y un análisis' using errcode = '22023';
    end if;
    -- Los recursos del documento (imágenes y logotipo, en cualquier página) son de esta marca.
    for v_layer in select * from jsonb_array_elements(private.content_document_layers(v_item -> 'document')) loop
      v_asset := case v_layer ->> 'type'
        when 'image' then case when v_layer #>> '{source,kind}' = 'asset' then v_layer #>> '{source,assetId}' end
        when 'logo' then v_layer ->> 'assetId'
      end;
      if v_asset is not null and (v_asset !~ '^[0-9a-f-]{36}$' or not exists (
           select 1 from public.media_assets a where a.id = v_asset::uuid and a.brand_id = p_brand_id)) then
        raise exception 'El documento usa un recurso que no es de la biblioteca de la marca' using errcode = '22023';
      end if;
    end loop;
    v_source := coalesce(v_item ->> 'source', 'instagram_import');
    if v_source not in ('instagram_import', 'manual', 'editor') then
      raise exception 'El origen de la plantilla debe ser instagram_import, manual o editor' using errcode = '22023';
    end if;
    -- Las guardadas desde el editor tienen un tope por marca, para que nadie llene la tabla.
    if v_source = 'editor' and not exists (
         select 1 from public.brand_design_templates t
         where t.brand_id = p_brand_id and t.template_key = v_item ->> 'key')
       and (select count(*) from public.brand_design_templates t
            where t.brand_id = p_brand_id and t.source = 'editor') >= 50 then
      raise exception 'La marca ya tiene 50 plantillas guardadas desde el editor: borra alguna antes' using errcode = 'P0001';
    end if;
    if jsonb_typeof(coalesce(v_item #> '{analysis,examples}', '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(v_item #> '{analysis,references}', '[]'::jsonb)) <> 'array' then
      raise exception 'Los ejemplos y las referencias del análisis deben ser listas' using errcode = '22023';
    end if;
    if v_source = 'instagram_import' then
      -- Importada: de 2 a 3 ejemplos, todos publicaciones importadas; sin referencias manuales.
      if jsonb_array_length(coalesce(v_item #> '{analysis,examples}', '[]'::jsonb)) not between 2 and 3 then
        raise exception 'Una plantilla importada necesita de 2 a 3 ejemplos (publicaciones importadas de la marca)'
          using errcode = '22023';
      end if;
      if jsonb_array_length(coalesce(v_item #> '{analysis,references}', '[]'::jsonb)) > 0 then
        raise exception 'Una plantilla importada no lleva referencias: son de las plantillas manuales'
          using errcode = '22023';
      end if;
    else
      -- Manual o del editor: ejemplos opcionales (hasta 3) y de 0 a 10 referencias públicas con nota.
      if jsonb_array_length(coalesce(v_item #> '{analysis,examples}', '[]'::jsonb)) > 3 then
        raise exception 'Una plantilla lleva como mucho 3 ejemplos' using errcode = '22023';
      end if;
      if jsonb_array_length(coalesce(v_item #> '{analysis,references}', '[]'::jsonb)) > 10 then
        raise exception 'Una plantilla manual lleva como mucho 10 referencias' using errcode = '22023';
      end if;
      for v_ref in select * from jsonb_array_elements(coalesce(v_item #> '{analysis,references}', '[]'::jsonb)) loop
        if jsonb_typeof(v_ref) <> 'object' or jsonb_typeof(v_ref -> 'url') <> 'string'
           or jsonb_typeof(v_ref -> 'note') <> 'string'
           or char_length(btrim(v_ref ->> 'note')) not between 1 and 300
           or char_length(v_ref ->> 'url') > 500 then
          raise exception 'Cada referencia necesita un enlace y una nota de hasta 300 caracteres' using errcode = '22023';
        end if;
        v_host := lower(substring(v_ref ->> 'url' from '^https://([^/:?#@\s]+)(?::[0-9]+)?(?:[/?#]|$)'));
        v_host := regexp_replace(coalesce(v_host, ''), '^www\.', '');
        if v_host = '' or not (
             v_host ~ '(^|\.)(instagram\.com|facebook\.com)$'
             or (v_web <> '' and (v_host = v_web or right(v_host, char_length(v_web) + 1) = '.' || v_web))) then
          raise exception 'Una referencia debe ser un enlace https de instagram.com, facebook.com o la web de la marca: %',
            left(v_ref ->> 'url', 120) using errcode = '22023';
        end if;
      end loop;
    end if;
    -- Los ejemplos, si los hay, son publicaciones importadas de la marca.
    for v_example in select * from jsonb_array_elements(coalesce(v_item #> '{analysis,examples}', '[]'::jsonb)) loop
      if not exists (select 1 from public.social_imported_media m
                     where m.brand_id = p_brand_id and m.permalink = v_example ->> 'permalink') then
        raise exception 'Un ejemplo no es una publicación importada de la marca: %',
          left(coalesce(v_example ->> 'permalink', ''), 120) using errcode = '22023';
      end if;
    end loop;

    insert into public.brand_design_templates (brand_id, organization_id, template_key, name, network, format,
                                               document, analysis, source, created_by)
    values (p_brand_id, v_org, v_item ->> 'key', v_item ->> 'name', v_item ->> 'network', v_item ->> 'format',
            v_item -> 'document', v_item -> 'analysis', v_source, v_uid)
    on conflict (brand_id, template_key) do update
      set name = excluded.name, network = excluded.network, format = excluded.format,
          document = excluded.document, analysis = excluded.analysis, source = excluded.source
    returning * into v_row;
    return next v_row;
  end loop;
end $$;
