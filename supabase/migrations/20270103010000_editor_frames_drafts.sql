-- Editor de piezas: marcos de foto (documento v6) y borrador que se guarda solo.
--
-- 1. Plantillas de marca: aceptar el documento v6.
--    La versión 6 añade los marcos de foto (una imagen puede ser un hueco sin
--    foto, `source.kind = 'empty'`, con la marca `frame` y la ampliación `zoom`)
--    y el pie de ejemplo (`copy.captionHint`). Nada de eso referencia recursos:
--    `deliver_design_templates` solo mira las imágenes cuyo origen es un recurso
--    de la biblioteca, así que un marco vacío no tiene nada que comprobar. Se
--    siguen aceptando las v3, v4 y v5 ya guardadas (la aplicación las convierte
--    al leerlas).
--
-- 2. Borradores del editor (`content_drafts`).
--    Lo que una persona tiene a medias en el editor de una pieza, guardado cada
--    pocos segundos para no perder trabajo. NO es una versión: no cambia el
--    estado de la pieza, no entra en el historial y nunca se publica. Hay como
--    mucho uno por pieza y persona; al guardar una versión, el borrador de quien
--    la guarda se borra (lo hace un disparador, en la misma transacción).
--    Aislamiento: cada persona solo ve y escribe los suyos, y solo en marcas
--    que puede editar. La clave ajena compuesta impide declarar un borrador de
--    otra marca u organización que su pieza.
--
-- Vuelta atrás: supabase/rollbacks/20270103010000_editor_frames_drafts.sql.

alter table public.brand_design_templates
  drop constraint if exists brand_design_templates_document_check;
alter table public.brand_design_templates
  add constraint brand_design_templates_document_check
  check (jsonb_typeof(document) = 'object'
         and (document ->> 'schemaVersion') in ('3', '4', '5', '6')
         and pg_column_size(document) <= 262144);

create table public.content_drafts (
  content_id uuid not null,
  brand_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Versión de la pieza sobre la que se empezó a trabajar (0 si aún no tenía ninguna).
  base_version integer not null check (base_version >= 0),
  schema_version integer not null check (schema_version > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 524288),
  updated_at timestamptz not null default now(),
  primary key (content_id, user_id),
  -- Un borrador no puede declararse de otra marca u organización que su pieza.
  foreign key (content_id, brand_id, organization_id)
    references public.content_items (id, brand_id, organization_id) on delete cascade
);
create index content_drafts_user_idx on public.content_drafts (user_id);

-- La fecha del borrador la pone la base de datos, no el cliente.
create function private.content_drafts_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger content_drafts_touch before insert or update on public.content_drafts
  for each row execute function private.content_drafts_touch();

-- Al guardar una versión, el borrador de quien la guarda ya está dentro de ella.
create function private.content_drafts_clear() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null then
    delete from public.content_drafts d where d.content_id = new.content_id and d.user_id = new.created_by;
  end if;
  return new;
end $$;

create trigger content_versions_clear_draft after insert on public.content_versions
  for each row execute function private.content_drafts_clear();

-- Guarda (o sustituye) el borrador de quien llama para una pieza que puede editar.
--   28000  sin sesión
--   42501  sin permiso de edición sobre la marca (o la pieza no existe)
--   P0001  la pieza está archivada
--   22023  el borrador no es un documento
create function public.save_content_draft(
  p_content_id uuid,
  p_data jsonb,
  p_schema_version integer,
  p_base_version integer
) returns public.content_drafts
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_item public.content_items;
  v_draft public.content_drafts;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  select * into v_item from public.content_items c
  where c.id = p_content_id and c.brand_id in (select private.brand_ids_with('edit'));
  if not found then
    raise exception 'No tienes permiso para editar este contenido' using errcode = '42501';
  end if;
  if v_item.archived_at is not null then
    raise exception 'El contenido está archivado: recupéralo antes de cambiarlo' using errcode = 'P0001';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or p_schema_version is null or p_schema_version < 1
     or p_base_version is null or p_base_version < 0 then
    raise exception 'El borrador no es válido' using errcode = '22023';
  end if;

  insert into public.content_drafts (content_id, brand_id, organization_id, user_id, base_version, schema_version, data)
  values (v_item.id, v_item.brand_id, v_item.organization_id, v_uid,
          least(p_base_version, v_item.current_version), p_schema_version, p_data)
  on conflict (content_id, user_id) do update
    set base_version = excluded.base_version, schema_version = excluded.schema_version, data = excluded.data
  returning * into v_draft;
  return v_draft;
end $$;

alter table public.content_drafts enable row level security;

-- Solo los propios, y solo donde se puede editar (quien pierde el permiso deja de verlos).
-- Se escriben con save_content_draft(); descartar el propio es un borrado directo.
create policy content_drafts_select on public.content_drafts for select to authenticated
  using (user_id = (select auth.uid()) and brand_id in (select private.brand_ids_with('edit')));
create policy content_drafts_delete on public.content_drafts for delete to authenticated
  using (user_id = (select auth.uid()));

-- Nadie escribe un borrador a mano: ni el cliente ni la clave de servicio.
grant select on public.content_drafts to authenticated, service_role;
grant delete on public.content_drafts to authenticated;

revoke all on function private.content_drafts_touch() from public, anon, authenticated;
revoke all on function private.content_drafts_clear() from public, anon, authenticated;
revoke all on function public.save_content_draft(uuid, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.save_content_draft(uuid, jsonb, integer, integer) to authenticated;
