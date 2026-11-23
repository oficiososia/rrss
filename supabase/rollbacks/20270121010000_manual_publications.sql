-- Vuelta atrás de 20270121010000_manual_publications.sql: quita «Terminar en Instagram».
-- Se BORRA el registro de los reels entregados para publicar a mano (pendientes y
-- publicados). Lo que las cuentas ya tienen en Instagram no cambia, y las
-- publicaciones leídas con «Buscar en Instagram» se quedan en social_imported_media.

drop trigger if exists scheduled_publications_manual_guard on public.scheduled_publications;
drop function if exists public.social_recent_save(uuid, uuid, jsonb);
drop function if exists public.social_recent_claim(uuid, uuid);
drop function if exists public.cancel_manual_publication(uuid);
drop function if exists public.match_manual_publication(uuid, uuid);
drop function if exists public.confirm_manual_publication(uuid, text);
drop function if exists public.start_manual_publication(uuid, uuid, text);
drop function if exists private.scheduled_publications_manual_guard();
drop function if exists private.manual_publication_lock_for_edit(uuid);
drop table if exists public.manual_publications;
