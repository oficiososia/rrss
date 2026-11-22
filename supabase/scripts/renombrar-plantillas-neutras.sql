-- Renombra las dos plantillas manuales de staging con nombres que no dan por hecho que la foto sea un plato,
-- y les pone una frase corta de para qué sirven (la tarjeta enseña la primera frase del resumen; el texto
-- largo de la agencia queda detrás, para «Ver más»). Solo datos: sin migración. Se ejecuta a mano, en staging:
--   supabase db query --linked -f supabase/scripts/renombrar-plantillas-neutras.sql
-- Se puede repetir: solo toca las que aún tienen el nombre antiguo. No se aplica sola en ninguna parte.

begin;

update public.brand_design_templates
set name = 'Foto a sangre',
    analysis = jsonb_set(
      analysis, '{summary}',
      to_jsonb('Tu foto ocupa toda la pieza, sin adornos.' || ' ' ||
        regexp_replace(analysis ->> 'summary', '^\s*PROPUESTA de la agencia[^:]*:\s*', '', 'i')))
where source = 'manual' and name = 'Plato limpio';

update public.brand_design_templates
set name = 'Foto con franja y titular',
    analysis = jsonb_set(
      analysis, '{summary}',
      to_jsonb('Tu foto con una franja de color y un titular, y la firma de la marca.' || ' ' ||
        regexp_replace(analysis ->> 'summary', '^\s*PROPUESTA de la agencia[^:]*:\s*', '', 'i')))
where source = 'manual' and name = 'Plato con firma';

-- Comprobación: debe salir una fila por plantilla con el nombre nuevo.
select brand_id, name, left(analysis ->> 'summary', 80) as empieza_con
from public.brand_design_templates
where source = 'manual' and name in ('Foto a sangre', 'Foto con franja y titular');

commit;
