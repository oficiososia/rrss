# Modelo de datos y multi-tenancy

Fuente de verdad: `supabase/migrations/`. Este documento explica el porqué.

## 1. Lo que existe (Fase 1)

```
auth.users ──1:1── profiles
     │
     ├── platform_admins                    superadministradores (alta manual)
     │
organizations ──< organization_members >── auth.users        rol: owner | admin | member
     │
     ├──< invitations                       token de un solo uso (solo se guarda su huella)
     ├──< audit_logs                        quién hizo qué (sin FK: sobrevive a lo auditado)
     │
     └──< brands ──< brand_members >── organization_members   rol: manager | editor | reviewer | client | viewer
              │
              ├──< brand_profiles           perfil de marca versionado (una versión vigente)
              ├──< brand_knowledge_sources  manual, documentos, web
              └──< media_assets             biblioteca
```

| Tabla | Para qué | Cómo se escribe |
|---|---|---|
| `profiles` | Nombre, correo e idioma de cada usuario | La crea un disparador al registrarse; cada uno edita la suya |
| `platform_admins` | Quién administra la plataforma | Solo con la clave de servicio |
| `organizations` | Empresa o agencia | `create_organization()`; los administradores editan nombre y ajustes |
| `organization_members` | Pertenencia y rol | Solo por RPC: `accept_invitation`, `set_member_role`, `remove_member` |
| `brands` | Marca gestionada | Insertan los administradores; edita quien gestiona la marca; se archivan, no se borran |
| `brand_members` | Rol de un miembro en una marca | Quien gestiona la marca |
| `brand_profiles` | Identidad, voz, público, reglas | Solo `save_brand_profile()`: cada guardado es una versión nueva |
| `brand_knowledge_sources` | Material del que aprende la IA | Quien gestiona la marca |
| `media_assets` | Fotos, vídeos, logotipos, documentos | Quien edita la marca |
| `invitations` | Altas pendientes | `create_invitation`, `revoke_invitation` |
| `audit_logs` | Registro de actividad | Solo disparadores |

## 2. Cómo se garantiza el aislamiento

1. **RLS en todas las tablas.** Una prueba falla si aparece una tabla sin RLS o
   sin estar cubierta por las pruebas de aislamiento.
2. **`anon` no tiene nada**: ni tablas ni funciones.
3. **Privilegios por columna.** El cliente no puede, por ejemplo, cambiar el
   `organization_id` de una marca ni el correo de un perfil, aunque la política
   de fila se lo permitiera.
4. **Claves foráneas compuestas** `(brand_id, organization_id)`: un recurso no
   puede declararse de una organización distinta a la de su marca.
5. **Rutas de almacenamiento verificadas**: `<organization_id>/<brand_id>/…`. La
   política extrae la marca de la ruta y comprueba que pertenece a esa
   organización y que el usuario tiene permiso. La tabla exige además que la
   ruta guardada empiece por esos dos identificadores.
6. **Privilegios por defecto cerrados**: una tabla o función nueva nace sin
   acceso; cada migración debe conceder lo que necesite.

## 3. Matriz de permisos por rol de marca

Definida en un único sitio: `private.brand_role_grants`.

| Capacidad | manager | editor | reviewer | client | viewer |
|---|---|---|---|---|---|
| `view` ver | ✓ | ✓ | ✓ | ✓ | ✓ |
| `comment` comentar | ✓ | ✓ | ✓ | ✓ | — |
| `approve` aprobar | ✓ | — | ✓ | ✓ | — |
| `edit` crear y editar | ✓ | ✓ | — | — | — |
| `manage` configurar marca y equipo | ✓ | — | — | — | — |

Los `owner` y `admin` de la organización actúan como `manager` de todas sus
marcas. Un `member` solo ve las marcas donde tiene rol.

Reglas de organización: solo un propietario nombra o toca a otro propietario;
una organización nunca se queda sin propietario; una invitación solo la acepta
la cuenta cuyo correo coincide, y nunca cambia el rol de quien ya era miembro.

## 4. Rendimiento de las políticas

Las políticas tienen la forma `brand_id in (select private.brand_ids_with('view'))`.
Postgres evalúa la subconsulta **una vez por sentencia**, no una vez por fila, y
las tablas tienen índice por `brand_id`. Es lo que permite listas de cientos de
miles de filas sin que la seguridad sea el cuello de botella.

