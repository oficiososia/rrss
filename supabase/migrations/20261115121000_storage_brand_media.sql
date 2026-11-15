-- Almacenamiento de cada marca: un único cubo privado, con rutas
--   <organization_id>/<brand_id>/<carpeta>/<archivo>
-- El aislamiento lo dan las políticas sobre storage.objects: la marca se saca
-- de la ruta y se comprueba contra los permisos del usuario.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-media', 'brand-media', false,
  52428800, -- 50 MB: tope de subida estándar de Supabase. Subirlo exige plan de pago y subidas reanudables.
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/wav',
    'application/pdf', 'application/json', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;

-- Marca a la que pertenece una ruta, o null si la ruta no tiene la forma
-- esperada o la marca no es de esa organización. El CASE garantiza que la
-- conversión a uuid solo ocurre cuando el texto tiene forma de uuid.
create function private.storage_brand_id(p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/].*$'
    then (
      select b.id from public.brands b
      where b.id = split_part(p_name, '/', 2)::uuid
        and b.organization_id = split_part(p_name, '/', 1)::uuid
    )
  end;
$$;

revoke all on function private.storage_brand_id(text) from public, anon;
grant execute on function private.storage_brand_id(text) to authenticated, service_role;

create policy brand_media_select on storage.objects for select to authenticated
  using (bucket_id = 'brand-media' and private.storage_brand_id(name) in (select private.brand_ids_with('view')));
create policy brand_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-media' and private.storage_brand_id(name) in (select private.brand_ids_with('edit')));
create policy brand_media_update on storage.objects for update to authenticated
  using (bucket_id = 'brand-media' and private.storage_brand_id(name) in (select private.brand_ids_with('edit')))
  with check (bucket_id = 'brand-media' and private.storage_brand_id(name) in (select private.brand_ids_with('edit')));
create policy brand_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'brand-media' and private.storage_brand_id(name) in (select private.brand_ids_with('edit')));
