# Estado del proyecto

Última actualización: 16/11/2026. Rama de trabajo: `claude/focused-noether-hk502p`,
con PR abierto a `staging`. Las ramas `main` y `staging` existen desde el 16/11/2026.

## Hecho y comprobado

| Qué | Cómo se ha comprobado |
|---|---|
| Fase 0: auditoría, arquitectura, modelo de datos, diseño y plan | Documentos en `docs/` |
| Esquema multiempresa (organizaciones, marcas, roles, perfil versionado, fuentes, biblioteca, invitaciones, auditoría, cubo privado) | 46 pruebas de aislamiento y permisos (`npm run test:db`), en PGlite y en Postgres 16 |
| Vuelta atrás de cada migración | 2 pruebas: deshacer deja la base limpia y se puede reaplicar |
| Lógica de la aplicación (perfil, exportar e importar, completitud, nombres de archivo, permisos por rol, mensajes de error, subida, limpieza, logotipos) | 70 pruebas unitarias (`npm test`, proyecto `unit`) |
| Interfaz de la Fase 1 contra un backend simulado (acceso, crear organización, asistente de marca, perfil con exportar, importar y versiones, equipo e invitaciones, menú y rutas por rol) | 105 pruebas de componentes (`npm test`, proyecto `components`): la aplicación real en jsdom con el cliente de Supabase simulado. No sustituyen a la prueba de extremo a extremo |
| Interfaz de la Fase 1 de extremo a extremo: sesión con confirmación de correo, dos organizaciones, alta de dos marcas con el asistente, perfil con versiones, exportar e importar, biblioteca con progreso real y limpieza, invitaciones y cinco roles, aislamiento por URL, API y archivo, recuperación de contraseña, ajustes, actividad y panel de plataforma | 39 pruebas en navegador (`npm run test:e2e`, Playwright) contra un Supabase local (`supabase start`) con las 5 migraciones aplicadas; ver `docs/05-puesta-en-marcha.md` |
| Biblioteca: progreso real de subida (porcentaje de bytes por archivo) | Unitarias y extremo a extremo con un archivo de 8,7 MB |
| Biblioteca: cola de limpieza `storage_cleanup_queue` para no dejar archivos huérfanos al borrar (el cliente reintenta al abrir la biblioteca) | `test:db` y extremo a extremo, incluido el caso de borrado de archivo fallido |
| Biblioteca: filtros de etiqueta y carpeta con todas las opciones de la marca (función `asset_facets`) | `test:db` con 1.100 recursos y extremo a extremo |
| Fase 2, cimientos: registro de generaciones de IA, libro de consumo, cupo mensual por organización impuesto por la base de datos, coste por organización y periodo, y cola de trabajos (idempotencia, reserva con caducidad, reintentos, cancelación) | 52 pruebas de base de datos entre `ia-cupos`, `ia-servicio` y `trabajos`, más 6 de aislamiento. Las 2 de simultaneidad con dos conexiones reales se ejecutaron el 16/11/2026 contra Postgres 16 (`DATABASE_URL`): 100 de 100; en CI quedan omitidas porque usa PGlite |
| Servicio de IA con adaptadores (`supabase/functions/_shared/ai/`): contrato independiente del proveedor y flujo reservar → generar → registrar | 17 de esas pruebas, con proveedor simulado contra las migraciones reales |
| Tipos, análisis estático y compilación | `npm run typecheck`, `npm run lint`, `npm run build` en verde |
| CI en GitHub | Corrió por primera vez el 16/11/2026, en verde en `main` y `staging` |

Tres fallos de la aplicación aparecieron en la prueba de extremo a extremo y están
corregidos (el aviso o la redirección se perdía si la pantalla se refrescaba antes
de acabar la operación): «Perfil guardado» al restaurar una versión, «Archivo
eliminado» al borrar un recurso, y volver al inicio al salir de una organización.

## Probado solo en local

La interfaz de la Fase 1 se ha ejecutado contra un Supabase local, no contra un
proyecto desplegado: falta repetir la comprobación en staging cuando exista
(correo real, dominio, políticas de Auth del proyecto).

