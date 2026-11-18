# Estado del proyecto

Última actualización: 18/11/2026. Rama de trabajo: `claude/focused-noether-hk502p`,
con PR abierto a `staging`. Las ramas `main` y `staging` existen desde el 16/11/2026.

Resumen: la Fase 1 está terminada y probada de extremo a extremo en local. La
Fase 2 está construida y probada con proveedores **simulados**: contenidos y
editor, verificador de marca, IA de texto e imagen, exportar imagen, reels con
plantillas y modo agencia con encargos. Falta conectar proveedores reales, que
dependen de cuentas y decisiones del dueño (ver `docs/06-decisiones-fase-2.md`).
El proyecto de Supabase de staging (plan gratuito, UE) tiene las 12 migraciones,
el inicio de sesión configurado y las funciones desplegadas sin proveedor de IA
(detalle en `docs/05-puesta-en-marcha.md`). La aplicación no está publicada.

## Hecho y comprobado

### Pruebas

| Tanda | Resultado | Qué cubre |
|---|---|---|
| `npm test` | 508 pruebas | Lógica (unitarias) e interfaz contra un Supabase simulado (componentes) |
| `npm run test:db` | 423 pasan, 2 omitidas | Esquema, aislamiento entre organizaciones, permisos, cupos, cola, contenidos, encargos, servicio de IA con proveedores simulados, contra las migraciones reales (PGlite). Las 2 omitidas son de simultaneidad con dos conexiones: pasaron contra Postgres 16 el 16/11/2026 y en CI quedan omitidas |
| `worker/` | 38 pruebas | Trabajador de medios con FFmpeg real; también dentro del contenedor |
| `agency/` | 32 pruebas | Herramienta de la agencia contra un Supabase simulado |
| `npm run test:e2e` | 57 de 57 | Navegador (Playwright) contra un Supabase local, con las funciones servidas en local, el proveedor simulado y el trabajador real: 39 escenarios de la Fase 1, 8 de la Fase 2, 3 de imagen con IA, 1 de reels y 6 del modo agencia |
| Tipos, lint y compilación | En verde | `npm run typecheck`, `npm run lint`, `npm run build` |

`test:e2e` no corre en el CI: necesita Docker y el stack local de Supabase
(cómo lanzarla, en `docs/05-puesta-en-marcha.md`).

### Fase 1 · Núcleo multiempresa

Sesión con confirmación de correo y recuperación de contraseña, organizaciones
(empresa o agencia), asistente de alta de marca, perfil de marca versionado con
exportar e importar, biblioteca (progreso real de subida, limpieza de archivos
huérfanos, filtros completos), equipo e invitaciones con cinco roles,
aislamiento entre organizaciones (por URL, API y archivo), ajustes, actividad y
panel de plataforma. Probado de extremo a extremo en local.

### Fase 2 · Estudio creativo con IA

