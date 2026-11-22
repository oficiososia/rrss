-- Copiloto del editor por herramientas (f37): dos ajustes más de «IA de texto»
-- en Plataforma → Integraciones, para elegirlos sin tocar secretos:
--
--   AI_TEXT_EDITOR_COPILOT_MODE    `tools` (function calling, una herramienta por
--                                  operación del editor) o `json` (la ruta
--                                  anterior, para comparar). Sin valor: `tools`
--                                  si el adaptador las admite.
--   AI_TEXT_EDITOR_COPILOT_EFFORT  esfuerzo de razonamiento que se pide al modelo
--                                  (`none`, `minimal`, `low`…; `off` = no se envía).
--
-- Ninguno es secreto. Los mismos nombres están en
-- supabase/functions/_shared/integrations/catalog.ts y en la pantalla
-- (src/features/platform/integrations/catalog.ts). No cambia ninguna tabla.
-- Vuelta atrás: supabase/rollbacks/20261226010000_copilot_mode_settings.sql

insert into private.integration_setting_keys (setting_key, integration, is_secret) values
  ('AI_TEXT_EDITOR_COPILOT_MODE', 'ai_text', false),
  ('AI_TEXT_EDITOR_COPILOT_EFFORT', 'ai_text', false);