## Fase 2: hecho pero sin proveedor ni interfaz

No hay ningún proveedor de IA conectado, ninguna Edge Function que exponga el
servicio y ninguna pantalla: nada de esto sale en el menú. El proveedor simulado
es solo para pruebas. Sin cupo asignado una organización no puede generar. La
prueba de extremo a extremo no ejercita nada de la Fase 2.

Decisiones tomadas de forma provisional, que el dueño puede cambiar: el cupo se
mide en coste (no en piezas), el periodo es el mes natural en UTC, no hay cupo
por defecto y el corte al agotarse es duro.

## Bloqueado por algo externo

| Qué | Qué hace falta |
|---|---|
| Desplegar la Fase 1 y repetir la prueba en staging | Cuenta y proyecto nuevos de Supabase (ver `docs/05-puesta-en-marcha.md`) |
| Publicar la aplicación | Proyecto en Vercel y dominio |
| Envío de invitaciones por correo | Proveedor de correo; hoy el enlace se copia a mano |
| Generar con IA de verdad | Decisión del dueño: proveedor y modelos, moneda de cuenta, cupo mensual por organización (o por plan) y qué pasa al agotarlo |
| Trabajador de medios | Decisión del dueño: dónde alojarlo |
| Publicación real en Instagram (Fase 3) | Verificación de la aplicación de Meta; el plazo lo marca Meta |

## Pendientes conocidos de la Fase 1

- Un logotipo subido en el editor de perfil y no guardado se queda en la
  biblioteca si se cierra o recarga la pestaña (al salir navegando sí se borra).
  Arreglarlo pide una limpieza del lado del servidor.
- Las anotaciones de `storage_cleanup_queue` de marcas ya borradas solo las puede
  barrer el servidor (trabajo de servidor o función con la clave de servicio).
- Una subida cuyo inserto falla y cuyo borrado compensatorio también falla deja
  un archivo sin anotar.
- `test:e2e` no está en el CI: necesita Docker y el stack local de Supabase.
  Haría falta un trabajo aparte con `supabase start` y Playwright.
- Sin pruebas de extremo a extremo en móvil ni en tema oscuro; sin cubrir la
  pestaña «Fuentes», anular invitaciones ni «Añadir miembro» a una marca.
- Las pruebas de componentes simulan Supabase: no cubren RLS real,
  almacenamiento ni correo; la biblioteca no tiene pruebas de componentes.
- Visto una vez un inicio de sesión que se quedó esperando con la máquina muy
  cargada; sin reproducir.
- Guardar ajustes de la organización y datos de la marca usan el mismo patrón
  que causó los tres fallos corregidos; hoy funcionan porque refrescan una sola
  consulta.

## Preguntas para el dueño antes de seguir con la Fase 2

1. Proveedor o proveedores de IA, y modelo para cada tarea (texto, imagen, vídeo).
2. Moneda de cuenta para costes y cupos: euros o dólares.
3. Cupo mensual por organización, y si hay uno por defecto o por plan.
4. Si el cliente ve el límite como presupuesto o como número de piezas o créditos.
5. Mes natural o ciclo de facturación de cada cliente.
6. Al agotarse: corte duro, o exceso permitido con aviso o ampliación de pago.
7. En una agencia, si el editor debe ver el coste de cada generación.
8. Si se guarda el texto generado en el registro, y cuánto tiempo.
9. Dónde se aloja el trabajador de medios.

## Siguiente paso

1. El dueño crea la cuenta y el proyecto de Supabase.
2. Aplicar las 5 migraciones, configurar Auth y desplegar en Vercel.
3. Repetir la prueba de extremo a extremo en staging y corregir lo que aparezca.
4. Fase 2 sin esperar decisiones: contenidos con versiones (`content_items`,
   `content_versions`) y verificador de marca con reglas comprobables sin IA.
5. Con proveedor elegido: adaptador real, Edge Function `ai-generate` que
   verifique la sesión, y registro de modelos y precios (`ai_models`).
6. Iniciar la verificación de la aplicación de Meta.
