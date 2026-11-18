# Estado del proyecto

Última actualización: 18/11/2026. Rama de trabajo: `claude/focused-noether-hk502p`,
con PR abierto a `staging`. Las ramas `main` y `staging` existen desde el 16/11/2026.

Resumen: la Fase 1 está terminada y probada de extremo a extremo en local. La
Fase 2 está construida y probada con proveedores **simulados**: falta conectar
proveedores reales, que dependen de cuentas y decisiones del dueño (ver
`docs/06-decisiones-fase-2.md`). Nada está desplegado.

## Hecho y comprobado

### Pruebas

| Tanda | Resultado | Qué cubre |
|---|---|---|
| `npm test` | 451 pruebas | Lógica (unitarias) e interfaz contra un Supabase simulado (componentes) |
| `npm run test:db` | 344 pasan, 2 omitidas | Esquema, aislamiento entre organizaciones, permisos, cupos, cola, contenidos, servicio de IA con proveedores simulados, contra las migraciones reales (PGlite). Las 2 omitidas son de simultaneidad con dos conexiones: pasaron contra Postgres 16 el 16/11/2026 y en CI quedan omitidas |
| `worker/` | 36 pruebas | Trabajador de medios con FFmpeg real; también dentro del contenedor |
| `npm run test:e2e` | 47 de 47 | Navegador (Playwright) contra un Supabase local, con `ai-generate` servida en local y el proveedor simulado: 39 escenarios de la Fase 1 y 8 de la Fase 2 |
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
| **Catálogo de redes**: 8 redes y 13 formatos, cada límite marcado como oficial o sin verificar | Probado |
| **Verificador de marca sin IA**: longitud, hashtags, menciones, palabras vetadas, hashtags obligatorios, llamada a la acción, contraste, colores frente a la marca, emojis, legibilidad, texto alternativo; panel dentro del editor que lleva a la capa o al fragmento señalado | Probado de extremo a extremo |
| **Perfil de marca ampliado**: hashtags obligatorios y recomendados, llamadas a la acción y política de emojis (los perfiles antiguos siguen leyéndose) | Probado |
| **Servicio de IA de texto**: redactar la publicación con variantes, comprobación de tono con IA («dudoso: que lo revise una persona») y propuesta de perfil desde fuentes de texto; función `ai-generate` con sesión, permisos, cupo y coste | Probado con el proveedor simulado, en local |
| **Cupo y coste**: cupo mensual por organización impuesto por la base de datos; un cupo agotado detiene la generación con un mensaje claro sin llamar al proveedor; página «Consumo de IA» para administradores; asignación del cupo en Plataforma | Probado de extremo a extremo |
| **Imagen y vídeo generativos**: contrato independiente del proveedor, estimación de coste antes de generar, trabajos asíncronos por sondeo o aviso del proveedor, registro de modelos y precios como dato (todos inactivos) | Probado con proveedores simulados en base de datos; sin interfaz |
| **Trabajador de medios** (`worker/`, Node + FFmpeg en contenedor): reels verticales con plantillas a partir de fotos y clips reales, textos y música; fotos a los cuatro formatos; póster y versión comprimida de vídeos. Un reel de 10 s en 1080×1920 se monta en unos 8 s | Probado con FFmpeg real y dentro del contenedor; contra la cola real en `test:db` |
| **Cola de trabajos**: reservas con caducidad, reintentos, cancelación, devolver un trabajo sin gastar intento y renovar la reserva | Probado |

Una sola unidad para contar el texto (UTF-16, la más estricta) en el editor, la
IA, el verificador y el servidor: un emoji puede contar 2 y la interfaz lo dice.

## Adaptadores escritos y SIN probar contra el servicio real

Escritos contra la documentación oficial, probados solo con respuestas
simuladas. Se activan por configuración del servidor; sin clave no aparecen.

| Servicio | Adaptadores | Detalle |
|---|---|---|
| Texto | Claude por Google Vertex AI en la UE (recomendado), Claude por Amazon Bedrock en la UE, Mistral, Claude por API directa (no procesa en la UE: exige permiso expreso) | `docs/ia-texto.md` |
| Imagen | Google Vertex AI en la UE (recomendado), FLUX.2 de Black Forest Labs, Ideogram | `docs/ia-medios.md` |
| Vídeo con IA | Higgsfield, fal.ai. Apagado por defecto: ningún proveedor tiene región UE verificada | `docs/ia-medios.md` |

Interruptor de la interfaz: sin `VITE_AI_TEXT_ENABLED` no aparece nada que
genere con IA. Hoy no hay proveedor en ningún entorno, así que no sale.

## Probado solo en local

Todo lo anterior se ha ejecutado contra un Supabase local, no contra un proyecto
desplegado. Falta repetirlo en staging cuando exista (correo real, dominio,
políticas de Auth del proyecto) y desplegar `ai-generate`.

## Bloqueado por algo externo

| Qué | Qué hace falta |
|---|---|
| Desplegar y repetir las pruebas en staging | Cuenta y proyecto nuevos de Supabase en la UE, plan Pro (el gratuito no admite archivos de más de 50 MB) |
| Publicar la aplicación | Proyecto de Vercel de pago y dominio |
| Generar con IA de verdad | Cuenta de Google Cloud con Vertex AI en la UE (o la alternativa que se elija) y precios confirmados |
| Desplegar el trabajador de medios | Elegir alojamiento (recomendado: Fly.io en Fráncfort) |
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
9. Decisiones provisionales que se pueden cambiar: una aprobación vale solo para la versión aprobada; quien edita y aprueba puede aprobar sin revisión; cada red es una pieza distinta; los colores fuera de la marca avisan pero no bloquean.

## Pendientes conocidos

**Fase 1**
- Un logotipo subido en el editor de perfil y no guardado se queda en la biblioteca si se cierra o recarga la pestaña.
- Las anotaciones de limpieza de marcas ya borradas solo las puede barrer el servidor.
- Sin pruebas de extremo a extremo en móvil ni en tema oscuro.

**Fase 2**
- Exportar el documento por capas a imagen final: solo está el punto de enganche en el trabajador.
- Imagen y vídeo generativos no tienen interfaz ni prueba de extremo a extremo; nadie encola todavía los trabajos del trabajador ni enlaza sus resultados con la biblioteca.
- La propuesta de perfil solo lee fuentes .txt: faltan PDF, documentos y webs.
- Tipografías de la marca: no se cargan en el editor ni el almacenamiento admite archivos de fuente.
- Editor: falta selección múltiple, editar texto sobre el lienzo, zonas seguras y vistas previas por red, renombrar la pieza desde el editor.
- Cupo en segundos de vídeo: se miden, pero el cupo solo admite coste.
- Disparador que despierte al trabajador (`pg_net` + `pg_cron`): documentado, sin crear.
- El trabajador usa la clave de servicio; falta un rol de Postgres limitado.

## Siguiente paso

1. El dueño toma las decisiones de arriba y crea la cuenta de Supabase y la de Google Cloud.
2. Aplicar las 8 migraciones en staging, desplegar `ai-generate` y repetir la prueba de extremo a extremo allí.
3. Primera llamada real con cada adaptador elegido y prueba ciega de calidad en español.
4. Mientras tanto, sin depender de nadie: exportar a imagen, interfaz de imagen y reels, y lectura de PDF y webs para la propuesta de perfil.
