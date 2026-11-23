-- Vuelta atrás de 20270103010000_editor_frames_drafts.sql.
--
-- Se pierden los borradores sin guardar del editor (no son versiones: lo
-- guardado como versión no se toca). Las plantillas vuelven a aceptar solo los
-- documentos v3, v4 y v5: falla si ya hay plantillas v6, que habría que borrar
-- o volver a entregar antes.

drop function if exists public.save_content_draft(uuid, jsonb, integer, integer);
drop trigger if exists content_versions_clear_draft on public.content_versions;
drop function if exists private.content_drafts_clear();
drop table if exists public.content_drafts;
drop function if exists private.content_drafts_touch();

alter table public.brand_design_templates
  drop constraint if exists brand_design_templates_document_check;
alter table public.brand_design_templates
  add constraint brand_design_templates_document_check
  check (jsonb_typeof(document) = 'object'
         and (document ->> 'schemaVersion') in ('3', '4', '5')
         and pg_column_size(document) <= 262144);
