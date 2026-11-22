# Cómo trabaja una organización: autogestión o agencia

Rama `f38/autogestion`, 22/11/2026. Migración `20261227010000_work_mode.sql` (vuelta atrás en
`supabase/rollbacks/`). Estado: **implementado y probado en base de datos (Postgres en memoria) y
en componentes; no desplegado ni probado contra un Supabase real ni en un navegador real.**

## 1. Para qué

El producto nació para que una agencia lleve las redes de un cliente (encargos, IA cerrada al
cliente, plantillas «de la agencia», Plataforma). El dueño lo usa como herramienta interna: él y
su equipo lo hacen todo, sin intermediarios. Por eso cada organización elige **cómo trabaja**:

| Modo (`organizations.work_mode`) | Texto en pantalla | Qué es |
| --- | --- | --- |
| `self` | «Lo llevamos nosotros» | Autogestión. Quien edita la marca usa toda la IA directamente; no hay encargos ni agencia |
| `agency` | «Nos lo lleva una agencia» | El flujo de siempre: Encargos, «Pedir a la agencia», selector de modo en cada marca |

- **Organizaciones nuevas:** autogestión; salvo las que se crean como «Agencia» en la pantalla de
  bienvenida (`kind = 'agency'`), que nacen en modo agencia.
- **Existentes (migración):** autogestión, salvo las de `kind = 'agency'`, que siguen en modo agencia.
  Las marcas en modo agencia de una organización que pasa a autogestión vuelven a `ai_mode = 'api'`.
- **Dónde se cambia:** Configuración → General → «Cómo trabajáis» (propietarios y administradores de
  la organización; es la política `organizations_update` de siempre y un privilegio de columna nuevo).
  Pasar a autogestión pide confirmación; pasar a agencia se guarda al momento.
- El cambio queda en el registro de actividad (el disparador de auditoría de `organizations`).

## 2. Cómo se garantiza sin tocar las funciones de IA

La IA de texto, imagen, vídeo y «reel como este» siguen mirando `brands.ai_mode` (`agency_mode`).
En vez de reescribirlas, la base de datos mantiene esta regla: **en una organización en autogestión
ninguna marca puede estar en `ai_mode = 'agency'`**.

- Disparador `brands_ai_mode_guard` (antes de insertar o cambiar `ai_mode` u `organization_id`):
  rechaza `agency` en una organización `self` (`P0001`, «lleva las redes por su cuenta»).
- Disparador `organizations_work_mode` (después de cambiar `work_mode`): al pasar a `self`, las
  marcas en `agency` vuelven a `api`.
- Los **encargos abiertos no se tocan**: quedan guardados y reaparecen si la organización vuelve
  al modo agencia. Mientras tanto no se ven.

Resultado: en autogestión `ai-generate`, `ai-media`, `ai-reel-like`, el copiloto y las campañas por
IA funcionan para quien puede editar la marca, siempre dentro del cupo, los permisos y el plan
existentes (el cupo de IA, la reserva y el coste no cambian).

## 3. Qué cambia en pantalla

| Pantalla | Autogestión | Modo agencia |
| --- | --- | --- |
| Menú de la marca | Sin «Encargos». `/encargos` y `/encargos/:id` llevan al inicio de la marca | Igual que antes |
| Marca → Datos de la marca | No sale «Redacción con IA / Quién redacta» | Sale |
| Configuración → General | Sin el selector «Tipo» (empresa o agencia); tarjeta «Cómo trabajáis» | Con «Tipo» y «Cómo trabajáis» |
| Marca → Identidad visual → Plantillas | Botón «Cargar plantillas del catálogo»; las manuales se llaman «Nuestra» | Sin botón (la carga se hace con la herramienta de la agencia); «De la agencia» |
| Contenidos → «Desde una plantilla» | «Nuestra», «Propuesta:», textos de ayuda sin agencia | «De la agencia» y textos de siempre |
| Conexión avanzada de Instagram (token) | «Conexión avanzada (con clave)» y sin hablar de agencias | «Conexión avanzada (agencia)» |
| Configuración → Consumo de IA | Además, «Gasto del mes» (solo propietario) | Igual que antes |
| Inicio de organización | «Las marcas de X» | «Las marcas que gestiona X» si es de tipo agencia |

Textos como «Pedir a la agencia» o «lo hace la agencia» solo aparecen con una marca en modo agencia
(`brand.ai_mode = 'agency'`), así que en autogestión no salen.

**Encargos → «Tareas»: no se hizo.** Reconvertirlo a tareas internas (asignar a alguien del equipo,
estados, avisos) no es trivial: los encargos tienen su ciclo (pedido, en curso, entregado, cambios,
aceptado), el cerrojo de la herramienta de la agencia, comentarios y avisos. Se oculta y queda
anotado como pendiente.

## 4. Lo que hoy es de superadministrador y qué se abrió