| Qué | Estado |
|---|---|
| **Contenidos**: sección en el menú de la marca, piezas con versiones inmutables y numeradas, aviso si otra persona guardó antes, historial con vista previa y restauración, estados (idea, borrador, en revisión, aprobada) según el rol, archivado | Probado de extremo a extremo |
| **Editor por capas** (documento propio + Konva): imagen de la biblioteca, texto, logotipo y formas; mover, redimensionar, girar, guías, deshacer; cambio de proporción con adaptación automática; texto de la publicación con contadores frente a la red; teclado y móvil | Probado de extremo a extremo |
| **Exportar imagen** desde el editor: PNG o JPEG a tamaño real o doble, descarga y/o recurso en la biblioteca (carpeta «Exportaciones») con procedencia inmutable (`media_assets.provenance`: pieza, versión, opciones); avisa de cambios sin guardar y explica qué imagen impide exportar | Probado en componentes y base de datos; dibujo comprobado a mano en navegador |
| **Catálogo de redes**: 8 redes y 13 formatos, cada límite marcado como oficial o sin verificar | Probado |
| **Verificador de marca sin IA**: longitud, hashtags, menciones, palabras vetadas, hashtags obligatorios, llamada a la acción, contraste, colores frente a la marca, emojis, legibilidad, texto alternativo; panel dentro del editor que lleva a la capa o al fragmento señalado | Probado de extremo a extremo |
| **Perfil de marca ampliado**: hashtags obligatorios y recomendados, llamadas a la acción y política de emojis (los perfiles antiguos siguen leyéndose) | Probado |
| **IA de texto**: redactar la publicación con variantes, comprobación de tono con IA («dudoso: que lo revise una persona») y propuesta de perfil desde fuentes de texto; función `ai-generate` con sesión, permisos, cupo y coste | Probado de extremo a extremo con el proveedor simulado |
| **Imagen con IA en el editor** («Añadir → Con IA»): encargo, proporción, referencias de la biblioteca, modelo y coste máximo antes de generar; síncrona o asíncrona (sondeo `ai-media-poll` cada 30 s con pg_cron y pg_net, y avisos firmados en `ai-media-webhook`). Entra como capa que se deshace y queda en la biblioteca con procedencia `ai_generation`, que solo puede escribir el servidor | Probado de extremo a extremo con la imagen simulada |
| **Reels desde la biblioteca** («Montar un reel»): fotos y clips de la marca, una plantilla, textos con su momento y música. Se encarga con `request_media_job` (sin clave de servicio, solo recursos de la marca, ruta de salida fijada por la base de datos, máximo 5 en marcha por marca); lo monta el trabajador y un disparador lo da de alta en la biblioteca con procedencia `media_job` | Probado de extremo a extremo con el trabajador real y FFmpeg |
| **Modo agencia con encargos**: cada marca elige cómo se redacta (`brands.ai_mode`: servicio de IA o «la agencia, por encargo»). El cliente pide desde «Encargos»; la agencia, con una sesión de Claude Code y la herramienta `agency/` (entra como un usuario normal con rol de editor, nunca con la clave de servicio), toma con cerrojo, prepara el contexto, comprueba con el verificador y entrega un borrador; el cliente pide cambios o acepta, y aceptar aprueba exactamente la versión entregada. En modo agencia el editor ofrece «Pedir a la agencia» en vez de «Redactar con IA» | Probado de extremo a extremo |
| **Cupo y coste**: cupo mensual por organización impuesto por la base de datos; un cupo agotado detiene la generación con un mensaje claro sin llamar al proveedor; página «Consumo de IA» para administradores; asignación del cupo en Plataforma | Probado de extremo a extremo |
| **Vídeo generativo**: contrato y adaptadores | Probado en base de datos; sin exponer (apagado por criterio de datos) |
| **Trabajador de medios** (`worker/`, Node + FFmpeg en contenedor): reels verticales, fotos a los cuatro formatos, póster y versión comprimida. Un reel de 10 s en 1080×1920 se monta en unos 8 s | Probado con FFmpeg real y dentro del contenedor |
| **Cola de trabajos**: reservas con caducidad, reintentos, cancelación, devolver un trabajo sin gastar intento y renovar la reserva | Probado |

Una sola unidad para contar el texto (UTF-16, la más estricta) en el editor, la
IA, el verificador y el servidor: un emoji puede contar 2 y la interfaz lo dice.

Interruptores de la interfaz (lo que no funciona no sale): `VITE_AI_TEXT_ENABLED`
(texto con IA), `VITE_AI_IMAGE_ENABLED` (imagen con IA) y
`VITE_MEDIA_WORKER_ENABLED` (reels). Hoy ninguno está activo en staging.

## Adaptadores escritos y SIN probar contra el servicio real

Escritos contra la documentación oficial, probados solo con respuestas
simuladas. Se activan por configuración del servidor; sin clave no aparecen.

| Servicio | Adaptadores | Detalle |
|---|---|---|
| Texto | Claude por Google Vertex AI en la UE (recomendado), Claude por Amazon Bedrock en la UE, Mistral, Claude por API directa (no procesa en la UE: exige permiso expreso) | `docs/ia-texto.md` |
| Imagen | Google Vertex AI en la UE (recomendado), FLUX.2 de Black Forest Labs, Ideogram, ComfyUI propio con FLUX.2 Klein 4B (modelo abierto; probado a mano en Google Colab, sin conectar a la aplicación) | `docs/ia-medios.md` |
| Vídeo con IA | Higgsfield, fal.ai. Apagado por defecto: ningún proveedor tiene región UE verificada | `docs/ia-medios.md` |

## En staging

Proyecto `zzkdrfhqmjfvrdsoguio`, plan gratuito, región UE (18/11/2026):
- 12 migraciones aplicadas; 21 tablas, todas con RLS.
- Inicio de sesión: confirmación de correo, contraseña de 8 o más, retorno a `http://localhost:5173`.
- Funciones desplegadas sin proveedor: `ai-generate`, `ai-media`, `ai-media-poll`, `ai-media-webhook`. Responden 401/400 sin credenciales.
- pg_cron y pg_net disponibles en el plan gratuito; programada `rrss-ai-media-poll` cada 30 s. Faltan a propósito los secretos de Vault (`rrss_project_url`, `rrss_service_role_key`) hasta que haya un proveedor asíncrono: sin ellos el sondeo solo deja un aviso.
- Cuentas: la del dueño (superadministrador) y una de prueba creada confirmada.
- La aplicación se arranca en local contra staging con `npm run dev:staging`.