Una función `STABLE` no ve lo que inserta su propia sentencia; por eso la
política de lectura de `brands` tiene una primera condición que no consulta
`brands` (necesaria para `INSERT … RETURNING`).

## 5. Perfil de marca

`brand_profiles.data` es un JSON validado en el cliente (`schema_version`) con:
negocio, público, objetivos, voz, identidad visual, canales, idiomas,
competidores, referencias y restricciones. `provenance` registra el origen de
cada sección (usuario, importación, IA) y si está verificada: la IA puede
proponer, pero **nada inferido se convierte en regla hasta que alguien lo valida**.

Se guarda como JSON versionado y no como columnas porque la forma del perfil va
a evolucionar con el producto; el número de versión del esquema permite migrar
perfiles antiguos sin migraciones de base de datos.

## 6. Configuración exportable

`{ format: "rrss.brand-config", version: 1, brand: {…}, profile: {…} }`. Sirve
para dar de alta marcas en bloque, hacer copias y mover una marca entre
entornos. No incluye archivos ni miembros.

## 7. Lo que se añadirá (diseño previsto, sin implementar)

| Fase | Entidades | Notas |
|---|---|---|
| 2 | `ai_models`, `content_items`, `content_versions`, `knowledge_chunks` (vectores) | **Ya existen** `ai_generations`, `ai_usage`, `usage_quotas` y `jobs` (secciones 9 y 10). `ai_models` (registro de modelos y precios como dato) espera a que se elija proveedor: hoy los modelos son configuración del servicio |
| 3 | `social_accounts`, `social_account_secrets` (cifrada, sin acceso desde el cliente), `campaigns`, `scheduled_publications`, `publication_attempts`, `approvals`, `comments` | El calendario es una vista de `scheduled_publications`, no una tabla |
| 4 | `automations`, `automation_runs`, `agent_runs`, `agent_steps` | Cada paso reanudable |
| 5 | `analytics_snapshots` (particionada por fecha) | Datos tal como los da cada red, con su procedencia |
| 6 | `plans`, `subscriptions`, `entitlements`, `feature_flags`, `notification_events` | Suscripción (Stripe), derechos y consumo, separados |

De la lista inicial del encargo se han fusionado o cambiado:

- `brand_guidelines` → es `brand_profiles` (el manual se convierte en perfil
  estructurado; el archivo original es una `brand_knowledge_source`).
- `organization_settings` → columna `settings` de `organizations` mientras sean
  pocos ajustes.
- `social_account_permissions` → los permisos van por marca (`brand_members`);
  una cuenta social pertenece a una marca.
- `media_asset_versions` y `content_variants` → llegarán con el editor, como
  versiones del documento.
- `editorial_calendars` → vista sobre las publicaciones programadas.
- `approval_workflows` → `approvals` por pieza; las reglas (quién debe aprobar)
  son configuración de la marca.

## 8. Reglas para nuevas migraciones

- Una migración por cambio, con su vuelta atrás en `supabase/rollbacks/`.
- Tabla nueva → RLS, políticas, privilegios explícitos y casos en
  `tests/db/aislamiento.test.ts` (la prueba de catálogo obliga).
- Función `SECURITY DEFINER` → `set search_path = ''` y nombres completos.
- Nada destructivo sin plan de recuperación aprobado.

## 9. Fase 2 (cimientos): consumo y cupos de IA

Implementado y probado en base de datos; **sin interfaz y sin proveedor real**.

```
organizations ──< usage_quotas            límite por organización y métrica
brands ──< ai_generations                 una fila por llamada a un proveedor
            ·····  ai_usage               libro de consumo (sin FK: sobrevive al borrado)
```

| Tabla | Para qué | Quién la lee | Cómo se escribe |
|---|---|---|---|
| `usage_quotas` | Cupo mensual de IA de la organización (`ai_cost_micros`) | Administradores de la organización | `admin_set_ai_quota()` (superadministrador, auditado) o la clave de servicio |
| `ai_generations` | Tarea, propósito, proveedor, modelo, consumo, coste, latencia, estado, error y resultado | Quien puede crear contenido en la marca (`edit`) | Solo las tres funciones de abajo |
| `ai_usage` | Libro de consumo de solo añadir | Administradores de la organización | Solo las tres funciones de abajo |

