-- Vuelta atrás de 20261224010000_reel_templates.sql: quita las plantillas de
-- reel por marca (tabla, política, disparador y funciones). Se pierden las
-- plantillas guardadas; los reels ya montados con ellas no cambian (son
-- proyectos normales).

drop function if exists public.delete_reel_template(uuid);
drop function if exists public.deliver_reel_templates(uuid, jsonb, text);
drop table if exists public.brand_reel_templates;
