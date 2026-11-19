# Estado del proyecto

Última actualización: 19/11/2026. Rama de trabajo: `claude/focused-noether-hk502p`,
con PR abierto a `staging`. Las ramas `main` y `staging` existen desde el 16/11/2026.

Resumen: las Fases 1 a 6 están construidas y probadas de extremo a extremo en
local con proveedores **simulados** (IA, Meta, Stripe). Lo que falta para usarlas
de verdad son cuentas y decisiones del dueño, no desarrollo: aplicación de Meta,
proveedor de IA, Stripe, correo y revisión legal. Staging (Supabase gratuito, UE)
tiene las 31 migraciones y todas las funciones desplegadas sin proveedores, y la
aplicación está publicada contra staging en https://rrss-omega.vercel.app.

## Pruebas

| Tanda | Resultado | Qué cubre |
|---|---|---|
| `npm test` | 673 pasan | Lógica (unitarias) e interfaz contra un Supabase simulado (componentes) |
| `npm run test:db` | 628 pasan, 2 omitidas | Esquema, aislamiento entre organizaciones, permisos, planes, cupos, cola, publicación, campañas, analítica, RGPD y servicios con proveedores simulados, contra las migraciones reales (PGlite). Las 2 omitidas son de simultaneidad con dos conexiones (pasaron contra Postgres 16 el 16/11/2026) |
| `worker/` | 73 pasan | Trabajador de medios con FFmpeg real: reels, recortes, extracción de texto de fuentes, informe PDF |
| `agency/` | 37 pasan | Herramienta de la agencia contra un Supabase simulado |
| `npm run test:e2e` | 71 de 71 (local, 19/11/2026) | Navegador (Playwright) contra un Supabase local con las funciones servidas en local, el trabajador real y los proveedores simulados de pruebas: Fases 1 a 6 en 17 archivos |
| CI de GitHub | `comprobar`, `trabajador`, `agencia` y `e2e` | El trabajo `e2e` levanta su propio Supabase y ejecuta la prueba completa; no bloquea el PR hasta verse estable |

## Hecho

### Fase 1 · Núcleo multiempresa
Sesión con confirmación de correo y recuperación de contraseña, organizaciones
(empresa o agencia), asistente de alta de marca, perfil de marca versionado con
exportar e importar, biblioteca, equipo e invitaciones con cinco roles,
aislamiento entre organizaciones, ajustes, actividad y panel de plataforma.

### Fase 2 · Estudio creativo
- **Contenidos y editor por capas** (documento propio v2 + Konva): selección múltiple, alinear, repartir, agrupar, texto sobre el lienzo, guías respecto a otras capas, zonas seguras orientativas por red, vista previa por red, renombrar y cambiar de red; versiones, historial, estados y aprobación.
- **Exportar imagen** (PNG/JPEG) a la biblioteca con procedencia inmutable.
- **Verificador de marca** sin IA (con zonas seguras) y con IA; perfil ampliado (hashtags, llamadas a la acción, emojis).
- **IA de texto e imagen** detrás de adaptadores, con cupo y coste por organización; vídeo con IA apagado por criterio de datos.
- **Reels con plantillas** y **recortes** desde la biblioteca (trabajador con FFmpeg), con cancelar y aviso de peso.
- **Fuentes de marca**: extracción de texto de PDF, Word y webs (con protección SSRF y `robots.txt`) para la propuesta de perfil; **tipografías de marca** en editor, exportación y reels.
- **Modo agencia**: encargos con avisos, entrega desde la herramienta `agency/` o desde la interfaz; el servidor impide la IA de texto en marcas en modo agencia.

### Copiloto por voz del editor (rama `f4/copiloto-voz`, 19/11/2026)
Botón «Dictar» en el editor: cada frase dictada (Web Speech API, es-ES) se
convierte con la IA de texto (tarea `editor.copilot`, esquema estricto y
saneado) en operaciones de capas —foto de fondo difuminada, logotipo, textos
literales con tipografías y colores del perfil— que se aplican al momento y se
deshacen con un solo Ctrl+Z por orden. El documento pasa a la **versión 3**
(desenfoque de imágenes, también en la exportación y en los reels del
trabajador; migración `20261121010000_reel_media_blur.sql`). Interruptor
`VITE_AI_VOICE_COPILOT_ENABLED` además de `VITE_AI_TEXT_ENABLED`. Probado con
el proveedor simulado y una Web Speech API simulada; **sin probar** con un
proveedor real ni con el dictado real. Detalle en `docs/copiloto-voz.md`.

