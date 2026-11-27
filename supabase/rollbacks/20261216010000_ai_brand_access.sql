-- Vuelta atrás de 20261216010000_ai_brand_access.sql.
-- Quita la consulta de acceso a la IA por marca. Sin ella, `ai-media` (si se
-- redespliega la versión anterior) vuelve a no mirar el modo agencia.

drop function if exists public.ai_brand_access(uuid);