Revisado caso por caso. **Abierto** quiere decir que ahora lo puede hacer el propietario (o quien
edita la marca) de su organización en autogestión, y solo de la suya.

| Capacidad | Antes | Ahora | Cómo |
| --- | --- | --- | --- |
| Cargar el catálogo de plantillas en una marca | Solo la herramienta `agency/` (con un usuario que edita la marca) | **Abierto** a quien edita la marca, desde Marca → Plantillas | `deliver_design_templates` y `deliver_reel_templates` ya exigían «editar la marca»; no hay migración ni permiso nuevo. El catálogo va empaquetado en la app (trozo que se baja al abrir el diálogo) |
| Ver el gasto de su organización | Solo «Gasto y uso» de la plataforma (todas las organizaciones) | **Abierto** al propietario en autogestión | Función nueva `org_usage_overview(org, mes)`: solo la organización pedida; la ven los superadministradores y el **propietario** de una organización en `self`. No la ven administradores, editores, otras organizaciones ni una organización en modo agencia |
| Conectar Instagram con un token («conexión avanzada») | Ya estaba abierto a quien gestiona la marca (solo parecía de agencias por el texto) | Sin cambio de permisos; texto neutro | Sin migración |
| Cambiar el modo de trabajo | No existía | Propietarios y administradores de la organización | `grant update (work_mode)` + `organizations_update` |
| **No se abre**: claves e integraciones (Plataforma → Integraciones), cupos (`admin_set_ai_quota`), planes y precios, avisos y tope global, lista de todas las organizaciones, modelos y precios de IA | Superadministrador | Sigue igual | Son de la instalación entera, no de una organización. Si la instalación es del dueño, él es superadministrador y las tiene en Plataforma |

Se pide «propietario» y no «administrador» para el gasto porque es coste real de proveedor; en modo
agencia lo ve la plataforma, no el cliente.

## 5. Catálogo de plantillas en la aplicación

`agency/catalogo/construir.ts` (nuevo, puro: sin red ni archivos) monta y valida un juego con el
tema de la marca; lo usan la herramienta de la agencia (con los estilos de reel leídos de
`worker/templates/`) y la aplicación (`src/features/brand/CatalogDialog.tsx`, con los estilos de
`REEL_TEMPLATES`). La aplicación importa `agency/catalogo/*.ts` directamente
(`allowImportingTsExtensions` en `tsconfig.app.json`), sin copiar código. El diálogo ofrece los
cuatro juegos (restaurante o asador, coctelería, gimnasio, genérico), usa los colores y tipografías
del perfil activo (neutros si no hay perfil, con aviso) y guarda 10 de reel y 10 de publicación o
carrusel. Volver a cargar el mismo juego actualiza las mismas plantillas (misma clave).
Los textos del catálogo dicen «catálogo de plantillas», no «de la agencia».

## 6. Pruebas

- Base de datos (`tests/db/aislamiento.test.ts`, «modo de trabajo de la organización»): valores por
  defecto, quién cambia el modo, rechazo de `agency` en autogestión (con y sin API), retorno de las
  marcas a `api`, auditoría, `org_usage_overview` (propietario sí; administrador, editor, ajeno,
  anónimo, otra organización y modo agencia no; superadministrador sí) y permisos de entrega del
  catálogo. `createOrg` de `tests/db/helpers.ts` deja por defecto la organización en modo agencia
  (las pruebas anteriores lo suponen); las de autogestión piden `'self'` o `'default'`.
- Componentes (`src/features/orgs/autogestion.test.tsx`): menú, redirección de Encargos, selector
  de modo de la marca, tarjeta «Cómo trabajáis», etiquetas «Nuestra» / «De la agencia», carga del
  catálogo y gasto. `seedWorkspace` acepta `workMode` (por defecto `agency`, como asumían las
  pruebas anteriores).
- e2e: `12-modo-agencia-encargos` pasa antes la organización a modo agencia desde Configuración.
  **No se ha ejecutado** (necesita Supabase local).

## 7. Pendiente y no probado

- Aplicar la migración en staging (y después producción, con el «sí» del dueño); no hay funciones
  que redesplegar (`ai-*` no cambian).
- Tras migrar, una organización de tipo agencia que el dueño use como propia debe pasarse a
  «Lo llevamos nosotros» en Configuración (un clic).
- Una organización de tipo empresa que elija «Nos lo lleva una agencia»: el personal de la agencia
  para la IA de imagen (`ai_brand_access`) se sigue calculando por `kind = 'agency'` o por
  superadministrador; sin una organización de agencia dueña de la marca, solo los superadministradores
  usan la imagen con IA en una marca en modo agencia.
- Campañas pedidas a la agencia y aún abiertas al pasar a autogestión quedan con su texto de agencia.
- «Tareas» internas en lugar de Encargos (§3).
- `scripts/crear-marca-agencia.sql` falla en una organización en autogestión (a propósito).
- El diálogo del catálogo y el cambio de modo, sin ver en un navegador real ni en 375 px.