### Fase 3 · Calendario y publicación
Cuentas de Instagram por OAuth (tokens cifrados fuera de `public`), calendario
(mes, semana, día y por red) con arrastrar y soltar y aprobación por lotes,
comentarios en la pieza, y publicador `social-publish` (pg_cron cada minuto)
con cerrojo, idempotencia y reintentos: imagen, carrusel y reel. La base de
datos impide publicar lo no aprobado, incluso con la clave de servicio, y que el
plan no incluya publicación. Detalle en `docs/publicacion.md`.

### Fase 4 · Campañas (primera parte)
«Prepara la semana que viene» → plan explicado (observado / datos / hipótesis) →
borradores, nunca aprobados ni publicados; protegido contra instrucciones
maliciosas en fuentes y perfil; en modo agencia el plan lo entrega la agencia.

### Fase 5 · Analítica
Capturas horarias de métricas de Instagram, panel que separa dato de hipótesis y
dice lo que no se puede medir, interpretación con IA opcional e informe mensual
en PDF generado sin intervención. Detalle en `docs/analitica.md`.

### Fase 6 · Planes, facturación y RGPD
- **Planes como datos** (Prueba, Básico, Profesional, Agencia, Enterprise, Heredado) con límites que impone la base de datos, panel de **margen por cliente**, «Configuración → Plan». Stripe (Checkout, portal y webhook) escrito y probado con Stripe simulado. Detalle en `docs/facturacion.md`.
- **RGPD**: páginas legales como plantillas, consentimiento en el registro, descargar mis datos, exportar la organización, borrar cuenta y organización, registro de tratamientos (`docs/rgpd.md`) y etiqueta «Generado con IA» por pieza.

### Biblioteca con Google Drive (rama `f4/biblioteca-drive`, 19/11/2026)
La organización conecta su Google Drive (OAuth, solo lectura, token de refresco
cifrado como los de Meta) y sus marcas añaden a la biblioteca fotos de Drive **sin
copiarlas a Storage**: el recurso guarda el id del archivo y la imagen la sirve la
función `drive-media` con direcciones firmadas, tras comprobar por RLS que quien la pide
ve la marca. Editor, exportación y trabajador de medios la leen por ahí. No ocupa plan.
Migración `20261122010000` (con vuelta atrás), interruptor `VITE_DRIVE_LIBRARY_ENABLED`.
Probado contra Drive simulado (base de datos y función); la prueba e2e
`19-biblioteca-drive.spec.ts` está escrita y **sin ejecutar**; las fotos HEIC del
iPhone no se pueden usar todavía. Sin desplegar en staging. Detalle en
`docs/biblioteca-drive.md`.

## Sin probar contra el servicio real

| Servicio | Estado | Detalle |
|---|---|---|
| IA de texto (Claude por Vertex UE, Bedrock UE, Mistral, Anthropic directo) | Adaptadores escritos, sin claves | `docs/ia-texto.md` |
| IA de imagen (Vertex UE, FLUX.2, Ideogram, ComfyUI propio) y vídeo (Higgsfield, fal.ai) | Adaptadores escritos, sin claves; vídeo apagado | `docs/ia-medios.md` |
| Meta (OAuth, publicación, métricas) | Adaptador escrito; sin aplicación de Meta | `docs/publicacion.md`, `docs/analitica.md` |
| Stripe | Funciones escritas; sin cuenta | `docs/facturacion.md` |
| Google Drive (OAuth, listar, servir imágenes) | Adaptador escrito; sin cliente OAuth de Google | `docs/biblioteca-drive.md` |

## En staging

Proyecto `zzkdrfhqmjfvrdsoguio`, plan gratuito, región UE:
- 31 migraciones aplicadas; 39 tablas, todas con RLS. Organizaciones existentes en el plan «Heredado».
- Funciones desplegadas sin proveedores: `ai-generate`, `ai-media`, `ai-media-poll`, `ai-media-webhook`, `social-connect`, `social-publish`, `social-insights`, `billing-checkout`, `billing-portal`, `billing-webhook`, `delete-account`, `delete-organization`.
- pg_cron: `rrss-ai-media-poll` (30 s), `rrss-social-publish` (cada minuto), `rrss-analytics` y `rrss-purge-provisional-assets` (cada hora). Faltan a propósito los secretos de Vault (`rrss_project_url`, `rrss_service_role_key`): sin ellos las llamadas programadas solo dejan un aviso.
- Inicio de sesión con retorno a https://rrss-omega.vercel.app y `localhost:5173`.
- Cuentas: la del dueño (superadministrador), una de prueba y la de la agencia (Gestora de Casa Tomás). Casa Tomás está dada de alta en Oficiosos, en modo agencia, con perfil, logotipos y 25 fotos.
- Interruptores de la interfaz apagados: IA de texto e imagen, reels y recortes, publicación y facturación.