**Unidades.** Todos los importes son enteros en millonésimas («micros») de la
moneda de cuenta de la plataforma. La moneda es una sola y no se guarda: es una
decisión pendiente del dueño (ver `docs/ESTADO.md`).

**Ciclo de una generación** (lo ejecuta el servidor con la clave de servicio,
indicando en nombre de qué usuario):

1. `ai_reserve_generation(usuario, marca, tarea, propósito, proveedor, modelo,
   reserva, caducidad)` comprueba que el usuario puede crear contenido en la
   marca, **bloquea la fila del cupo** de la organización, devuelve las reservas
   caducadas, suma lo comprometido en el mes y, si la reserva cabe, crea la
   generación (`reserved`) y apunta `reserve +reserva`. Si no cabe falla con
   `AI001` y un mensaje para personas; sin cupo asignado, con `AI002`.
2. `ai_complete_generation(id, coste, consumo, resultado, latencia)` apunta
   `settle −reserva +coste` y la deja `succeeded`.
3. `ai_fail_generation(id, código, mensaje)` apunta `release −reserva` y la deja
   `failed`: **un fallo del proveedor no consume cupo**.

Decisiones que conviene conocer:

- **Cupo comprometido** del mes = suma de `reserved_delta_micros +
  cost_delta_micros` del libro. Las reservas en curso cuentan: por eso la
  reserva es una cota superior del coste, no una estimación optimista.
- **Simultaneidad.** El bloqueo de la fila de `usage_quotas` serializa las
  reservas de una organización; las de organizaciones distintas no se estorban.
- **Sin cupo asignado no se genera.** No hay cupo por defecto: lo fijará el plan
  (Fase 6) o un superadministrador.
- **Periodo**: mes natural en UTC. Una generación se imputa al mes en que se
  reservó.
- **Reservas huérfanas.** Si el servidor muere a media llamada, la reserva
  caduca (`expired`) y su cupo se devuelve en la siguiente reserva de esa
  organización, sin depender de un reloj. Si el proveedor acaba respondiendo
  tarde, el coste se apunta igualmente: el gasto es real.
- **El coste real puede superar la reserva** (el libro dice la verdad); lo que
  no puede es empezar otra generación sin saldo.
- **Ni la clave de servicio escribe a mano** `ai_generations` ni `ai_usage`:
  solo tiene `select`. Todo pasa por las funciones.
- **Coste por organización**: `ai_cost_by_organization(desde, hasta)` suma los
  apuntes `settle` del libro. Un administrador ve las organizaciones que
  administra; un superadministrador, todas (también las borradas, sin nombre).
  Para desgloses (por marca, por mes) los administradores consultan `ai_usage`.

Pendiente en este bloque: valoración del usuario por generación, clave de
idempotencia y caché de peticiones idénticas, modelo alternativo si falla,
registro de modelos como dato (`ai_models`) y cupos por métricas distintas del
coste.

## 10. Fase 2 (cimientos): cola de trabajos

Implementada y probada en base de datos; **todavía no hay ningún trabajador ni
ningún tipo de trabajo en uso**.

`jobs`: organización, marca (opcional), tipo (`kind`, texto libre), carga,
estado (`queued`, `running`, `succeeded`, `failed`, `cancelled`), prioridad,
clave de idempotencia (única por organización), intentos y máximo, `run_after`,
reserva (`locked_by`, `locked_until`), resultado y último error.

| Función (solo clave de servicio) | Qué hace |
|---|---|
| `enqueue_job` | Encola; con una clave ya usada devuelve el trabajo existente sin tocarlo |
| `claim_jobs(trabajador, tipos, límite, segundos)` | Reclama con `FOR UPDATE SKIP LOCKED` por prioridad y antigüedad; recoge también los trabajos en curso con la reserva caducada, y cierra como fallidos los caducados sin intentos |
| `complete_job` / `fail_job` | Solo quien tiene la reserva. Un fallo vuelve a la cola con espera creciente (30 s, 1 min, 2 min… hasta 1 h) y, agotados los intentos, queda `failed` con su error |
| `cancel_job` | Cancela un trabajo en cola o en curso |

Lectura: los trabajos de una marca los ve quien ve la marca; los de toda la
organización, sus administradores. Nadie los escribe desde el cliente.

Pendiente: alta en la publicación de Realtime (se hará en el entorno desplegado),
renovación de la reserva para trabajos largos, limpieza de trabajos antiguos y
prioridad por plan.