La prueba de extremo a extremo no se puede repetir allí tal cual: el correo
integrado del plan gratuito solo envía a miembros del equipo de Supabase y 2
correos por hora; hace falta un SMTP propio.

## Bloqueado por algo externo

| Qué | Qué hace falta |
|---|---|
| Repetir las pruebas en staging | SMTP propio (el correo integrado del plan gratuito solo envía al equipo y 2 por hora). El plan gratuito tampoco admite archivos de más de 50 MB ni la protección contra contraseñas filtradas |
| Publicar la aplicación | Proyecto de Vercel de pago y dominio |
| Generar con IA de verdad | Cuenta de Google Cloud con Vertex AI en la UE (o la alternativa que se elija) y precios confirmados; o, para imagen en pruebas, el cuaderno de Colab con un túnel con autenticación |
| Reels en staging | Encender el trabajador contra staging (`npm run start:staging` en `worker/`, sin probar) o desplegarlo (alojamiento sin decidir) |
| Modo agencia en staging | Dar de alta la cuenta de la agencia y sus credenciales (`agency/README.md`) |
| Invitaciones por correo | Proveedor de correo; hoy el enlace se copia a mano |
| Publicación real en Instagram (Fase 3) | Verificación de la aplicación de Meta; el plazo lo marca Meta |

## Decisiones del dueño pendientes

Cada una tiene su opción por defecto en `docs/06-decisiones-fase-2.md`.

1. Protección de datos: procesar en la UE (por defecto) o aceptar contrato de tratamiento sin entrenamiento.
2. Moneda de cuenta para costes y cupos (hoy se muestran como «unidades de cuenta»; se fija con `VITE_AI_ACCOUNT_CURRENCY`).
3. Cupo mensual por marca u organización (propuesta: 45 USD por marca activa).
4. Activar el vídeo con IA (por defecto, apagado).
5. Alojamiento del trabajador de medios.
6. Música para los reels y su licencia; si las marcas subirán su tipografía.
7. Prueba ciega de calidad con encargos reales antes de fijar proveedores (tope propuesto: 100 USD).
8. Consulta a un abogado sobre el etiquetado de contenido generado con IA (marcado legible por máquina desde el 02/12/2026, según fuente secundaria).
9. Decisiones provisionales que se pueden cambiar: una aprobación vale solo para la versión aprobada; quien edita y aprueba puede aprobar sin revisión; cada red es una pieza distinta; los colores fuera de la marca avisan pero no bloquean; aceptar un encargo aprueba la versión entregada.

## Pendientes conocidos

**Fase 1**
- Un logotipo subido en el editor de perfil y no guardado se queda en la biblioteca si se cierra o recarga la pestaña.
- Las anotaciones de limpieza de marcas ya borradas solo las puede barrer el servidor.
- Sin pruebas de extremo a extremo en móvil ni en tema oscuro.

**Fase 2**
- Exportar en el servidor (trabajador): requiere skia-canvas, tipografías de marca instaladas y una prueba de referencia (`docs/exportar-imagen.md`).
- Pantalla de recortes de fotos (la base de datos ya acepta el encargo `media.image.process`).
- Cancelar un reel desde la aplicación; aviso de reel de más de 50 MB antes de montarlo.
- El servidor no impide usar `ai-generate` en una marca en modo agencia (solo lo oculta la interfaz).
- Encargos: sin avisos de encargo nuevo o entregado; entregar solo desde la herramienta, no desde la interfaz.
- ComfyUI: túnel con autenticación y primera llamada real con el cuaderno de Colab.
- La propuesta de perfil solo lee fuentes .txt: faltan PDF, documentos y webs.
- Tipografías de la marca: no se cargan en el editor ni en los reels, y el almacenamiento no admite archivos de fuente.
- Editor: falta selección múltiple, editar texto sobre el lienzo, zonas seguras y vistas previas por red, renombrar la pieza desde el editor.
- Cupo en segundos de vídeo: se miden, pero el cupo solo admite coste.
- El trabajador usa la clave de servicio; falta un rol de Postgres limitado.
- Variables nuevas sin llevar a `.env.example` (documentadas en `docs/`).

## Siguiente paso

1. Montar la cuenta de la agencia en staging, crear la marca Casa Tomás y probar un encargo real con la herramienta `agency/`.
2. Encender el trabajador en local contra staging y probar un reel con fotos reales.
3. El dueño crea la cuenta de Google Cloud (texto e imagen en la UE) y toma las decisiones de arriba.
4. SMTP propio en staging y repetir allí la prueba de extremo a extremo.
