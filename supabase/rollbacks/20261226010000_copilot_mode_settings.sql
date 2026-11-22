-- Vuelta atrás de 20261226010000_copilot_mode_settings.sql. Quita los dos ajustes
-- del copiloto del editor (sus valores guardados caen en cascada con la clave del
-- catálogo): la función `ai-generate` vuelve a leerlos solo del entorno.

delete from private.integration_setting_keys
where setting_key in ('AI_TEXT_EDITOR_COPILOT_MODE', 'AI_TEXT_EDITOR_COPILOT_EFFORT');
