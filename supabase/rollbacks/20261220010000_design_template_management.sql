-- Vuelta atrás de 20261220010000_design_template_management.sql: quita las dos funciones.
-- Las plantillas duplicadas se conservan (son filas normales de origen `editor`).

drop function if exists public.rename_design_template(uuid, text);
drop function if exists public.duplicate_design_template(uuid);
