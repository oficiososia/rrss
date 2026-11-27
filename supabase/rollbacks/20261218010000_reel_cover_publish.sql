-- Vuelta atrás de 20261218010000_reel_cover_publish.sql. No toca datos: las
-- portadas siguen en la biblioteca; el publicador (si no se vuelve a
-- desplegar) dejaría de mandarlas porque la función ya no existe, y el reel
-- sale igualmente con el fotograma que elija Instagram.
drop function if exists public.social_publication_cover(uuid);
