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
| 2 | `ai_models`, `ai_generations`, `ai_usage`, `usage_quotas`, `jobs`, `content_items`, `content_versions`, `knowledge_chunks` (vectores) | El consumo es un libro de solo añadir; el cupo se reserva de forma atómica |
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
