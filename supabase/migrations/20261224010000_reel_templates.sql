-- Plantillas de reel por marca, con estructura.
--
-- Hasta ahora un reel solo partía de un «estilo» del trabajador
-- (worker/templates: transición, duración de foto y estilo de texto). Una
-- plantilla de reel dice además qué planos lleva, cuánto dura cada uno, qué
-- textos salen y cuándo, con qué animación y qué música le va; el editor la
-- ofrece en «Empieza tu reel»: se elige, pide N fotos o clips y deja el reel
-- montado (docs/editor-reels.md, sección 9).
--
--   * `brand_reel_templates`: una fila por plantilla y marca. `document` es la
--     plantilla (`kind = 'rrss.reel-template'`, `schemaVersion = 1`); la forma
--     completa la valida la aplicación con su esquema (el mismo que usa
--     agency/). No lleva archivos (ni fotos, ni clips, ni música): no hay
--     recursos de otra marca que comprobar.
--   * `source`: `catalog` (catálogo de la agencia), `reference` (sacada de un
--     vídeo de referencia) o `editor` (guardada desde el editor).
--   * Lo ve quien ve la marca; no hay políticas de escritura: se entrega con
--     `deliver_reel_templates` y se borra con `delete_reel_template` (quien
--     edita la marca). Tope de 60 por marca.
--
-- Vuelta atrás: supabase/rollbacks/20261224010000_reel_templates.sql.

create table public.brand_reel_templates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  organization_id uuid not null,
  -- Clave estable dentro de la marca: entregar otra vez la misma la actualiza.
  template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (char_length(name) between 1 and 80),
  document jsonb not null check (
    jsonb_typeof(document) = 'object'
    and document ->> 'kind' = 'rrss.reel-template'
    and document ->> 'schemaVersion' = '1'
    and jsonb_typeof(document -> 'slots') = 'array'
    and jsonb_array_length(document -> 'slots') between 1 and 30
    and pg_column_size(document) <= 65536
  ),
  source text not null default 'catalog' check (source in ('catalog', 'reference', 'editor')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_id, organization_id) references public.brands (id, organization_id) on delete cascade,
  unique (brand_id, template_key)
);
create index brand_reel_templates_brand_idx on public.brand_reel_templates (brand_id, name);

alter table public.brand_reel_templates enable row level security;

-- Lo ve quien ve la marca. No hay políticas de escritura.
create policy brand_reel_templates_select on public.brand_reel_templates for select to authenticated
  using (brand_id in (select private.brand_ids_with('view')));

create trigger brand_reel_templates_touch before update on public.brand_reel_templates
  for each row execute function private.touch_updated_at();

-- Entrega plantillas de reel de una marca (quien edita la marca: la sesión de la
-- agencia desde `agency/`, o la propia marca). Lista de
--   {"key", "name", "document"}; `p_source` es el origen de todas.
-- Misma clave = se actualiza. La forma completa del documento la valida antes
-- quien entrega con el esquema de la aplicación; aquí se exige lo básico y que
-- no lleve ninguna ruta de archivo.
create function public.deliver_reel_templates(p_brand_id uuid, p_templates jsonb, p_source text default 'catalog')
returns setof public.brand_reel_templates
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_item jsonb;
  v_doc jsonb;
  v_new integer;
  v_row public.brand_reel_templates;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  if p_brand_id is null or not private.user_has_brand_capability(v_uid, p_brand_id, 'edit') then
    raise exception 'Solo quien edita la marca puede entregar plantillas de reel' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('catalog', 'reference', 'editor') then
    raise exception 'El origen de la plantilla debe ser catalog, reference o editor' using errcode = '22023';
  end if;
  if p_templates is null or jsonb_typeof(p_templates) <> 'array'
     or jsonb_array_length(p_templates) not between 1 and 12 then
    raise exception 'Hay que entregar entre 1 y 12 plantillas de reel' using errcode = '22023';
  end if;
  select b.organization_id into v_org from public.brands b where b.id = p_brand_id;

  for v_item in select * from jsonb_array_elements(p_templates) loop
    v_doc := v_item -> 'document';
    if jsonb_typeof(v_item) <> 'object' or v_doc is null or jsonb_typeof(v_doc) <> 'object'
       or v_item -> 'key' is null or jsonb_typeof(v_item -> 'key') <> 'string'
       or v_item -> 'name' is null or jsonb_typeof(v_item -> 'name') <> 'string' then
      raise exception 'Cada plantilla de reel necesita una clave, un nombre y un documento' using errcode = '22023';
    end if;
    if v_doc ->> 'kind' is distinct from 'rrss.reel-template' or v_doc ->> 'schemaVersion' is distinct from '1' then
      raise exception 'El documento no es una plantilla de reel de la versión 1' using errcode = '22023';
    end if;
    if coalesce(v_doc #>> '{style,id}', '') !~ '^[a-z][a-z0-9-]{1,40}$' then
      raise exception 'La plantilla de reel necesita un estilo de partida' using errcode = '22023';
    end if;
    -- Una plantilla no lleva archivos: ni fotos, ni clips, ni música, ni tipografías.
    if v_doc::text ~ '"(path|fontPath)"\s*:' then
      raise exception 'Una plantilla de reel no puede llevar archivos' using errcode = '22023';
    end if;
  end loop;

  -- Tope por marca: cuentan las que ya hay más las claves nuevas de esta entrega.
  select count(distinct i ->> 'key') into v_new
  from jsonb_array_elements(p_templates) i
  where not exists (select 1 from public.brand_reel_templates t
                    where t.brand_id = p_brand_id and t.template_key = i ->> 'key');
  if (select count(*) from public.brand_reel_templates t where t.brand_id = p_brand_id) + v_new > 60 then
    raise exception 'La marca tendría más de 60 plantillas de reel: borra alguna antes' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_templates) loop
    insert into public.brand_reel_templates (brand_id, organization_id, template_key, name, document, source, created_by)
    values (p_brand_id, v_org, v_item ->> 'key', btrim(v_item ->> 'name'), v_item -> 'document', p_source, v_uid)
    on conflict (brand_id, template_key) do update
      set name = excluded.name, document = excluded.document, source = excluded.source
    returning * into v_row;
    return next v_row;
  end loop;
end $$;

-- Borra una plantilla de reel de la marca. Quien edita la marca.
create function public.delete_reel_template(p_template_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_brand uuid;
begin
  if v_uid is null then
    raise exception 'Hace falta iniciar sesión' using errcode = '28000';
  end if;
  select t.brand_id into v_brand from public.brand_reel_templates t where t.id = p_template_id;
  if not found or not private.user_has_brand_capability(v_uid, v_brand, 'edit') then
    raise exception 'Solo quien edita la marca puede borrar sus plantillas de reel' using errcode = '42501';
  end if;
  delete from public.brand_reel_templates t where t.id = p_template_id;
end $$;

-- ───────────────────────────── Privilegios ─────────────────────────────

revoke all on public.brand_reel_templates from public, anon, authenticated;
grant select on public.brand_reel_templates to authenticated, service_role;

revoke all on function public.deliver_reel_templates(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.delete_reel_template(uuid) from public, anon, authenticated;
grant execute on function public.deliver_reel_templates(uuid, jsonb, text) to authenticated;
grant execute on function public.delete_reel_template(uuid) to authenticated;
