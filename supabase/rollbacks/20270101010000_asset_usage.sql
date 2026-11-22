-- Vuelta atrás de 20270101010000_asset_usage.sql: quita la consulta «en qué piezas se usa un archivo».
-- No toca datos: era solo una función de lectura.
drop function if exists public.asset_usage(uuid);
