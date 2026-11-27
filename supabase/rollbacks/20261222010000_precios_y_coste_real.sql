-- Vuelta atrás de 20261222010000_precios_y_coste_real.sql.
-- Quita la función del coste real por operación y el ajuste de la última lectura
-- de precios (con su valor guardado, que cae en cascada con la clave del catálogo).

drop function if exists public.platform_cost_per_operation(date);

delete from private.integration_setting_keys where setting_key = 'AI_PRICE_SNAPSHOT';
