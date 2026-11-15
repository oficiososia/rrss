# Estado del proyecto

Última actualización: 15/11/2026. Rama de trabajo: `claude/focused-noether-hk502p`.

## Hecho y comprobado

| Qué | Cómo se ha comprobado |
|---|---|
| Fase 0: auditoría, arquitectura, modelo de datos, diseño y plan | Documentos en `docs/` |
| Esquema multiempresa (organizaciones, marcas, roles, perfil versionado, fuentes, biblioteca, invitaciones, auditoría, cubo privado) | 34 pruebas de aislamiento y permisos (`npm run test:db`), en PGlite y en Postgres 16 |
| Vuelta atrás de cada migración | 2 pruebas: deshacer deja la base limpia y se puede reaplicar |
| Lógica de la aplicación (perfil, exportar e importar, completitud, nombres de archivo, permisos por rol, mensajes de error) | 56 pruebas unitarias (`npm test`) |
| Tipos, análisis estático y compilación | `npm run typecheck`, `npm run lint`, `npm run build` en verde |

## Hecho pero SIN probar de extremo a extremo

Toda la interfaz de la Fase 1: sesión, crear organización, asistente de marca,
perfil de marca con versiones, biblioteca, equipo e invitaciones, ajustes,
actividad y panel de plataforma. Está escrita contra el esquema real y compila,
pero **no se ha ejecutado contra un backend**: solo se ha visto en navegador que
arranca, que redirige a iniciar sesión y que las pantallas de acceso se dibujan
bien en claro, oscuro, escritorio y móvil.

Motivo: todavía no existe el proyecto nuevo de Supabase y en el entorno de
desarrollo no se pudo levantar una API local equivalente.

## Bloqueado por algo externo

| Qué | Qué hace falta |
|---|---|
| Desplegar y probar la Fase 1 | Cuenta y proyecto nuevos de Supabase (ver `docs/05-puesta-en-marcha.md`) |
| Publicar la aplicación | Proyecto en Vercel y dominio |
| Envío de invitaciones por correo | Proveedor de correo; hoy el enlace se copia a mano |

## Pendientes conocidos de la Fase 1

- Prueba de extremo a extremo en navegador (dos empresas, tres roles) en cuanto
  haya entorno.
- Recuperación de contraseña: depende del correo de Supabase; sin probar.
- Subida: progreso por estados, no por porcentaje.
- Al borrar un recurso se borra la fila y luego el archivo; si falla lo segundo
  queda un archivo huérfano (falta una limpieza periódica).
- Un logotipo subido sin guardar después el perfil queda en la biblioteca sin
  enlazar.
- Filtros de etiqueta y carpeta calculados sobre los 1.000 recursos más recientes.
- Sin pruebas de componentes (solo lógica pura).
- CI definido en `.github/workflows/ci.yml`; aún no ha corrido en GitHub.
- Ramas `main` y `staging` sin crear: el repositorio solo tiene la rama de trabajo.

## Siguiente paso

1. El dueño crea la cuenta y el proyecto de Supabase.
2. Aplicar migraciones, configurar Auth y desplegar en Vercel.
3. Prueba de extremo a extremo y corrección de lo que aparezca.
4. Decisiones previas a la Fase 2: proveedor de IA y presupuesto, alojamiento
   del trabajador de medios, e iniciar la verificación de la aplicación de Meta.