## Bloqueado por algo externo

| Qué | Qué hace falta |
|---|---|
| Publicar en Instagram y medir | Aplicación de Meta (tipo Business), verificación de empresa y revisión de permisos; con acceso estándar se puede probar en staging con una cuenta propia |
| IA por API | Cuenta de Google Cloud con Vertex AI en la UE (o la alternativa elegida) y precios confirmados |
| Cobrar | Cuenta de Stripe, moneda, precios por plan y portal configurado |
| Correo para cualquiera (registro, recuperación, invitaciones) | SMTP propio (Resend u otro); hoy solo llega al equipo de Supabase, 2 por hora |
| Reels y recortes en staging | Encender el trabajador contra staging o alojarlo (recomendado: Fly.io en Fráncfort) |
| Fotos de Drive en staging | Cliente OAuth de Google (Drive API, pantalla de consentimiento en producción sin verificar), aplicar la migración `20261122010000` y desplegar `drive-media`; convertir las HEIC a JPEG |
| Clientes reales | Supabase de producción en Pro (copias de seguridad, sin pausas), dominio propio, páginas legales completadas y revisadas por un abogado, contrato de encargo con cada cliente |

## Decisiones del dueño pendientes

1. Moneda de cuenta, precios y límites de los planes (propuesta en `docs/facturacion.md`) y plan por defecto.
2. Proveedor de IA (por defecto, Google Cloud en la UE) y cupo mensual.
3. Activar el vídeo con IA (por defecto, apagado).
4. Alojamiento del trabajador de medios.
5. Música para los reels y su licencia.
6. Plazos de conservación de datos y revisión legal (`docs/rgpd.md`).
7. **Copiloto por voz en modo agencia (provisional).** `ai-generate` rechaza la IA de texto en marcas en modo agencia, salvo el copiloto por voz (`editor.copilot`), que no redacta: coloca literalmente lo dictado. Decidir si se mantiene, se quita o se hace configurable por marca (`docs/copiloto-voz.md` §4).
8. Decisiones provisionales que se pueden cambiar: una aprobación vale solo para la versión aprobada; quien edita y aprueba puede aprobar sin revisión; cada red es una pieza distinta; los colores fuera de la marca avisan pero no bloquean; aceptar un encargo aprueba la versión entregada; logotipos provisionales se borran a las 48 h.

## Pendientes conocidos

- Bajar a un plan sin publicación no detiene lo ya programado.
- Publicación: sin historias de Instagram, sin Facebook, el calendario usa la hora del dispositivo, renovar el token es volver a conectar.
- Si la conexión con Meta falla sin saber la marca, no sale aviso.
- El plan «Prueba» dice «sin IA» pero muestra «Texto con IA (incluido)» (su cupo es 0).
- Exportar en el servidor (el editor exporta en el navegador).
- Sin reconocimiento de texto en escaneos ni imágenes; los reels no usan tipografías .woff.
- Editor: sin ajuste a guías al mover varias capas; zonas seguras solo para 9:16 y orientativas.
- Fase 4: lotes, coordinador y automatizaciones.
- Avisos de encargos por sondeo (60 s), sin tiempo real ni correo.
- El trabajador usa la clave de servicio; falta un rol de Postgres limitado.
- Variables nuevas sin llevar a `.env.example` (documentadas en `docs/`), entre ellas `VITE_AI_VOICE_COPILOT_ENABLED` y `AI_TEXT_EDITOR_COPILOT_*`.
- Copiloto por voz: el dictado de Chrome envía el audio a Google (falta en el registro de tratamientos); la pantalla de reels no ofrece todavía el desenfoque que el plan ya admite.

## Siguiente paso

1. Probar en https://rrss-omega.vercel.app el primer encargo real de Casa Tomás (post del chuletón) y el resto de pantallas con datos reales.
2. El dueño crea la aplicación de Meta, la cuenta de correo y, si quiere IA por API, Google Cloud.
3. Con la aplicación de Meta: conectar la cuenta de Instagram de Casa Tomás en staging y publicar una pieza aprobada.
