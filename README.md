# RRSS

Plataforma SaaS multiempresa para gestionar redes sociales con inteligencia
artificial: una sola aplicación, muchas marcas configurables, sin desarrollo
específico por cliente.

Nace del módulo de redes sociales del panel de Casa Tomás, pero es un producto
independiente: repositorio, base de datos y despliegue propios.

**Estado actual:** Fase 1 (núcleo multiempresa). Ver [docs/ESTADO.md](docs/ESTADO.md).

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ESTADO.md](docs/ESTADO.md) | Qué está implementado, probado, pendiente y bloqueado |
| [docs/00-auditoria-casatomas.md](docs/00-auditoria-casatomas.md) | Auditoría del módulo original: qué se reutiliza y qué no |
| [docs/01-arquitectura.md](docs/01-arquitectura.md) | Arquitectura objetivo y decisiones |
| [docs/02-modelo-de-datos.md](docs/02-modelo-de-datos.md) | Esquema, roles y aislamiento |
| [docs/03-experiencia-de-usuario.md](docs/03-experiencia-de-usuario.md) | Navegación y recorridos |
| [docs/04-plan-por-fases.md](docs/04-plan-por-fases.md) | Fases, criterios de aceptación, riesgos y costes |
| [docs/05-puesta-en-marcha.md](docs/05-puesta-en-marcha.md) | Arranque local y alta de los entornos |

## Tecnología

React + TypeScript + Vite + Tailwind · Supabase (Postgres con RLS, Auth,
Storage) · Vercel.

## Estructura

```
src/                  aplicación (features por área, componentes en components/ui)
supabase/migrations/  esquema, RLS y funciones
supabase/rollbacks/   vuelta atrás de cada migración
supabase/tests/       andamiaje para probar las migraciones fuera de Supabase
tests/db/             pruebas de aislamiento y de migraciones
docs/                 documentación
```

## Órdenes

| Orden | Qué hace |
|---|---|
| `npm run dev` | Aplicación en local |
| `npm run typecheck` | Tipos |
| `npm run lint` | Análisis estático |
| `npm test` | Pruebas unitarias |
| `npm run test:db` | Aislamiento entre empresas y migraciones, contra un Postgres real en memoria |
| `npm run build` | Compilación de producción |
