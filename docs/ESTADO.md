# Estado del proyecto

Última actualización: 26/11/2026 (ramas `f76/ocultar-reels-ia`, `f75/campanas-duracion-repetidos`, `f72/campanas-copiloto`, `f69/contenidos-copiloto`, `f67/pendientes-reels`, `f56/copiloto-fiable`, `f65/historia-arreglos`, `f64/calidad-en-editor`, `f62/terminar-en-instagram`, `f61/historias-tapas-menu`, `f54/reels-calidad`, `f53/editor-piezas-simple`, `f60/arranque-rapido`, `f57/estados-calendario`, `f59/inicio-resultados`, `f58/integraciones-simple`, `f55/ia-campanas`, `f52/reels-capcut`, `f50/menu-simple`, `f51/editar-foto-simple`, `f49/medios-borrados`, `f48/copiloto-ajustes`, `f46/pulido`, `f44/editor-canva`, `f47/cutout-lento`, `f37/copiloto-herramientas`, `f39/reels-editor-movil` y `f45/fotos-ia`; antes, `f43/biblioteca-analitica`, `f42/inicio-contenidos`, `f41/calendario` y `f40/campanas-voz`).
Rama de trabajo: `claude/focused-noether-hk502p` (PR abierto a `staging`; `main` y `staging`
existen desde el 16/11/2026). Lo que falta para lanzar, por área y con responsable, está en
`docs/PENDIENTES.md`.

## Resumen por área

Regla: «implementado» = el código existe; «probado» dice con qué (simulado ≠ real);
nada se da por funcionando contra un servicio real que no se haya llamado.

| Área | Implementado | Probado | Pendiente | Bloqueado |
| --- | --- | --- | --- | --- |
| Núcleo multiempresa (Fase 1) | Sesión, organizaciones, marcas, perfil versionado, biblioteca, equipo y roles, aislamiento | Unitarias, componentes, base de datos y e2e 01–08 en CI | Correo propio para invitaciones y recuperación | SMTP propio (hoy 2 correos por hora) |
| Editor de piezas | Como Canva (`f53`): riel de 5 cajones (Plantillas, Elementos, Fotos, Subidas, Marca; barra inferior con hojas en el móvil), barra flotante como único sitio de las acciones del elemento (sin tapar textos), ajustes a petición que se van al soltar, divisor de ancho que se recuerda, tipo de pieza a la vista, lo que sobresale del lienzo se ve y se agarra, un solo «Compartir» (vista previa, texto, Descargar, Publicar ahora, Programar…, Copiar el texto), sin aprobación a la vista en autogestión, pantalla completa en el móvil; capas, documento v6, páginas, plantillas, atajos, copiloto, guardado automático, copiar y pegar, soltar fotos | Unitarias, componentes, base de datos y `test:layout` en Chromium real (acciones visibles, cajones, «Compartir», divisor, foto que sobresale, fallos de móvil a 375 px); e2e adaptadas **sin ejecutar** | Revisión a mano en navegador y móvil reales; e2e del editor contra Supabase local | Dictado real y proveedor de IA real |
| Editar foto | Pantalla completa en tres pestañas (Ajustar, Recortar, Fondo: Quitar / Desenfocar / Cambiar con IA), hoja baja en móvil, mejora automática (intensidad), recortes, fondos, sombra, quitar el fondo (BEN2 con WebGPU, IS-Net, servidor de respaldo), modo retrato con vista previa y pincel de retoque de la selección, cambiar el fondo con IA; «Mejorar con IA» oculto | Unitarias, componentes, base de datos, `test:layout` (tres pestañas a 375 y 1366 px), e2e 22, 25 y 26 | BEN2 con WebGPU real; el pincel con teclado y el guardado en worker, a mano en un navegador real | Clave de OpenAI / ComfyUI real |
| Reels | Plantillas, editor como CapCut (una barra que cambia con lo elegido, un solo «Exportar» que monta, descarga, abre en la biblioteca y publica o programa con pie y hashtags, o lo manda al móvil para terminarlo en Instagram con música; a pantalla completa en móvil), subtítulos automáticos, música, pantalla de salida de tres pasos, «Hacer un reel como este» (estudiar un vídeo de referencia y rehacerlo para la marca; solo en local, con IA simulada) | Trabajador con FFmpeg real (CI), componentes, `test:layout` (acciones contadas a 375 y 1366 px), e2e 11; la 29 adaptada sin ejecutar; un reel real por plantilla salió en staging el 21/11 | Ver el editor nuevo y la pantalla de salida en staging; redesplegar `media-storage` y `ai-transcribe` | Tarjeta en Fly; clave de OpenAI para subtítulos |
| IA (texto e imagen) | Adaptadores, cupo, coste, perfil de voz, campañas | Con proveedores simulados (e2e 09, 10, 14) | Elegir proveedor y precios reales | Cuenta y claves del proveedor |
| Publicación en Instagram y analítica | OAuth, token pegado, publicar, programar, publicar ahora, carrusel, reel, historia de una imagen, importar histórico, métricas, informe | Contra la Graph API **simulada** (e2e 13, 15, 18, 23, 24, 27) | Probar con una cuenta real | Aplicación de Meta y su revisión |
| Facturación y planes | Planes como datos, límites en la base de datos, margen, Stripe (Checkout, portal, webhook) | Planes y límites en base de datos y e2e 16; Stripe solo simulado | Precios, desplegar funciones | Cuenta de Stripe |
| Alojamiento | Staging en Supabase gratuito y Vercel; trabajador en Fly (modo `drain`, `worker-gateway`); R2 y Drive escritos | Trabajador y gateway en staging con recortes y un reel; R2 solo con MinIO; Drive con Drive simulado | Producción (Supabase Pro, dominio, Vercel Pro) | Cuentas de Cloudflare y Google; tarjeta en Fly |
| Modo de trabajo de la organización | «Lo llevamos nosotros» (autogestión) o «Nos lo lleva una agencia» por organización; en autogestión toda la IA a mano, sin Encargos ni textos de agencia; «Cargar plantillas del catálogo» desde la app; gasto propio para el propietario (`docs/modo-de-trabajo.md`) | Base de datos (PGlite) y componentes; el modo agencia sigue pasando sus pruebas | Aplicar `20261227010000` en staging; verlo en un navegador real; «Tareas» internas en vez de Encargos | — |
| Legal / RGPD | Páginas como plantillas, consentimiento, descarga, borrado, registro de tratamientos, etiqueta de IA | Base de datos y e2e 17 | Revisión de abogado, contratos de encargo, plazos | Abogado |

**En staging** (https://rrss-omega.vercel.app), según el último dato verificado
(20–21/11/2026; no se ha vuelto a mirar el proyecto en esta revisión): las Fases 1 a 6,
Integraciones, copiloto por voz, fotos de Drive y el trabajador de medios en Fly con su
intermediario.

**En la rama de trabajo y sin llevar a staging** (probado en local y en CI; ver «Para llevar
a staging»): R2, OpenAI como proveedor, edición de fotos y su recorte (BEN2, refinado,
servidor), «Publicar ahora», importar publicaciones, carruseles de páginas, editor de reels,
plantillas del editor, documento v5, miniaturas y mejora automática. Las migraciones desde
`20261124010000` hasta `20261213120000` no constan como aplicadas en staging, salvo las del
trabajador de Fly (`20261208…`, `20261210…`), que el trabajador desplegado necesita.

Resumen: las Fases 1 a 6 están construidas y probadas de extremo a extremo en local con
proveedores **simulados** (IA, Meta, Stripe). Lo que falta para usarlas de verdad son
cuentas y decisiones del dueño, no desarrollo: aplicación de Meta, proveedor de IA,
Stripe, correo y revisión legal. Staging (Supabase gratuito, UE) tenía 35 migraciones
y las funciones desplegadas sin proveedores el 20/11/2026.

## Pruebas

Cifras de la última ejecución del CI de GitHub (22/11/2026, rama `f27/calidad`, commit `dddc246`),
salvo donde se dice otra cosa. Ninguna prueba toca servicios reales: todas usan proveedores simulados.

| Tanda | Resultado | Qué cubre |
| --- | --- | --- |
| `npm test` | 1089 pasan en el CI de esta rama; 1112 con el modo retrato (`f22/modo-retrato`, ya unido), medido en local por su rama | Lógica (unitarias) e interfaz contra un Supabase simulado (componentes) |
| `npm run test:db` | 915 pasan, 2 omitidas | Esquema, aislamiento, permisos, planes, cupos, cola, publicación, campañas, analítica, RGPD, integraciones, biblioteca, R2, edición de fotos, contra las migraciones reales (PGlite). Las 2 omitidas son de simultaneidad con dos conexiones (pasaron contra Postgres 16 el 16/11/2026) |
| `npm run test:layout` | 23 pasan (en CI desde el 22/11/2026, trabajo `maquetacion`) | Chromium real **sin Supabase**: editor sin scroll de página en cuatro tamaños, hoja inferior en móvil, zoom, menú lateral y exportación PNG/JPEG comparada píxel a píxel con el lienzo |
| `worker/` | 108 pasan, más 13 del reel dentro del contenedor | Trabajador de medios con FFmpeg real |
| `agency/` | 54 pasan | Herramienta de la agencia contra un Supabase simulado |
| `npm run test:e2e` | **94 de 94**, 29 archivos (CI, 4,4 min) | Chromium contra un Supabase local con las funciones servidas, el trabajador real y proveedores simulados (IA, Graph API, Drive, dictado, MinIO como R2): Fases 1 a 6, integraciones, copiloto, Drive, R2, edición de fotos, publicar ahora, importar, carrusel, plantillas y editor de reels |
| CI de GitHub | `comprobar`, `trabajador`, `agencia`, `maquetacion` y `e2e` en verde | `e2e` y `maquetacion` llevan `continue-on-error`: no bloquean el PR hasta verlos estables varias ejecuciones seguidas |

Historia de la e2e en CI el 22/11/2026: en las ejecuciones del día anterior fallaban 5–8 de 94
(y otras 8 no llegaban a correr porque cada archivo parte de lo que dejó el anterior). Causas,
todas de las pruebas salvo una: selectores viejos tras los rediseños (menú «⋯» de la biblioteca,
«Opciones avanzadas» de la conexión avanzada, texto «clave de acceso», «Volver» de «Editar foto»
a pantalla completa), la subida con miniatura (la prueba esperaba solo el original) y **un fallo
real del producto**: la cuadrícula de la biblioteca buscaba la miniatura firmada por la ruta del
original y las fotos con miniatura se quedaban en esqueleto. Todo corregido en `f27/calidad`.
Las e2e 11, 25, 26 y 29, que figuraban como «sin ejecutar», llevaban ejecutándose y pasando
en CI desde antes; el CI no estaba a la vista porque el trabajo `e2e` no bloquea.
Las pruebas siguen sin poder ejecutarse en el PC de desarrollo (no hay Docker): el CI es el único
lugar donde corre la e2e completa.

**Pruebas estables con la máquina cargada** (rama `f70/pruebas-estables`, 24/11/2026). Medido con
dos tandas a la vez (dos `npm test`, `test:db`, dos maquetaciones en 5418 y 5419 y `worker/`), y
con las tandas de otros trabajos en el mismo PC. Causas y arreglos:
- **Dos fallos reales de los reels**, con su prueba: el guardado automático dejaba un reloj vivo al
  salir del editor con un guardado en marcha (podía pisar el borrador al volver a abrir el reel; en
  las pruebas caía en la prueba siguiente y la hoja «Exportar» decía «El vídeo todavía no tiene los
  últimos cambios»), y el pie propuesto por «Hacer un reel como este» no llegaba si la hoja
  «Publicar o programar» ya estaba abierta.
- **Maquetación**: todas las ramas usaban el puerto 5391 y se reutilizaba el servidor que hubiera,
  así que unas pruebas se pasaban contra el código de otra carpeta (y su servidor se cerraba a mitad).
  Ahora cada copia tiene su puerto (sale de la carpeta; `LAYOUT_PORT` lo fija) y no se reutiliza
  (`LAYOUT_REUSE=1` para uno arrancado a mano).
- Esperas con límite propio MÁS CORTO que el general (5 s frente a 10 s en componentes; 10–20 s
  frente a 30 s en Playwright): quitadas o subidas.
- Primera prueba de un archivo que abre el editor de reels: se precarga en `beforeAll`
  (`src/test/preload.ts`); con carga, transformarlo tardaba más de 20 s.
- Carreras en las pruebas: el borrador del asistente de marca (se esperaba a cualquiera, no al del
  paso 2), el fetch simulado de Vertex (no rechazaba una señal ya cancelada), las medidas de
  «Plantillas de la marca» (tomadas en momentos distintos).
- Límites propios donde el trabajo es lento de verdad: FFmpeg del trabajador (300 s), el
  diagnóstico de onnxruntime del recorte y el desenfoque del modo retrato.
Sin reintentos nuevos en ninguna configuración.
Resultado (dos tandas completas a la vez: `npm test` → `test:db` → maquetación → `worker/`): tras
unir `claude/focused-noether-hk502p` (294b2ed), una pasada entera en verde en las dos tandas
(2316 + 1314 + 215 + 192 pasan en cada una); la anterior, también en verde salvo el trabajador, que
fallaba por haberse suspendido el PC a mitad (pruebas de «15 horas»). La tercera la cortó otra
suspensión. Repetido diez veces a la vez, `editorReels.test.tsx` ya no falla (antes, 2 de 10).

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

### Fase 3 · Calendario y publicación

Cuentas de Instagram por OAuth (tokens cifrados fuera de `public`), calendario
(mes, semana, día y por red) con arrastrar y soltar y aprobación por lotes,
comentarios en la pieza, y publicador `social-publish` (pg_cron cada minuto)
con cerrojo, idempotencia y reintentos: imagen, carrusel y reel. La base de
datos impide publicar lo no aprobado, incluso con la clave de servicio, y que el
plan no incluya publicación. Detalle en `docs/publicacion.md`.

**Publicar ahora** (rama `f7/publicar-ahora`, en `f6/integracion`): botón en el editor de
una pieza aprobada, opción «Ahora» al programar y botón en la ficha del
calendario; confirma en un paso, exporta la imagen si falta (en el editor), pone
la publicación con la hora actual por las mismas garantías, procesa la cola al
momento (`social-publish/now`, con la sesión de la persona) y enseña el progreso
y el enlace. Migración `20261130010000` (dos RPC, sin tablas) con su vuelta
atrás; hay que desplegar la migración y `social-publish`. Probado en base de
datos, componentes y e2e (`23-publicar-ahora.spec.ts`).

**Carruseles de varias páginas** (rama `f8/carrusel-paginas`): un carrusel es una
pieza con varias páginas en UNA versión. El documento pasa a la **versión 4**
(`pages`, de 1 a 10, mismo lienzo y mismo texto; un documento v3 se lee como uno
de una página). Editor con tira de miniaturas (añadir, duplicar, borrar,
reordenar arrastrando o con botones), deshacer que vuelve a la página de cada
paso, copiloto sobre la página activa y vista previa con flechas; «Exportar el
carrusel» saca un JPEG por página con `page`/`page_count` en la procedencia;
programar y «Publicar ahora» usan las exportaciones de cada página en orden; la
base de datos lo exige (migración `20261203010000`, con vuelta atrás) y el
publicador ya enviaba los hijos en ese orden. Verificador, marca de IA, campañas,
plantillas y `agency/` leen las páginas. Detalle y cómo convertir un carrusel
hecho con varias versiones (la demo de EnerGym) en `docs/publicacion.md`
(«Carruseles»; script `scripts/unir-versiones-en-carrusel.sql`, probado en PGlite,
**sin ejecutar** en staging). La e2e 27 se ejecuta en CI desde el 22/11/2026.

- Pruebas: unitarias (esquema, migración, páginas, verificador, exportación),
  componentes (`editorPaginas.test.tsx`, programar y «Publicar ahora» un
  carrusel), base de datos (regla con varias exportaciones en orden, publicador
  con la Graph API simulada, IA y plantillas con páginas) y `agency/`. La e2e
  `27-carrusel-paginas.spec.ts` se ejecuta en el CI de GitHub (no hay Docker en el
  PC de desarrollo); el 22/11/2026 no llegó a pasar porque dependía de la cuenta de
  Instagram que deja la 18 (ver «Pruebas»).
- Para llevarla a staging: migración `20261203010000_carousel_pages.sql`; ninguna
  función que desplegar (el cambio de la Graph API simulada solo cuenta en local).
  Ojo: un carrusel ya programado con exportaciones sin número de página queda
  detenido («invalid_media») hasta exportar sus páginas.

### Editor de reels (rama `f11/editor-reels`, 21/11/2026)

Una pieza de formato reel se monta en un **editor de reels** (el diseño por capas
antiguo sigue en `?editor=imagen`): línea de tiempo con pistas de vídeo y fotos,
textos, subtítulos y música; arrastrar para ordenar, recortar principio y final,
duración de las fotos, transición por elemento, cabezal, zoom y deshacer/rehacer.
Las tres plantillas son el punto de partida. **Vista previa al momento** en el
navegador (clips, fotos, textos, subtítulos y sonido sincronizados, con aviso de lo
que se verá distinto). Textos con la tipografía (.ttf/.otf) y los colores de la marca.
**Subtítulos automáticos** con OpenAI (`gpt-transcribe`, clave de Integraciones; un
trozo de voz = un subtítulo) con cupo y coste por organización, interruptor
`VITE_REEL_SUBTITLES_ENABLED` y corrección a mano. **Música** con volumen, entrada y
salida suaves y confirmación de licencia (queda en la procedencia). Se guarda como
**versión de la pieza**, se aprueba y se monta la versión guardada; programar y
«Publicar ahora» proponen su montaje.

- Plan del reel **v2** (`worker/src/reel/schema.ts`, `src/features/reels/editor/project.ts`); el v1 se migra al leerlo.
- Migración `20261207010000_reel_editor` (sin tablas: carga v2, enlace con la pieza, tipografías y licencia comprobadas, procedencia), con vuelta atrás. Función nueva `ai-transcribe`.
- Precio de los subtítulos: 0,0045 $/min (OpenAI, 21/11/2026) + 10 % de cota por la UE = 82,5 micros/s.
- Pruebas: unitarias, componentes, trabajador con FFmpeg real, base de datos (con aislamiento). La e2e `29-editor-reels.spec.ts` **pasa en CI** (22/11/2026). Sin probar contra OpenAI real ni la vista previa en un navegador real.
- Para llevarlo a staging: migración `20261207010000`, desplegar `ai-transcribe` y redesplegar `platform-integrations`; `VITE_REEL_SUBTITLES_ENABLED` cuando haya clave de OpenAI. Detalle en `docs/editor-reels.md`.

#### Editor de reels más intuitivo (rama `f14/reels-intuitivo`, 21/11/2026)

Auditoría en staging (escritorio y 375 px) y mejoras sin tocar el plan, el trabajador ni la base de datos:
pantalla de salida de tres pasos (estilo con muestras en movimiento, texto de apertura, varias fotos en el orden elegido),
selector de fotos y clips con miniaturas, varias a la vez, filtros y tandas, «Guardar y montar el vídeo» con el estado del
montaje a la vista, cabecera común con «⋯» (Archivar, cambiar el nombre, Historial), diseño de una columna en móvil sin
scroll lateral, barra de duración, zonas que tapa Instagram y asas de recorte táctiles. **Arreglo en `media-storage`**:
`sign` daba 500 con ≥ ~100 rutas (URL de PostgREST demasiado larga); ahora consulta de 40 en 40, **hay que redesplegar la
función**. Pendiente: mirar la pantalla nueva en staging (no se ha visto en un navegador real). Detalle y cómo probar en `docs/editor-reels.md` §7.

#### Reels: ritmo, textos animados, cámara, portada y arrastrar (rama `f25/reels-ritmo-animacion`, 22/11/2026)

El plan v2 se **amplía de forma compatible** (campos opcionales, sin nulos): `texts[].animation` (6 entradas y 4
salidas), `clips[].motion` con subir/bajar la cámara y `motionAmount`, y `cover` (fotograma o foto). Aplicación,
trabajador y base de datos a la vez: migración `20261215010000_reel_animation_cover` (+ vuelta atrás; el disparador de la
portada no toca `request_media_job`), esquemas JSON regenerados. «Ajustar los cortes a la música» detecta el compás en el
navegador (Web Audio) y reparte las duraciones en los golpes (se deshace); la portada queda en la biblioteca (carpeta
Reels, `provenance.role = 'cover'`) pero **la publicación todavía no la envía** (el publicador no manda `cover_url`);
reordenar con el dedo con agarre largo, asas de 24 px y recorte con teclado. Probado: unitarias, componentes, trabajador
con FFmpeg real (posición del texto en fotogramas), base de datos. Sin probar: análisis de música real y agarre largo en un
móvil real, FFmpeg 6 de Alpine (`fontsize` como expresión), migración en staging. Detalle y despliegue en `docs/editor-reels.md` §8.

### Catálogo de plantillas y plantillas de reel por marca (rama `f35/catalogo-plantillas`, 22/11/2026)

Hasta ahora una marca tenía las plantillas de publicación que alguien le entregara a mano y, para los reels,
solo los tres estilos del trabajador. Detalle: `docs/plantillas-competencia.md` (estudio y por qué cada
plantilla), `docs/editor-reels.md` §9 (formato de la plantilla de reel) y `agency/README.md` (cómo se carga).

- **Estudio de la competencia** (restaurantes y asadores, bares de cócteles, gimnasios), con fuentes
  enlazadas y cada afirmación marcada como dato, consejo, inferencia o sin verificar. Límite importante:
  Instagram y TikTok no se dejan leer sin sesión, así que **no se ha visto por dentro ningún reel real**; las
  duraciones de plano son una propuesta razonada, no una medición.
- **Plantillas de reel con estructura** (`src/features/reels/reelTemplate.ts`): planos con duración,
  movimiento y transición, textos de muestra con su animación, música sugerida (solo escrita) y portada.
  Tabla `brand_reel_templates` con RLS, `deliver_reel_templates` y `delete_reel_template` (**migración
  `20261224010000_reel_templates.sql`**, con vuelta atrás y casos en `tests/db/aislamiento.test.ts`).
  **No aplicada en staging ni en producción.** Al usar una plantilla sale un proyecto de reel normal (plan
  v2): el trabajador, `request_media_job` y la publicación no cambian.
- **«Empieza tu reel»** ofrece las plantillas de la marca encima de los tres pasos: se elige una, el selector
  enseña los planos en orden y, al confirmar, el reel queda montado con sus textos de muestra. Sin
  plantillas, la pantalla es la de antes.
- **Catálogo** en `agency/catalogo/`: cuatro juegos (`restaurante`, `cocteleria`, `gimnasio`, `generico`)
  con 10 plantillas de reel y 10 de publicación o carrusel cada uno (80 en total). Sin nada de ningún
  cliente: nombres neutros, textos de muestra y colores y tipografías por papeles, que se llenan con el
  perfil de la marca al cargar. Órdenes nuevas `catalogo` y `cargar-catalogo` (**en seco por defecto**;
  `--cargar` guarda). El archivo de entrega de plantillas de publicación admite ya documentos v5.
- **Probado:** unitarias y componentes del formato y de la pantalla de salida; base de datos (aislamiento,
  permisos, rechazos, tope, vuelta atrás); `agency/tests/catalogo.test.ts` recorre las 80 plantillas con
  tres temas y las pasa por los validadores de la aplicación (documento v5 y análisis; plantilla de reel y
  plan v2 con el mínimo y con todo el material), y prueba la carga en seco y la de verdad contra el
  Supabase simulado. Las publicaciones del juego de restaurante y del de gimnasio se miraron dibujadas en
  un navegador (una hoja de contactos hecha para la ocasión, no el editor).
- **Sin probar:** nada cargado en staging; **ningún reel de plantilla montado con el trabajador ni visto en
  la vista previa real**; las publicaciones dentro del editor de verdad (tipografías de la marca, textos
  largos); el reparto automático de colores con perfiles distintos de los tres de prueba y los dos reales
  que se usaron en seco.
- **Pendiente:** pantalla para borrar o renombrar plantillas de reel; «Guardar como plantilla» desde el
  editor de reels (el origen `editor` ya existe); que «un reel como este» (rama `f36`) guarde en este
  formato; medir con la analítica qué plantillas funcionan y ajustar duraciones.

### Fase 4 · Campañas (primera parte)

«Prepara la semana que viene» → plan explicado (observado / datos / hipótesis) →
borradores, nunca aprobados ni publicados; protegido contra instrucciones
maliciosas en fuentes y perfil; en modo agencia el plan lo entrega la agencia.

Presentación (rama `f10/campanas-diseno`, 21/11/2026): la lista son tarjetas
con fechas, estado, número de piezas y miniaturas; el detalle abre con título,
estado, fechas, red, objetivo en una línea y la acción según el estado, y
enseña la semana como tira de días con la miniatura de cada pieza (exportación
de la versión vigente, esbozo del documento o foto sugerida por el plan). Al
pulsar una pieza se abre su ficha (texto, motivo, «Abrir en el editor»).
«Por qué este plan» (observado / datos / hipótesis, siempre por separado) y
«Lo que se pidió» van plegados. Sin cambios de datos ni de lógica.

### Fase 5 · Analítica

Capturas horarias de métricas de Instagram, panel que separa dato de hipótesis y
dice lo que no se puede medir, interpretación con IA opcional e informe mensual
en PDF generado sin intervención. Detalle en `docs/analitica.md`.

### Fase 6 · Planes, facturación y RGPD

- **Planes como datos** (Prueba, Básico, Profesional, Agencia, Enterprise, Heredado) con límites que impone la base de datos, panel de **margen por cliente**, «Configuración → Plan». Stripe (Checkout, portal y webhook) escrito y probado con Stripe simulado. Detalle en `docs/facturacion.md`.
- **RGPD**: páginas legales como plantillas, consentimiento en el registro, descargar mis datos, exportar la organización, borrar cuenta y organización, registro de tratamientos (`docs/rgpd.md`) y etiqueta «Generado con IA» por pieza.

### Plataforma → Integraciones (rama `f4/integraciones`)

Las claves de los servicios se meten desde `/plataforma/integraciones` (solo
superadministradores): Meta (y «Generar clave» de cifrado de los tokens),
ComfyUI propio, IA de texto (proveedor y modelo por tarea, también el del
copiloto), IA de imagen, Stripe y Google Drive.

- Los secretos van a Supabase Vault (migración `20261120010000`); en la tabla
  queda su identificador y una pista. El navegador nunca los recibe; cambios y
  pruebas quedan en la actividad, sin valores.
- Las funciones leen primero lo guardado y, si no está, las variables de entorno
  (`_shared/integrations/settings.ts`, caché de 30 s, sin redesplegar). Lo
  hacen todas las que usan proveedores, incluidas `ai-generate` (también la
  tarea del copiloto) y `drive-media`. Una clave de cifrado con tokens guardados
  no se puede quitar.
- «Probar conexión» con una llamada gratuita por servicio. Ideogram, el secreto
  del webhook de Stripe y el cliente OAuth de Google no se pueden comprobar
  gratis: se dice así (se comprueban con la primera imagen, el primer aviso o
  al conectar).
- Instagram también se conecta pegando un token de página de larga duración
  (Marca → Datos → Cuentas conectadas): se valida con la Graph API y la cuenta
  queda «Con token».
- Interruptores: IA, copiloto, publicación, pago y Drive salen si la variable
  `VITE_*` del despliegue lo permite **y** el servidor dice que la integración
  está configurada (`platform-integrations`, solo booleanos).

### Copiloto por voz del editor (rama `f4/copiloto-voz`)

Botón «Dictar» en el editor: cada frase dictada (Web Speech API, es-ES) se
convierte con la IA de texto (tarea `editor.copilot`, esquema estricto y
saneado) en operaciones de capas (foto de fondo difuminada, logotipo, textos
literales con tipografías y colores del perfil) que se aplican al momento y se
deshacen con un solo Ctrl+Z por orden. El documento pasa a la **versión 3**
(desenfoque de imágenes, también en la exportación y en los reels del
trabajador; migración `20261121010000_reel_media_blur.sql`). Sale con
`VITE_AI_VOICE_COPILOT_ENABLED` + `VITE_AI_TEXT_ENABLED` y la IA de texto
configurada en el servidor. Probado con el proveedor simulado y una Web Speech
API simulada; **sin probar** con un proveedor real ni con el dictado real.
Arreglos de la evaluación sin API (rama `f5/copiloto-arreglos`, en
`f5/integracion`): color de los textos según el uso del color en el perfil y
legible sobre lo que hay debajo (`copilot/legibility.ts`), órdenes relativas
(«sube», «más difuminada»: `move_layer` con `dx`/`dy`) y ambiguas (se preguntan),
órdenes de terceros y logotipo que no pisa textos; cambia la tarea
`editor.copilot` de `ai-generate`. Detalle en `docs/copiloto-voz.md`.

### Almacenamiento en Cloudflare R2 (rama `f5/almacenamiento-r2`, en `f6/integracion`)

Valoración: **sí, con condiciones** (cubo en la UE, DPA de Cloudflare, token solo
para ese cubo, Supabase de respaldo). Con ≈ 3,2 GB a llevar, R2 cuesta 0 $ (10 GB
gratis, salida gratis) frente a no caber en Supabase Free (1 GB, 5 GB de salida) o
25 $/mes en Pro. Cada recurso guarda su almacén (`media_assets.storage_backend`,
migración `20261124010000`, que fija el servidor); la Edge Function `media-storage`
firma lecturas (1 h, tras la RLS), subidas (tipo y tamaño firmados, tras comprobar
que se edita la marca) y borrados. Credenciales en Plataforma → Integraciones →
Cloudflare R2 (Vault) con «Probar conexión» (HeadBucket); sin R2 configurado todo
sigue en Supabase. Lo usan biblioteca, editor, exportación, informes, exportación
RGPD, trabajador (sin credenciales de R2), imágenes con IA, publicación en Instagram
y borrado de organizaciones. Script reanudable `scripts/migrar-a-r2.ts` (en seco por
defecto). No necesita variable `VITE_`: la interfaz pregunta al servidor. Probado
con un S3 local (MinIO); **sin probar contra R2 real** y **sin desplegar**. Pasos
del dueño en `docs/almacenamiento-r2.md` §5.

Alta en la biblioteca de lo copiado desde Drive (rama `f6/alta-biblioteca`):
`scripts/alta-biblioteca.ts` da de alta cada objeto en la marca de su fila del
inventario (mapeo «marca → brand_id» en un JSON de quien lo ejecuta), con carpeta,
etiquetas, nombre legible, dimensiones y procedencia de Drive, en R2; idempotente,
completa huérfanos y tiene `--comprobar`. La copia pasa a
`<org>/<marca>/import/google-drive/` (bajo `…/drive/` la biblioteca no lo admite).
`scripts/crear-marca-agencia.sql` crea una marca en modo agencia (para Touza en
Oficiosos). Recuento en seco: Casa Tomás 239 fotos, Touza 241 fotos y 46 vídeos
(`docs/almacenamiento-r2.md` §4.2). Probado con PGlite; **sin ejecutar** en staging.

### Biblioteca con Google Drive (rama `f4/biblioteca-drive`)

La organización conecta su Google Drive (OAuth, solo lectura, token de refresco
cifrado como los de Meta) y sus marcas añaden a la biblioteca fotos de Drive **sin
copiarlas a Storage**: el recurso guarda el id del archivo y la imagen la sirve la
función `drive-media` con direcciones firmadas, tras comprobar por RLS que quien la
pide ve la marca. Editor, exportación y trabajador de medios la leen por ahí. No
ocupa plan. Migración `20261122010000`; el cliente de Google se configura en
Plataforma → Integraciones → Google Drive (migración `20261123010000`). Sale con
`VITE_DRIVE_LIBRARY_ENABLED` y Drive configurado en el servidor; «Desde Google
Drive», además, con una conexión activa. Probado contra Drive simulado (base de
datos, función y e2e); las fotos HEIC del iPhone no se pueden usar todavía.
Detalle en `docs/biblioteca-drive.md`.

### Edición de fotos bajo demanda (rama `f6/edicion-fotos`, en `f6/integracion`)

«Editar foto» desde la ficha de la biblioteca y desde una capa de imagen del
editor (la capa pasa a usar la editada; Ctrl+Z la devuelve). **El original no se
toca nunca**: cada resultado es un recurso nuevo en «Ediciones» con su
procedencia (`photo_edit` del navegador, `ai_edit` del servidor, que solo puede
escribir él; el original tiene que ser de la misma marca).

- **Sin IA, en el navegador:** mejorar (automático o a mano: luz, contraste,
  color, temperatura, nitidez), recortes 1:1, 4:5 y 9:16 con encuadre
  inteligente (heurística de detalle y color, no reconoce objetos) y poner un
  fondo liso, de color de la marca o de la biblioteca a una foto con transparencia.
- **Con IA, por `ai-media`** (`photo.options`, `photo.estimate`, `photo.edit`):
  quitar el fondo y ampliar ×2/×4, con coste máximo antes, cupo y coste por
  organización (`ai_generations`, propósito `photo.*`). Salen solo con
  `VITE_AI_PHOTO_EDIT_ENABLED=true` y un modelo en el servidor. ComfyUI propio
  como opción principal: ampliar con nodos del núcleo (Real-ESRGAN) y quitar el
  fondo con el nodo BiRefNet de ComfyUI-RMBG; filas sembradas **inactivas** y
  sin precio verificado. Migración `20261128010000` (con vuelta atrás), sin
  tablas nuevas.
- **Quitar el fondo en el navegador, gratis** (rama `f7/recorte-navegador`): IS-Net
  (float16, 84 MiB, MIT/Apache-2.0) en un Web Worker con `onnxruntime-web`,
  descargado en ejecución desde Hugging Face (o desde `VITE_CUTOUT_MODEL_URL`) y
  guardado en Cache Storage; sin proveedor ni coste. Encima, fondo liso, de color
  de la marca o de la biblioteca, con sombra suave opcional; resultado `photo_edit`
  con sus pasos. Sin COOP/COEP (romperían las fotos de otros orígenes). Detalle en
  `docs/edicion-fotos.md` §7. Probado: unitarias y componentes; e2e 25 **pasa en CI** (22/11/2026) con una máscara simulada; **sin probar el modelo real en un navegador**.
- **Quitar el fondo con BEN2** (rama `f17/recorte-ben2`, 21/11/2026): decisión
  del dueño tras comparar 12 fotos reales. BEN2 base fp16 (219 MB, MIT) en el
  navegador **solo con WebGPU**; sin WebGPU, sin memoria o si falla, vuelve a
  IS-Net («calidad básica») y lo recuerda en la sesión. Descarga con progreso,
  caché y botón «Cancelar»; el motor usado queda en la procedencia
  (`ben2-base-fp16` / `isnet-general-use`). Paridad con la referencia: IoU
  ≥ 0,9998 en 4 fotos. **Sin probar BEN2 con WebGPU real** (esta máquina no
  tiene adaptador). Detalle en `docs/edicion-fotos.md` §7.
- Quitar el fondo en el trabajador sin GPU (BiRefNet o IS-Net con
  `onnxruntime-node`): valorado y documentado como alternativa, **sin descargar
  pesos** (falta el «sí»).
- Pruebas: unitarias, componentes, base de datos y e2e `22-edicion-fotos.spec.ts` en verde. Sin probar contra un
  ComfyUI real ni el dibujo real en un navegador.
- Para llevarla a staging: migración `20261128010000_photo_editing.sql`;
  redesplegar `ai-media`, `ai-media-poll` y `ai-media-webhook` (código común de
  medios); variable nueva `VITE_AI_PHOTO_EDIT_ENABLED` (apagada hasta tener
  modelo) y, si el ComfyUI no está en la UE, `AI_MEDIA_REMOVE_BACKGROUND_MODEL` /
  `AI_MEDIA_UPSCALE_MODEL`.

### Importar publicaciones de la cuenta y plantillas de diseño (rama `f7/importar-publicaciones`)

Botón «Importar publicaciones» en Marca → Datos de la marca → Cuentas conectadas:
lee el histórico de Instagram (`/media`, con paginación, `children`, límites de la
API y reanudación) con la cuenta conectada, sin que el token salga del servidor, lo
guarda en `social_imported_media` y, si se pide, copia las imágenes a la biblioteca
(carpeta «Instagram / Publicadas», con procedencia y en el almacén activo). Se puede
detener y reanudar sin perder ni duplicar nada. En modo agencia, `agency/` saca las
plantillas (`importadas`, `comprobar-plantillas`, `entregar-plantillas`) y se guardan
como plantillas de la marca (`brand_design_templates`: documento v3 + análisis con
ejemplos). Detalle, decisiones y lo no probado en `docs/importar-publicaciones.md`.

- Pruebas: base de datos (`importar-publicaciones.test.ts` y casos en `aislamiento.test.ts`), `agency/` (`plantillas.test.ts`) y e2e `24-importar-publicaciones.spec.ts`.
- Para llevarla a staging: migración `20261201010000_social_import.sql` y desplegar la función nueva `social-import`.
- Pendiente: interfaz para usar las plantillas (crear una pieza desde una), exportación RGPD de lo importado, probar contra Meta y R2 reales.

### Editar fotos con OpenAI: cambiar el fondo con IA (rama `f7/openai-imagen`)

OpenAI (GPT Image) como proveedor de imagen de `ai-media` con la misma
`OPENAI_API_KEY` de Integraciones: generar, **cambiar el fondo** (texto libre y
sugerencias; con máscara del plato si la hay), **mejorar luz y color** y quitar
el fondo (PNG transparente). Pestaña «Fondo con IA» en «Editar foto» (biblioteca
y editor); resultado = recurso nuevo con procedencia `ai_edit` y el encargo. «Probar
conexión» comprueba también que la clave vea un modelo `gpt-image…`. Detalle,
fuentes, precio y límites en `docs/ia-medios.md` §13 y `docs/edicion-fotos.md` §7.

- Precio: OpenAI cobra por tokens; el registro lleva una **cota por megapíxel** (70.000 micros de salida, 14.000 de entrada). Los modelos nacen inactivos y sin precio verificado: hay que activarlos en Plataforma.
- Fuera de la UE: `AI_MEDIA_ALLOW_NON_EU=true` (o proyecto europeo con `OPENAI_BASE_URL=https://eu.api.openai.com`).
- Interfaz para el integrador: `PhotoEditScreen` acepta `getSubjectMask` (PNG con las medidas de la foto, plato opaco). Nadie la pasa todavía: sin ella se avisa de que la IA puede retocar el plato. La máscara de OpenAI es orientativa: no garantiza el plato intacto.
- Pruebas: `tests/db/ia-openai-imagen.test.ts`, casos nuevos en `edicion-fotos.test.ts` y `editarFoto.test.tsx`; e2e `26-cambiar-fondo-ia.spec.ts` **pasa en CI** (22/11/2026).
- Para llevarla a staging: migración `20261202010000_openai_image.sql` (vuelta atrás en `supabase/rollbacks/`) y redesplegar `ai-media`, `ai-media-poll`, `ai-media-webhook` y `platform-integrations` (código compartido). Sin probar contra OpenAI real.

### Valoración de Cloudflare Workers AI (rama `f8/workers-ai`, 20/11/2026)

Solo documentación (`docs/ia-medios.md` §14), sin código: Workers AI cubre generar
imagen (FLUX.2 klein 9B ≈ 0,015 USD el primer megapíxel) y texto, pero no quitar el
fondo, ampliar ni editar fotos de platos (entradas menores de 512×512, sin máscara,
inpainting obsoleto desde el 20/11/2026) ni garantiza la UE. No sustituye al Colab.

### Base robusta: despliegues, carga inicial y móvil (rama `f11/base-robusta`, 21/11/2026)

Respuesta a los problemas 1, 2 y 4 y al cambio transversal 5 de la auditoría de diseño
(`energym-demo-datos/capturas/auditoria/INFORME.md`). Implementado y probado en local
(componentes); sin desplegar.

- **Pantalla en negro tras un despliegue.** Todas las pantallas se cargan con
  `lazyRoute` (`src/lib/lazyRoute.ts`): si el trozo de código ya no existe, recarga la
  página una vez (marca con la hora en `sessionStorage`, como mucho una vez cada 30 s) y,
  si vuelve a fallar, el límite de errores enseña «Hay una versión nueva de la
  aplicación · Recargar». También se atiende `vite:preloadError`. Límite de errores
  (`src/layout/ErrorBoundary.tsx`) en toda la app y otro alrededor de cada sección: el
  menú se queda y sale «Esta sección no se ha podido mostrar · Reintentar».
- **Carga inicial.** La pantalla de la dirección de entrada se descarga a la vez que la
  sesión (antes esperaba a organizaciones y marcas); las 4 secciones principales se
  precargan cuando el navegador está libre. «/» con una visita anterior va directo a la
  última marca (organizaciones y marcas en paralelo: una ida y vuelta menos). Las
  integraciones se piden a la vez que la organización. Siluetas grises del armazón y de
  la sección en lugar de «Cargando…» a pantalla completa. Primer paquete: 236 → 203 kB
  comprimido (lucide-react y zod ya no van en los trozos fijos; todas las pantallas,
  también acceso y Configuración, se cargan al visitarlas).
- **Móvil.** Barra inferior con Inicio, Contenidos, Calendario, Biblioteca y «Más» (hoja
  con el resto, con la insignia de Encargos); etiquetas enteras; la pestaña activa lleva
  color y una raya, y «Más» queda marcada si la sección está dentro.
- **Sección activa.** En el lateral, la activa (solo por ruta, `aria-current`) lleva
  fondo, negrita y una raya, para no confundirla con el fondo de «pasar por encima».
  Configuración mantiene la última marca de la organización en el menú y en el selector.
- **Medidas.** Publicada (antes), entrando en frío por «/» con renovación del token: JS
  listo a 0,80 s, primera petición a 1,07 s, trozo de la pantalla pedido a 1,34 s (tras
  organizaciones y marcas) y contenido completo a 2,19 s; en caliente, 0,15 s y 0,54 s.
  En local (compilado contra staging, «/», antes → después): trozo de la pantalla 567 →
  141–401 ms, marcas 380 → 135–280 ms, peticiones de la sección 590 → 351–465 ms; total
  450–750 → 520–660 ms (con la máquina cargada el total no es concluyente). Olas de
  peticiones en cascada: 5 → 4. En el navegador integrado se ven parones de 4–8 s en los
  que la pestaña no pinta nada aunque el JS ya ha llegado (primer pintado a 8,5 s con el
  JS descargado a los 0,04 s): son de la pestaña, no de la app; el cliente de Supabase
  2.119 ya no usa el cerrojo entre pestañas que señalaba la auditoría.

### Acciones claras y avisos que se resuelven (rama `f11/acciones-claras`, 21/11/2026)

Problemas 6, 7 y 9 y cambios transversales 1 y 2 de la auditoría de UX
(`energym-demo-datos/capturas/auditoria/INFORME.md`); capturas del antes y el
después en `energym-demo-datos/capturas/tanda2/f13-*`.

- **Cabecera común** (`src/components/ui/PageHeader.tsx` + `MoreMenu.tsx`): título, una
  línea de contexto, **una** acción principal y el resto en «⋯» (Radix, por teclado).
  Editor: la principal sale del estado (`editorPrimaryAction` en `content/status.ts`):
  Enviar a revisión → Aprobar → Publicar ahora (o Programar) → Recuperar si está
  archivada; «Guardar versión» visible y discreto; Archivar, Devolver a idea/borrador,
  Retirar la aprobación, Historial, Exportar, Nombre y red y Plantilla, en «⋯» por
  grupos. Contenidos (las archivadas, en «⋯»), Biblioteca (Drive y reels, en «⋯») y
  Calendario («Aprobar varias», en «⋯»).
- **Avisos que se resuelven** (`ActionNotice`): una frase, el botón que lleva a
  arreglarlo y «¿Por qué?» plegado. Calendario: un aviso por motivo de «Detenida»
  (`social/holdAdvice.ts`) con «Conectar cuenta», «Usar @cuenta» (vuelve a guardar
  con la cuenta conectada), «Usar la versión aprobada» o «Exportar» (abre el editor
  con `?exportar=1`); la ficha, igual. Estados vacíos con botón en Contenidos,
  Calendario, Biblioteca, Encargos y Analítica (sin cuenta: «Conectar Instagram»,
  sin periodo ni informes).
- **Conectar Instagram:** con OAuth disponible, «Conectar con Meta» es el principal y
  el token pasa a «Opciones avanzadas»; sin él, una frase lo explica («La conexión
  con Meta aún no está activada en la plataforma») y a quien administra la
  plataforma le lleva a Integraciones.
- **Por qué no salía el botón de Meta en staging:** es **configuración**. El botón
  necesita App ID, App Secret, claves de cifrado, la dirección de retorno (se deduce
  de `SUPABASE_URL`) y `SOCIAL_APP_URL`; en staging falta **`SOCIAL_APP_URL`**
  (`META_LOGIN_CONFIG_ID` es opcional). «Probar conexión» daba OK porque no lo
  comprobaba: ahora lo comprueba (`integrations/probes.ts`, hay que redesplegar
  `platform-integrations`) y «Qué ve la gente» enseña la fila del botón de Meta.
- Pruebas: `components/…` en `contenidos.test.tsx` (cabecera del editor, teclado),
  `social/avisosResolubles.test.tsx`, `status.test.ts`, `holdAdvice.test.ts`, caso
  nuevo en `tests/db/integraciones.test.ts`; e2e 09, 11, 13, 20, 21 y 27 abren «⋯»
  con `accionDelMenu` (`tests/e2e/apoyo.ts`), y la tanda e2e se ejecuta en CI (ver «Pruebas»).

### «Editar foto» a pantalla completa (rama `f15/editar-foto-pantalla`, 21/11/2026)

Implementado y probado en componentes (992 pasan): «Editar foto» ya no es una
ventana emergente sino una pantalla propia con la foto grande y una columna de
controles; desde el editor, «Aplicar a la capa» cambia la capa al momento (se
deshace/rehace con el editor) y «Volver a la foto original» recupera la original
en cualquier momento; desde la biblioteca, «Guardar copia» con «Deshacer». Arregla
la vista previa del fondo, la mejora automática reversible y la vista previa
grande. Pendiente: revisión a mano en navegador (escritorio y 375 px). Las e2e 25 y 26 pasan en CI;
la 22 falló el 22/11 al cerrar la pantalla con Esc (prueba corregida para usar «Volver»). Detalle en `docs/edicion-fotos.md` §11.

### Ediciones sencillas del editor (rama `f13/edicion-sencilla`, 21/11/2026)

Detalle y límites en `docs/edicion-fotos.md`, sección 10.

- **Implementado y probado (unidad, componentes y base de datos):** ajustes de
  foto (brillo, contraste, saturación, temperatura, nitidez) y 7 filtros
  rápidos; girar, voltear, enderezar y recortar (libre o por proporción);
  fondo detrás de la foto (color, degradado, foto desenfocada) y sombra bajo el
  plato; quitar el fondo y desenfocar el fondo del plato (foto nueva, en el
  navegador); contorno, sombra y fondo del texto; sombra de las formas; 7
  figuras y pegatinas nuevas. Todo se guarda en la capa (documento **v5**), se
  deshace con Ctrl+Z, es por página en carruseles y el lienzo y la exportación
  lo dibujan con el mismo código.
- **Migración** `20261211010000_templates_document_v5.sql` (con vuelta atrás y
  prueba en `tests/db/edicion-sencilla.test.ts`): la tabla de plantillas acepta
  la v5. **No aplicada en staging ni en producción.**
- **IA:** solo «Cambiar el fondo con IA…» (OpenAI, ya existente, tras su
  interruptor); sin proveedor, el botón no sale. El resto es del navegador.
- **Quitar el fondo** queda detrás de `photo-edit/cutout/remover.ts` para
  cambiar de motor (otro agente compara alternativas a IS-Net).
- **Arreglo incluido:** el lienzo carga las imágenes como la exportación
  (`canvas/imageStore.ts`), lo que evita «Imagen no disponible» al insertar
  desde el selector; barra «Añadir» con desplazamiento en móvil; posición y
  tamaño enteros al soltar.
- **Sin probar:** a mano en un navegador (dibujo con Konva, recorte arrastrando
  el marco, descarga del modelo de recorte) ni en e2e de Playwright.
- **Pendiente:** prueba e2e del editor con las ediciones; decidir el motor de
  recorte definitivo.

### Editor de piezas, tanda 2 (rama `f16/editor-tanda2`, 21/11/2026)

Auditoría en staging del 21/11/2026. Detalle de plantillas en `docs/importar-publicaciones.md` (sección 2) y del resto en `docs/edicion-fotos.md` (sección 11).

- **Plantillas desde el editor.** «Guardar como plantilla…» en «⋯» (nombre; se guarda el diseño tal como está, aunque no esté guardado como versión): origen nuevo `editor` en `brand_design_templates`, análisis sacado del propio documento, tope de 50 por marca y «Borrar» en las propias. **Migración `20261212010000_editor_templates.sql`** (con vuelta atrás en `supabase/rollbacks/`; casos en `tests/db/aislamiento.test.ts`). **No aplicada en staging ni en producción.** Sin ella, guardar da el error del servidor «el origen debe ser…».
- **Plantillas de otra proporción o número de páginas.** Ya no se rechazan: se adaptan con los anclajes de cada capa (`templates/fit.ts`) y el diálogo dice antes de aplicar qué cambia (proporción, páginas que sobran o se copian); un solo paso de Ctrl+Z. «Nueva idea» sigue usando la red y el formato de la plantilla.
- **Pantalla del editor sin scroll de página** (petición del dueño): el editor mide justo la ventana, sin pie legal; solo hacen scroll los paneles. Cabecera de una línea, barra «Añadir» compacta, secciones plegables en el panel (Posición y tamaño y Luz y color abiertas), deslizadores con el valor al lado, zoom «ajustar» y Ctrl+rueda o pellizco. Prueba en navegador real: `npm run test:layout`.
- **Móvil (375 px).** Lienzo al ancho disponible (9:16: de 101×179 px a unos 280×497) y paneles en una hoja inferior con pestañas de 44 px; miniaturas de páginas más pequeñas; asas de transformación más grandes con puntero táctil.
- **Menú lateral plegable** en toda la app (petición del dueño): botón «Ocultar menú / Mostrar menú», Ctrl+B (no actúa mientras se escribe en un campo), barra de iconos con ayuda; se recuerda en el navegador; el editor lo pliega solo por debajo de 1440 px sin tocar la preferencia guardada. En móvil sigue el menú inferior.
- **Exportación.** Prueba de píxeles (`tests/layout/exportar-pixeles.spec.ts`): el PNG y el JPEG coinciden con el lienzo (diferencia media 0 en PNG y 0,4 de 255 en JPEG en las escenas probadas), con control negativo. Si una imagen no carga, exportar ya se detenía con un aviso que nombra la imagen (comprobado); no hizo falta cambio.
- **Atajos.** Fallo corregido: tras cerrar un diálogo (elegir o editar una foto) el foco podía quedar en la página y Ctrl+Z, Ctrl+S, Supr, flechas y Esc no hacían nada; ahora el editor escucha en el documento (ignora diálogos abiertos y campos de texto). Probados: Ctrl+Z, Ctrl+Mayús+Z, Ctrl+Y, Cmd en macOS, Ctrl+S, Supr, flechas y Mayús+flechas, Ctrl+G, Ctrl+Mayús+G y Esc (`atajosEditor.test.tsx`).
- **500 de `media-storage/sign`: mismo origen, no arreglado.** El editor pide las URL de las fotos por `signStoragePaths` → `media-storage/sign`, el mismo punto que el editor de reels. Causa probable (sin verificar; no se ha tocado ningún servidor): `assetsForPaths` hace también una consulta por `thumb_path` (migración `20261209010000`); si la función está desplegada con esa columna y la migración no está aplicada en ese proyecto, la consulta falla y la función contesta 500 `internal`. Comprobarlo: `select 1 from information_schema.columns where table_name='media_assets' and column_name='thumb_path'` en staging y el registro `internal` de la función. Además esa función registra solo el nombre del error, lo que dificulta el diagnóstico.
- **Sin probar:** el pellizco táctil y los gestos en un móvil real (solo emulación y pruebas); el editor contra un Supabase real en esta rama (no hay Docker aquí): componentes, base de datos y navegador con cliente simulado.
- **Pendiente:** e2e del editor con Supabase local para guardar plantilla y exportar de verdad; una vista de gestión de plantillas en la marca (hoy solo se borran desde «Desde una plantilla»).

### «Fondo con IA» claro (rama `f45/fotos-ia`, 22/11/2026)

- Implementado: un solo recorte por foto (reutiliza el de la sesión o el alfa de la foto), resultado
  a la vista con Antes/Después, «Usar esta», «Probar otra vez» y coste de cada intento, progreso por
  fases del recorte con tiempo y cancelar, un texto de privacidad según el motor, términos neutros
  y fondos/avisos según el sector de la marca. Detalle en `docs/edicion-fotos.md` §14.
- Probado: unitarias, componentes y `test:layout` (375 y 1366 px, IA simulada). **No probado**: IA
  real, recorte real con BEN2 o con Fly, y el aviso neutro contra OpenAI (solo respuestas simuladas).
- Pendiente: el aviso de «Animar con IA» sigue hablando de comida (zona de la biblioteca).

### «Quitar el fondo» en el servidor tarda a veces 3 minutos (rama `f47/cutout-lento`, 23/11/2026)

En staging un recorte tardó 54 s y otro más de 176 s (detalle en `docs/alojamiento.md`, §3.1).

- **Diagnóstico:** el modelo va dentro de la imagen (no se descarga al arrancar). Causa más probable:
  la cuota de procesador de la máquina `shared-cpu-2x` de Fly (0,125 núcleos garantizados; un recorte
  necesita ~40 s de procesador). **Deducido** del registro y del código y cuadrado con la documentación
  de Fly; **sin comprobar** en las métricas de Fly.
- **Implementado y probado en local:** registro por fases (`cutout.phase`, `cutout.heartbeat`, con
  procesador, memoria y tiempo robado); el modelo en un proceso hijo, para que el trabajador siga
  renovando la reserva y pueda cortar un recorte cancelado; en el panel, paso inmediato al recorte del
  navegador al vencer el plazo y aviso en la barra. Medido con el modelo real: 19,9 s en total, 17,8 s de
  inferencia, 2,2 GB de pico.
- **Sin desplegar:** la imagen del trabajador y la web. **Sin probar:** en Fly (memoria con dos
  procesos, tiempo robado visible desde dentro de la máquina) y en un navegador real.
- **Decisión del dueño:** pasar la máquina a `performance-2x` (~0,10 $/h mientras trabaja, ~2,2 $ por
  cada 1000 recortes) o quedarse como está. El plazo del navegador sigue en 3 minutos.

### Quitar el fondo en el servidor con el trabajador de Fly (rama `f21/cutout-fly`, 22/11/2026)

Decisión del dueño: BEN2 en el servidor con la máquina de Fly que ya existe (detalle en
`docs/edicion-fotos.md`, §7). **Implementado y probado en local:** trabajo `media.cutout` en el
trabajador (BEN2 fp16, `onnxruntime-node`, 2 hilos, arena desactivada, sesión liberada por trabajo);
migración `20261214010000_media_cutout.sql` con vuelta atrás; cadena del panel (navegador con BEN2 →
trabajador → IS-Net refinado; la función de Vercel de `f18` queda **apagada por defecto**).
**Medido en escritorio:** ~17–18 s por foto, ~2,2–2,3 GB de pico (también con 12 MP), plato blanco
del coulant conservado. **Sin probar:** imagen Docker (ahora Debian, modelo con sha256 fijado),
tiempo y memoria reales en Fly, panel contra el trabajador real. **Pendiente del dueño:** aplicar la
migración, desplegar el trabajador, subir la máquina a 4 GB (pasos en el informe de la rama).

### Recorte de fondo: refinado y servidor (rama `f18/recorte-refinado`, 22/11/2026)

El dueño vio que «Quitar el fondo» sin WebGPU (IS-Net) recortaba mal un chuletón
en bandeja, y que en el panel del restaurante sale bien. Causa (detalle en
`docs/edicion-fotos.md`, §7): el modelo era el mismo, pero rrss encogía la foto con
bilinear y escalaba la máscara sin limpiarla ni pegarla a los bordes de la foto.

- **Implementado y probado:** entrada de IS-Net con promedio de área; limpieza de
  motas, islas y agujeros y filtro guiado a resolución completa (`cutout/refine.ts`,
  portado del panel); BEN2 con solo la limpieza; modelo uint8 de 45 MB alojado en
  `public/models/`; cadena navegador (BEN2 con WebGPU, si no IS-Net) → servidor;
  función `api/cutout-mask.ts` (sesión validada, permiso de edición de la marca,
  topes de 60 por persona y día y 600 por marca y mes, límite de 4 MB) y
  migración `20261213120000_cutout_server_usage.sql` con su vuelta atrás.
- **Medido:** la máscara del servidor es idéntica a la del navegador (IoU 1,000);
  ≈ 2,1 s y ≈ 290 MB por foto en local; paquete de la función ≈ 115 MB (límite 250).
- **Sin probar:** el fallo exacto de la captura del dueño (no se tiene su foto; en
  las 12 de prueba la mejora se ve, pero el defecto original era menor); la función
  **desplegada en Vercel** (arranque en frío, CPU real, que el paquete lleve los
  binarios); BEN2 con WebGPU real (sigue igual que en `f17`); el refinado sobre
  fotos de 12 MP reales (solo una copia sintética).
- **Pendiente del dueño / de despliegue:** aplicar la migración en staging; que el
  proyecto `rrss` de Vercel tenga `SUPABASE_URL` y `SUPABASE_ANON_KEY` (o las
  `VITE_` equivalentes) para la función; mirar `GET /api/cutout-mask` tras el
  primer despliegue. El plan Hobby de Vercel es solo para uso no comercial y da
  4 h de CPU al mes para todo el equipo.
- **Límite conocido:** el plato blanco sobre mantel claro lo pierde IS-Net (también
  en el panel); con BEN2 (WebGPU) sale bien.
- **Sin reproducir:** la pieza que falló al dueño (`chuleton-de-vaca-madurada-post-1080x1080-v1.jpg`, en la biblioteca de staging) no se ha podido descargar desde esta sesión (acceso a staging denegado); el corte en diagonal quedó **explicado** (22/11): esa pieza es un post ya diseñado y la franja de texto tapa la bandeja, no es un fallo del recorte. Con el plato blanco del coulant, BEN2 lo conserva y IS-Net (también el del panel) lo pierde.

### Flecos del editor, «Editar foto» y la biblioteca (rama `f31/flecos-editor`, 22/11/2026)

- **Esc sin foco:** «Editar foto» recupera el foco si el botón pulsado desaparece y, si Esc llega al documento con el foco perdido, también cierra (con la misma pregunta de descartar). Probado en componentes.
- **Recorte en el servidor (`media.cutout`):** al leer el alfa se **borra el PNG intermedio** de «Ediciones» (solo si sigue siendo el de ese trabajo: procedencia, carpeta y nombre «Sin fondo · …» sin tocar); si se cancela cuando ya había terminado, también se limpia. Tras recortar o cancelar, la biblioteca se refresca sola. No se reutiliza como resultado: es más simple y seguro que dar a un archivo automático la procedencia de una edición.
- **Pincel de retoque:** medido con `scripts/medir-guardado-retrato.ts` (Node, 12 MP, 40 trazos): aplicar los trazos tardaba **2,4 s**, el modo retrato 1,3 s y la sombra del fondo 0,6 s en el hilo principal (más en un móvil). Ahora el trazo es ~2× más rápido (1,1 s) y el guardado con retoques o retrato a tamaño completo corre en un **worker** (`portrait/retouch.worker.ts`; sin Workers, en el hilo principal como antes). El fondo de color con sombra sin retoques sigue en el hilo principal (0,6 s). **Teclado:** Tab entra en la foto, flechas mueven el pincel (Mayús, a saltos), Espacio o Intro baja y sube el lápiz, `[` `]` tamaño, `X` añadir/quitar, Ctrl+Z deshace un trazo, Esc levanta el lápiz.
- **Plantillas de la marca:** Marca → Identidad visual → «Plantillas de la marca»: lista con miniatura, origen (Importada, Manual, Del editor), renombrar, duplicar y borrar. Migración `20261220010000` (`rename_design_template`, `duplicate_design_template`, tope de 50 del editor) con vuelta atrás y pruebas de permisos.
- **Guías y zonas seguras:** con varias capas se ajusta la caja conjunta a los bordes y centros del lienzo y de las capas que no se mueven (`snapGroup`). Las publicaciones de Instagram en 1:1 y 4:5 enseñan la franja que recorta la rejilla 3:4 del perfil (12,5 % por lado en 1:1; 3,1 % en 4:5): **cálculo propio, orientativo, sin cifra publicada** (el catálogo lo marca como tal).
- **Sin probar:** nada a mano en un navegador real (pincel con teclado, arrastre de varias capas con las guías, miniaturas de la lista de plantillas a 375 px); el worker real del guardado (en las pruebas es un doble); la migración en staging.

### Menú de 5 secciones con «＋ Crear» (rama `f50/menu-simple`, 23/11/2026)

Cambio 4 de la propuesta de simplificación aceptada (`rrss-recursos-comparativa/simplificacion/`).

- **Menú lateral:** selector de marca (el único, como antes), botón **«＋ Crear»** y cinco secciones: Inicio, Contenidos, Calendario, Biblioteca y **Resultados** (antes «Analítica»; la ruta sigue siendo `/analitica`). Con la marca en modo agencia se añade Encargos. Antes: 8 entradas (9 con Campañas y 10 en agencia), sin botón de crear.
- **«＋ Crear»** (`src/layout/CreateMenu.tsx`): Publicación, Carrusel, Reel, Historia (abren la ventana «Nueva idea» de siempre con ese formato), «Hacer un reel como este» (si el servidor puede), Subir fotos (Biblioteca) y «Preparar un plan con IA» / «Pedir un plan a la agencia» (Calendario → Campañas con la ventana abierta, `?nuevo=1`). Cada entrada sale según los permisos de siempre; quien solo mira no tiene el botón. `CreateContentDialog` no se ha tocado.
- **Menú de la cuenta** (abajo a la izquierda; el avatar en móvil): Marca, Equipo, Configuración y, para quien administra la plataforma, Integraciones y Plataforma; luego apariencia, «Mi cuenta y privacidad» y cerrar sesión. En móvil lleva además Resultados (y Encargos con su insignia, que también sale en el avatar).
- **Móvil:** barra inferior Inicio, Contenidos, «＋», Calendario y Biblioteca; ya no hay hoja «Más».
- **Campañas dentro de Calendario:** pestañas «Calendario · Campañas» en la cabecera de las dos vistas (solo si hay forma de preparar un plan). Rutas nuevas `calendario/campanas` y `calendario/campanas/:id`; **`/campanas` y `/campanas/:id` redirigen** (con su `?…` y `#…`). `/marca`, `/equipo`, `/ajustes/*` y `/plataforma/*` no cambian. Sin IA de texto ni agencia, la lista vuelve al calendario (antes, al inicio).
- **Una sola forma de crear:** el Inicio ya no repite las cuatro tarjetas de crear (Nueva publicación, Nuevo reel, Reel como este, Subir fotos).
- **Autogestión sin planes:** en modo `self`, la importación de publicaciones dice «Ocupan espacio en la biblioteca» (no «de tu plan») y una publicación detenida por el plan se explica sin hablar de planes y sin «Cambiar de plan» (calendario, ficha e Inicio). En modo `agency`, igual que antes.
- **Probado:** componentes (`permisosMenu`, `baseRobusta`, `inicio`, `campanas`, `avisosResolubles`…) y `test:layout` en Chromium real (`tests/layout/menu.spec.ts`: a 375, 1024 y 1366 px el menú se ve, «＋ Crear» y lo que abre caben en pantalla y no hay scroll de página en el calendario). E2E adaptadas (`irAAjuste` en `tests/e2e/apoyo.ts`; 03, 05, 14 y 15) **sin ejecutar** (necesitan Supabase local).
- **Pendiente de la propuesta (otras tandas):** quitar el pie legal de cada página (pasaría al menú de la cuenta), editores a pantalla completa en móvil, «Cambiar de marca» dentro del menú de la cuenta, el botón «Nueva idea» de Contenidos (zona de otro agente: ahora duplica a «＋ Crear») y el «⋯» del Calendario con filtros y objetivo.

### Copiloto fiable y «Hacer un reel como este» tras la prueba real (rama `f56/copiloto-fiable`, 23/11/2026)

Fallos 5, 6, 7 y 16 de la prueba de punta a punta del 23/11 (`rrss-recursos-comparativa/e2e-calidad/INFORME.md`).
Detalle en `docs/copiloto-voz.md` §16 y `docs/reel-como-este.md` §13. Sin migraciones.

- **Lo que dice el copiloto sale de lo aplicado** (fallo 6): la nota de la IA que dice haber hecho algo no se enseña;
  sin cambios se dice «No he cambiado nada» y por qué; un texto no dictado se descarta diciendo cuál. «Que la foto llene
  todo» llena el lienzo de verdad (`fit: canvas`).
- **Entiende al negocio** (fallo 7): sin pedir un fondo, una foto real a sangre (`fill`) con el fondo con IA como opción;
  titular de la ocasión y llamada a la acción del perfil en una pieza en blanco; búsqueda por intención sin exportaciones
  ni diseños; recortes encajados por su zona opaca; titulares con mayúscula inicial y colores de la marca (o etiqueta de
  la marca).
- **Coste** (fallo 16): «Sin IA» solo sin gasto; si hubo, «Con IA: 0,14 créditos».
- **«Hacer un reel como este»** (fallo 5): vídeo de la biblioteca, aviso de Instagram antes de pegar, pieza siempre nueva,
  el nombre de «Nuevo reel» se conserva y el pie del análisis llega a la pieza.
- **Probado** con todo simulado: unitarias y componentes (`calidad.test.ts`, `copilotoHonesto.test.tsx`,
  `like/reelLike.test.tsx`), base de datos y el banco del copiloto en seco (101 casos, grupo nuevo `calidad`).
- **Sin probar:** nada con IA real (que el modelo devuelva `fill`, `canvas` y consultas por intención), ni en un navegador
  real (etiqueta de marca a la vista, medida de un recorte real con CORS, leer un vídeo de la biblioteca de R2 o Drive).
- **Desplegar:** la aplicación y después `ai-generate` (enumeraciones nuevas `fill` y `canvas`: un editor anterior
  rechaza entera la respuesta que las traiga).

### Estados de publicación, calendario y selectores (rama `f57/estados-calendario`, 23/11/2026)

Fallos 9, 10, 17, 19 y 22 de la prueba de calidad en staging
(`rrss-recursos-comparativa/e2e-calidad/INFORME.md`), más la barra inferior móvil. Sin migraciones.

- **Lo publicado se ve publicado (fallo 10).** Fuera del editor, una pieza publicada dice
  «Publicada el … a las …» con «Ver en Instagram» y «Abrir la pieza»: tarjeta y lista de
  Contenidos, «Calendario → Programar» y la ficha. Tocarla en el calendario abre su ficha (no la
  vista rápida). No se ofrece para programar ni publicar: en «Programar» sale como «Publicada el…»
  y no se puede elegir; abierta con ella, no deja guardar; «Publicar ahora» lo dice en vez de
  pedir confirmación. «Publicar otra vez…» avisa de que saldrá repetida y hace una **copia** (la
  base de datos solo admite una publicación viva por pieza, índice
  `scheduled_publications_one_per_content_idx`).
- **Cómo se lee «publicada»** (para el editor, que lo hace otro agente): la pieza NO cambia de
  estado al publicarse; lo dice su publicación (`scheduled_publications.status = 'published'`,
  siempre con `external_id` y `published_at`). `src/features/social/publishedState.ts`:
  `usePublishedState(brandId, contentId)` → `{ published, publication }`, `publishedInfoOf(pub)`,
  `usePublishedContents(brandId)` (mapa por pieza) y `publishedText()`; componente
  `PublishedNotice` (aviso con enlace, «Abrir la pieza» y «Publicar otra vez»).
- **Sin cuenta conectada (fallo 9).** `src/features/social/connectedAccount.ts`:
  `useConnectedAccount(brandId, network?)` → `{ connected, state: 'connected' | 'needs_reauth' |
  'none', account, isLoading }` y `connectionOf(accounts)`; componente
  `NoConnectedAccountNotice` («No hay ninguna cuenta conectada» o «El acceso … ha caducado» con el
  botón a Marca → Cuentas conectadas). Ya lo usan «Programar» (con «Ahora», no deja seguir),
  «Publicar ahora» y «Aprobar varias» del calendario. **El editor** («Aprobar y publicar ahora»)
  tiene que consultarlo antes de aprobar: es de la rama f53.
- **Exportaciones aparte (fallo 17).** «Exportaciones» sale al final del árbol de la biblioteca
  (y del selector del móvil), separada, y no cuenta ni aparece en «Toda la biblioteca»; un aviso
  enlaza a ella. `useAssets` (selector «Poner foto» del editor y referencias de la IA) y
  `fetchRecentImages` (búsqueda del copiloto) dejan fuera, en la consulta, lo que ya diseñó la
  aplicación (exportaciones, portadas, carpetas Exportaciones/Reels/Informes). «Guardarla
  también en la biblioteca» al exportar se recuerda en el dispositivo
  (`rrss.exportar.guardarEnBiblioteca`). No se borra ni se mueve nada.
- **Nombres que se distinguen (fallo 19).** `library/assetNames.ts` (`distinctNames`): si varios
  nombres largos empiezan igual, la tarjeta enseña el final del nombre (o la carpeta, si son
  iguales); el nombre entero, al pasar el ratón (`title`) o al mantener pulsado (`useNameReveal`,
  no elige la foto). En el panel de fotos y la rejilla de la biblioteca. **El selector «Poner
  foto» del editor** (`content/editor/AssetPickerDialog.tsx`, rama f53) sigue cortando con CSS:
  debe usar `distinctNames` + `AssetName`.
- **Selector de marca (fallo 22).** Una organización con una sola marca del mismo nombre
  («EnerGym» en «EnerGym») sale una vez, como marca que se pulsa (antes, título que no hacía nada
  + marca); el selector no repite el nombre debajo. El avatar se anunciaba «Cuenta de Oficiosos»
  (el nombre de la persona), que se leía como otra organización: ahora «Tu usuario: … ·
  organización …» y el menú empieza por «Organización: …» de la actual. La pantalla de campañas
  (zona de otro agente) no tenía texto propio con la organización.
- **Barra inferior móvil:** «Calendario» y «Biblioteca» ya no se tocan a 360-402 px (letra algo
  menor, margen y «…» si no cabe; área táctil igual).
- **Probado:** componentes nuevos (`social/estadoPublicada`, `library/exportacionesYNombres`,
  casos en `calendario`, `calendarioVistas`, `exportarImagen`, `selectorUnico`) y
  `tests/layout/menu.spec.ts` a 360 y 402 px. El Supabase simulado entiende ahora `.or()` y
  `.not('in' | 'like')`. **Sin probar:** contra el Supabase real (el filtro `provenance->>type`
  de PostgREST) y en un móvil real (la pulsación larga).

### Calendario y Biblioteca más sencillos (rama `f57/estados-calendario`, 23/11/2026)

Apartados 8 (L1–L4) y 9 (B1–B4) de `rrss-recursos-comparativa/simplificacion/CAMBIOS.md`.

- **Calendario (L1, L2, L4).** A la vista quedan 9 acciones (antes 33): las pestañas Calendario ·
  Campañas, «Programar», «⋯», ‹ Hoy › y Semana / Mes. «Programar» abre las piezas sin fecha
  primero (grupo «Sin fecha (N)»); ya no hay «Por programar» ni «Programar este día» ni el «+» de
  cada día: un día sin nada se programa tocando su hueco. En «⋯»: preparar un plan con IA (o pedirlo
  a la agencia), «Objetivo semanal: N» (una ventana pequeña), Filtrar (la red solo si hay más de
  una), Ver en lista y Aprobar varias. Una línea «Esta semana 1 de 3 · 4 sin fecha». La hora de la
  marca solo se dice junto al título si no es la del dispositivo (y siempre en la hoja de
  programar). El mes ya no pliega semanas. En el móvil, la semana como agenda (un día por fila) con
  «Programar» arriba; la lista de cuatro semanas sigue en «⋯ → Ver en lista».
- **Plan propuesto (L3).** Una campaña «propuesta» (sin aceptar) sale como aviso arriba del
  calendario («Plan propuesto «…»: N piezas en gris hasta que lo aceptes» → «Revisar el plan», la
  ficha de la campaña, que se mantiene) y sus piezas en gris y sin acciones en su día. Se lee de
  Campañas desde fuera (`useCampaigns`, `useCampaignsOverview`); `src/features/campaigns/**` no se
  ha tocado. Aceptar o descartar sigue en la ficha.
- **Biblioteca (B1–B4).** Fichas Todo, Fotos, Vídeos y **Audios** (nueva, para la música de los
  reels). Orden, «Filtrar por etiqueta…», «Solo las que no se usan», tamaño de las miniaturas,
  «Elegir varias» y las acciones de la carpeta (nueva, renombrar, eliminar) en el «⋯» de la
  cabecera; sin casilla visible en cada miniatura (salen al elegir varias, con Ctrl/⌘ o Mayús, o
  manteniendo pulsada una en el móvil). Carpetas de primer nivel plegadas (las de dentro, al
  entrar); «Ediciones», «Exportaciones», «IA», «Reels» e «Informes» dentro de «Hechas aquí»; en el
  móvil, el desplegable «Carpeta». Las miniaturas y la ficha enseñan un nombre legible
  («Portada reel», no «portada-reel-20261123-085833.jpg»); el del archivo, en la ficha y al pasar
  el ratón (`library/readableName.ts`). Logotipos, fondo quitado e IA ya no son fichas: están en su
  carpeta.
- **Probado:** componentes (`calendarioVistas`, `biblioteca`, `exportacionesYNombres`) y
  `test:layout` en Chromium real: `calendario.spec.ts` y `biblioteca-analitica.spec.ts` cuentan las
  acciones visibles a 1366 y 375 px (calendario ≤ 9; biblioteca ≤ 12 y ≤ 9), las cuatro fichas en
  una fila a 375–1366 px y la semana-agenda del móvil. **Sin probar** en un móvil real ni contra la
  demo.
- **Pendiente de otra rama:** `src/features/reels/reels.test.tsx` («sin trabajador de medios
  desplegado no aparece nada») comprueba que no exista `library-more`; con B2 el «⋯» de la cabecera
  existe siempre (orden, etiqueta…). Hay que quitar esa línea (la zona de reels no se ha tocado
  aquí); lo que quería probar —que no se ofrezca «Montar un reel»— ya lo comprueba
  `library/biblioteca.test.tsx`.
- **Comprobaciones (23/11, tras fusionar la base):** typecheck y lint (0 errores) en verde;
  `npm test` 2143 de 2144 (la de arriba); `test:db` 1277 (4 omitidas); `build` en verde;
  `test:layout` 152 de 152.

### Editor de reels como CapCut, con un solo «Exportar» (rama `f52/reels-capcut`, 23/11/2026)

Cambio 1 de la propuesta de simplificación aceptada, más los fallos 4, 9, 10, 11, 12 y 24 de la prueba de punta a punta
del 23/11 (`rrss-recursos-comparativa/e2e-calidad/INFORME.md`). Detalle en `docs/editor-reels.md` §11. Solo interfaz:
sin migraciones, sin tocar el plan v2 ni el trabajador.

- **Pantalla:** vídeo grande, línea de tiempo debajo y una sola barra que cambia con lo elegido (con un clip: Dividir,
  Duración, Velocidad o Movimiento, Filtro, Sustituir y «Más»). Cada herramienta abre solo su ajuste (panel estrecho al
  lado o hoja en móvil). Cabecera: volver, nombre, guardado, deshacer, «⋯» y **«Exportar»**. Plantilla dentro de
  «Estilo». En móvil, a pantalla completa, por encima de la barra de la aplicación.
- **Acciones a la vista con un clip elegido:** 52 → 13 (1366 px) y 22 → 12 (375 px; antes, además, las 7 de la app).
- **«Exportar»:** monta si hace falta (guardando antes la versión) y abre una hoja con Descargar, Guardar en la
  biblioteca y Publicar o programar, más portada, vídeos anteriores y avisos en una línea sin jerga. El vídeo se
  reconoce por su montaje: cambiar solo el pie no pide montar otra vez. Con un archivo borrado no se monta y lleva a él.
- **Publicar o programar:** pie y hashtags (se guardan en `copy` del reel, que es lo que lee el publicador: los reels
  dejan de salir sin texto), «Redactar con IA» si está configurado, el pie de «Hacer un reel como este» si lo hay,
  «Ahora» o «Programar…» con el vídeo recién montado sin elegirlo, aviso de cuenta sin conectar **antes** de aprobar,
  y «Publicada» con fecha y enlace a Instagram («Publicar otra vez» hace una copia, porque la base de datos publica
  cada pieza una vez). Sin texto alternativo: Instagram no lo admite en reels.
- **Aprobación:** en autogestión no se ve; «Publicar o programar» aprueba por debajo con los pasos de
  `set_content_status`. En modo agencia, el flujo de siempre (el siguiente paso en la hoja; los demás en «⋯»). Sin
  textos de «cupo» en autogestión (reel como este y subtítulos).
- **Avisos flotantes** en móvil por debajo de la cabecera (no tapan «Exportar» ni la barra). «Nuevo reel → Desde una
  plantilla» va directo a pedir las fotos, sin volver a enseñar la galería.
- **Probado:** unitarias y componentes (`exportFlow`, `editorPro`, `editorReels`, `mediosBorrados`, `reelLike`) y
  `test:layout` en Chromium real. La prueba intermitente del guardado al salir espera a lo que de verdad hace falta.
- **Sin probar:** móvil y Safari reales; publicar y programar contra Supabase y Meta reales; la e2e 29 (adaptada, sin
  ejecutar); «Redactar con IA» con proveedor real. Una aserción de `src/features/content/contenidos.test.tsx` se cambió
  porque miraba la cabecera vieja del editor de reels (`reel-version`).

### Integraciones: una fila por función y una hoja con «Guardar y probar» (rama `f58/integraciones-simple`, 23/11/2026)

Cambio 10 (I1–I4) de la propuesta de simplificación aceptada. Detalle en `docs/integraciones-sencillas.md` §0.

- **Antes:** 115 controles en 7.591 px (9.589 px en móvil) y unas 1.250 palabras. **Ahora:** 10 controles en 792 px a 1366 px (872 px a 375 px), unas 80 palabras; 9 en uso interno.
- **Lista:** «N de M funciones listas» y una fila por función (OpenAI, Instagram, R2, Fly, Drive y, si no es uso interno, Stripe) con su estado y una acción; Claude, fal.ai, ComfyUI y «Otras imágenes» en «Opcionales», plegado. Fuera «Con esto se enciende» y la lista de 8 funciones.
- **Hoja** (al tocar la fila): estado, última prueba, la clave y un único botón **«Guardar y probar»**; borrar en «⋯»; modelos, región, URL, precios (US$, LiteLLM), «Usar estos precios» y coste real en «Opciones avanzadas». Cada hoja sigue probando solo su proveedor; el aviso de coste va junto al botón.
- **I4:** ya estaba hecho por `f50/menu-simple` (Integraciones en el menú de la cuenta); no se ha tocado.
- **Probado:** componentes (`integraciones.test.tsx`, `usoInterno.test.tsx`) y `test:layout` en Chromium real (`tests/layout/integraciones.spec.ts`, banco `integraciones.html`: a 375 y 1366 px, ≤ 11 controles, sin scroll lateral, hoja con «Opciones avanzadas» abierto que cabe a lo ancho). Solo interfaz: sin cambios en funciones ni migraciones.
- **Sin probar:** e2e 18 y 21 (adaptadas; necesitan Supabase local); a mano en un navegador o un teléfono reales.

### Inicio y Resultados más limpios (rama `f59/inicio-resultados`, 23/11/2026)

Cambios H1 y A1 de la propuesta de simplificación aceptada (`rrss-recursos-comparativa/simplificacion/`, apartado 11).

- **Inicio:** sin «Tu rol: Gestor» bajo el nombre de la marca (solo el sector). La semana va ahora **de lunes a domingo** (antes: hoy y los seis días siguientes), con los días pasados atenuados, y lleva la ficha **«N de M publicadas»** (en móvil, «N de M»): M = lo programado esta semana sin contar lo cancelado; N = lo que de verdad salió (programado no cuenta como publicado). Sin nada en la semana no hay ficha. «Abrir el calendario» pasa a «Ver calendario». Lo último publicado enseña su **enlace a Instagram** («Ver en Instagram», icono en móvil) cuando la publicación tiene `external_url`, aparte del enlace a la pieza. Las cuatro tarjetas de crear ya no estaban (`f50`). El aviso del perfil de marca incompleto no se ha tocado (lo cambia `f55`).
- **Resultados** (antes «Analítica»; la ruta sigue siendo `/analitica`): **tres cifras grandes** (Personas alcanzadas, Interacciones, Seguidores) en tres columnas también en móvil; cada una solo lleva la flecha con el porcentaje si hay con qué comparar. Ya no se repite «sin comparación», «sin periodo anterior», «frente al periodo anterior», «Provisional», «Estimación de Meta» ni «17 de 28 días»: **una nota al pie** dice solo lo que aplica («Cifras de Meta. Las de los últimos días pueden cambiar. Algunas son estimaciones. Los días sin cifra no cuentan como cero. Los porcentajes comparan con…»). «Lo que mejor funcionó» enseña **las tres mejores** del periodo (antes, como mucho la mitad de las publicaciones con cifra: con 2 o 3, solo una), con «Ver en Instagram». **«Veces que te han visto»** y las **cifras día a día** (antes, «Ver las cifras día a día» bajo el gráfico) pasan a «Más detalle». Textos fijos acortados: sin cuenta («Conecta Instagram: las primeras cifras llegan al día siguiente.»), sin cifras, sin publicaciones, resumen del analista y capturas.
- **Autogestión:** ninguna de las dos pantallas habla de cupos ni de planes (lo parado del Inicio ya se explicaba sin planes en modo `self` desde `f50`).
- **Probado:** unitarias (`week.test.ts`, `resumen.test.ts`), componentes (`inicio.test.tsx`, `analitica.test.tsx`) y `test:layout` en Chromium real a 375, 768 y 1366 px (`inicio-contenidos`, `biblioteca-analitica`, con una vista nueva `?vista=pocas`: cuenta recién conectada con tres días de cifras y una publicación): sin scroll lateral ni de página.
- **Sin probar:** a mano en un navegador y un móvil reales contra la demo; con cifras reales de Meta.

### Editor de piezas como Canva y un solo «Compartir» (rama `f53/editor-piezas-simple`, 23/11/2026)

Cambios 2 y 3 de la propuesta de simplificación aceptada (`rrss-recursos-comparativa/simplificacion/`), más lo que pidió el coordinador a partir de la prueba real (`e2e-calidad/INFORME.md`, fallos 9, 10, 12, 13, 17 y 18) y del dueño.

- **Acciones a la vista** (`tests/layout/editor-acciones.spec.ts`, plantilla «Oferta de la semana» con la foto elegida): ordenador 1366 px, de 58 a **21** (sin nada elegido, de 30 a 17); móvil 375 px, de 24 a **17** (sin nada, de 17 a 13). Cuenta igual que el recorrido de la propuesta (61 y 23 allí). Las 21: cabecera (volver, tipo de pieza, deshacer, rehacer, «⋯», Compartir), 5 cajones, barra de la foto (Sustituir, Editar foto, Recortar, «⋯») y la fila del lienzo (Capas, Zonas seguras, zoom −/%/+ y Copiloto). En el móvil no salen «Rehacer» ni −/+ (el zoom va con dos dedos; «ajustar» sale al acercar).
- **Riel de cajones** (`editor/rail/EditorRail.tsx`): Plantillas (la galería de siempre), Elementos (titular, texto, rectángulo, elipse y figuras), Fotos (biblioteca de la marca, tocar o arrastrar), Subidas (`PickerUpload` de la biblioteca: Subir, soltar y Crear con IA; lo subido queda a mano) y Marca (logotipos, colores —al texto o forma elegidos, o al fondo— y tipografías). En el móvil, barra inferior con hojas que se turnan y se cierran al añadir.
- **Barra flotante = acciones del elemento.** Foto: Sustituir, Editar foto, Recortar y «⋯»; texto: Escribir, tipografía, tamaño, color, alineación; forma: color. En «⋯» (y botón derecho): copiar, pegar, duplicar, encuadrar, quitar el fondo, volver a la original, quitar la foto, orden, alinear, repartir, agrupar, bloquear, **Ajustes…** y borrar. Duplicar y Borrar ya solo están ahí (y en Ctrl+D / Supr). Se coloca encima, debajo, a un lado o pegada a un borde, eligiendo donde menos pisa los textos de la página y el propio elemento (`toolbarPlacement.ts`); en ordenador queda una franja libre sobre el lienzo para ella.
- **Fuera el panel de 4 pestañas.** «Ajustes…» abre un panel con lo que no está en la barra (filtro, encaje, fondo detrás y sombra, desenfoque, transparencia, posición exacta, anclaje, nombre) y se cierra al soltar el elemento. Ya no repite Luz y color, Girar y recortar ni Parte de la foto que se ve (están en «Editar foto»); en piezas antiguas con esos ajustes en la capa se ofrece quitarlos. Capas y Zonas seguras, junto al zoom; proporción y fondo del lienzo, en «⋯ → Tamaño y fondo». Fuera el botón «Con IA» de la barra: la imagen con IA está en «Subidas → Crear con IA».
- **Un solo «Compartir»** (`editor/share/ShareSheet.tsx`): vista previa en la red, texto de la publicación (pie, hashtags, menciones, texto alternativo, Redactar con IA o Pedir a la agencia), revisión de marca en una línea que se abre, aviso de huecos sin foto con «Ir al hueco», etiqueta de IA y las salidas **Descargar, Publicar ahora, Programar… y Copiar el texto**; «Programar…» dice que no se publica hasta la hora elegida. La cabecera queda en volver, nombre, tipo de pieza, guardado, deshacer, rehacer, «⋯» y Compartir. «Guardar versión con una nota» e Historial, en «⋯»; Ctrl+S sigue guardando una versión.
- **Aprobación.** En autogestión (`organizations.work_mode = 'self'`) no hay nada de aprobar a la vista: «Publicar ahora» y «Programar…» guardan la versión y la aprueban por debajo (una idea pasa antes a borrador, como exige `set_content_status`). En modo agencia, el flujo de siempre dentro de la hoja (estado, Enviar a revisión, Aprobar, Devolver…; «Aprobar y publicar ahora»). Sin cambios en tablas ni funciones.
- **Antes de publicar:** sin cuenta conectada de la red no se ofrece publicar ni programar (ni se aprueba a medias) y se enlaza a Marca → Cuentas conectadas; una pieza ya publicada dice «Publicada el …» con el enlace a la red y no se vuelve a publicar desde ahí (para sacarla otra vez, duplicarla); una programada dice para cuándo.
- **Descargar** ya no guarda en la biblioteca por omisión; si se marca, va a «Exportaciones» y la elección se recuerda en el navegador.
- **Móvil:** editor a pantalla completa (encima de la cabecera y la barra de la app), barra inferior de cajones, barra flotante encima del elemento, aviso «Falta 1 foto» junto a Capas, Copiloto como botón redondo a la vista y avisos flotantes debajo de la cabecera. Comprobado a 375 px: el lienzo no se encoge al abrir y cerrar Capas, «Poner foto» sale en «Titular sobre foto», escribir un texto no cambia de panel, el copiloto abre al primer toque y los avisos no tapan «Compartir».
- **Del dueño:** divisor arrastrable entre cajón o panel y lienzo (240–560 px, flechas, Inicio/Fin, doble clic al de siempre, se recuerda; no en el móvil); **tipo de pieza** junto al nombre (cambiarlo recoloca las capas a la proporción del formato nuevo en un paso de deshacer; a Reel, las fotos del diseño pasan a ser los clips —borrador del reel— y se abre el editor de reels); **lo que sobresale del lienzo** se ve velado con su caja y tiradores y se agarra desde fuera (la exportación no cambia).
- **Letra por defecto:** Inter (SIL OFL 1.1, `@fontsource-variable/inter`) va incluida y es la reserva de cada texto en lienzo, campo de escribir y exportación; un texto nuevo sin letra de marca nace con ella. Antes salía Times.
- **Copiloto:** en autogestión, sus textos no hablan de cupo (sí del coste). El panel sigue acoplado a la izquierda del lienzo.
- **Contenidos:** «Nueva idea» solo en la pantalla vacía (se crea con «＋ Crear»).
- **Probado (23/11/2026, en la rama, en local):** typecheck y lint (0 errores); `npm test` 2132 de 2133 (la que falla es de `editorReels.test.tsx`, de `f52`, por tiempo con la máquina cargada: el archivo pasa entero, 42 de 42, solo); `npm run test:db` 1265 (4 omitidas); `npm run build`; `test:layout` 161 de 161 con 2 trabajadores. E2E 09, 10, 12, 13, 19, 20, 21, 23, 27 y 28 adaptadas **sin ejecutar** (piden Supabase local); la de reels no se ha tocado. `src/features/photo-edit/editarFoto.test.tsx` se adaptó solo en lo que abre «Editar foto» desde el editor.
- **Sin probar:** en un navegador y un móvil reales; publicar o programar de verdad; el paso a Reel con el editor de reels real (solo componentes); arrastrar el divisor con el dedo en una tableta.

### Historias de tapas y menú del día, y publicar historias (rama `f61/historias-tapas-menu`, 23/11/2026)

El dueño de Casa Tomás sube historias de **tapas** y del **menú**: que solo tenga que poner la foto. Se copiaron y
mejoraron las suyas (capturas en `instagram-studio/propuesta/referencias-actuales/`: lista «Jueves de tapas» sobre una
foto de sala, póster «Jueves de tapas y cóctel» y rótulo de plato). Comparativa y vistas previas en
`rrss-recursos-comparativa/historias/comparativa.html`.

- **Plantillas de historia (9:16, 1080 × 1920) en el juego `restaurante` del catálogo** (`agency/catalogo/historias.ts`):
  «Tapa del día» (un marco grande, nombre, precio en un sello y «Te esperamos en la barra»), «Tapas de la semana»
  (4 marcos en cuadrícula, cada uno con nombre y precio), «Dos tapas», «Menú del día» (primeros, segundos, postre,
  precio, «Bebida y postre incluidos» y cuándo; foto de fondo opcional bajo un velo: vacía, no sale) y «Menú del día
  con foto» (foto grande arriba y el menú en una franja clara). Colores y tipografías por papeles desde el perfil de la
  marca, como el resto del catálogo, y ahora también el **logotipo**: el tema toma el primero de
  `visual.logoAssetIds` (capa `logo`, que la base de datos exige que sea de la marca); sin logotipo salen sin él.
  Nada que leer en los 250 px de arriba ni en los 340 px de abajo (lo comprueban las pruebas de `agency/`).
- **Carga:** «Cargar plantillas del catálogo» (y `cargar-catalogo`) entregan las historias en una **segunda** llamada a
  `deliver_design_templates`, porque cada entrega admite 12 como mucho (10 publicaciones + 5 historias). Toca
  `src/features/brand/CatalogDialog.tsx` (entrega aparte y texto del recuento).
- **Zona segura de las historias** (`src/features/content/networks.ts`): 250 px arriba y 340 px abajo (fuente secundaria,
  orientativa), en vez de la caja de los reels (35 % abajo), que en una historia no tiene pie que tapar.
- **Publicar historias:** antes el formato «Historia» se preparaba pero «no se publica solo». Ahora el publicador
  (`supabase/functions/_shared/social/publisher.ts`) crea el contenedor con `media_type=STORIES` e `image_url`, sin pie
  ni texto alternativo, y lo publica con `media_publish`; si la respuesta se pierde, lo busca en
  `GET /{ig-user-id}/stories` y solo lo da por publicado si hay **una** historia en la ventana (si no,
  «published_unconfirmed», sin repetir). Programar y «Publicar ahora» funcionan igual que con una publicación de una
  imagen (una exportación JPEG de un documento de una página). Solo imagen: la historia de vídeo sigue sin publicarse
  sola. Migración `20270119010000_instagram_stories` (con su vuelta atrás) y `PUBLISHABLE_TARGETS` en
  `src/features/social/calendar.ts`; en `ScheduleDialog.tsx` y `PublishNowDialog.tsx` la historia se trata como una
  publicación de una imagen.
- **Probado:** `agency/` (catálogo, zonas seguras, logotipo, entrega en dos llamadas), base de datos (programar, publicar
  con la Graph API simulada, recuperar sin duplicar, ambigüedad, vuelta atrás, entrega de las plantillas con el
  logotipo de la marca y rechazo con uno ajeno), componentes (carga del catálogo) y `test:layout`
  (`tests/layout/historias.spec.ts`: cada historia sale a 1080 × 1920 con el exportador real).
- **Sin probar / pendiente:** publicar una historia contra Instagram real (no hay aplicación de Meta); verlas en el
  editor de staging. **En el editor** (`ContentEditorPage.tsx`, rama f53) la imagen que se publica solo se prepara sola
  para `post` y `carousel` (líneas de `exportVersion` de `ScheduleDialog` y `PublishNowDialog`): hay que añadir `story`
  allí al integrar; mientras tanto una historia se programa tras «Exportar imagen» en JPEG. Qué logotipo sale depende
  del orden en el perfil (el primero); el editor lo corrige al abrir la pieza desde `f65` (abajo).

### «Terminar en Instagram (para poner música)» (rama `f62/terminar-en-instagram`, 23/11/2026)

Los reels salen sin música y la API de Instagram no crea borradores ni pone su música. Desde «Exportar», el reel y su
pie van al móvil para ponerle la música en Instagram y publicarlo allí. Detalle en `docs/editor-reels.md` §12.

- **Móvil:** «Compartir con Instagram» copia el pie (aviso «Pie copiado: pégalo en Instagram») y abre el diálogo de
  compartir del sistema con el MP4. **Ordenador:** descarga el MP4, copia el pie y enseña un QR (enlace firmado de
  corta duración) con los pasos en tres líneas. Ayuda para cuentas de empresa y de creador sin inventar detalles.
- **Al volver:** «Pendiente de publicar en Instagram» → «Ya lo publiqué» (enlace opcional) o, con una cuenta
  conectada, la aplicación lee las últimas publicaciones (`social-import/recent`) y la empareja por tipo, fecha y pie
  (la Graph API no da la duración) y la deja «Publicada» con su enlace. El vídeo sigue saliendo sin música.
- **Base de datos:** migración `20270121010000_manual_publications.sql` (con vuelta atrás): tabla `manual_publications`
  (pendiente ≠ publicado; solo lo aprobado; una pieza o por la API o a mano), RPC con `edit` y dos del servidor.
- **Probado:** unitarias, componentes (compartir con y sin `navigator.share`, pie copiado, «Ya lo publiqué», emparejado
  automático), base de datos (PGlite y Graph API simulada) y `test:layout` a 375 y 1366 px.
- **Sin probar:** compartir a Instagram desde un móvil de verdad (Android e iOS) y escanear el QR; la Graph API real;
  la música de cuentas de empresa y de creador. El calendario y la analítica todavía no ven lo publicado a mano.
- **Para staging:** la migración y redesplegar `social-import`.

### Arreglos al montar una historia real con «Tapa del día» (rama `f65/historia-arreglos`, 23/11/2026)

Tres fallos que salieron al montar y publicar una historia de verdad con la plantilla «Tapa del día».

- **Logotipo invisible.** Antes: las plantillas ponen el primer logotipo del kit; en una marca cuyo primero es el
  oscuro, no se veía sobre la cabecera oscura. Ahora el editor mide la luminancia de cada logotipo del kit (sus
  píxeles con tinta, del archivo original) y la del color que tiene detrás (formas lisas y fondo del lienzo; sobre una
  foto no decide) y, por debajo de 3:1, pone la variante que más contrasta (`editor/logoContrast.ts`,
  `editor/useLogoContrast.tsx`). Vale al abrir una pieza si el logotipo sigue siendo el primero del kit (el que puso
  la plantilla) y al aplicar una plantilla desde el editor; lo que elige quien edita no se toca. Es un paso de
  deshacer, con aviso «Hemos puesto la versión del logotipo que se ve…», y cada capa se mira una vez por sesión. Si la
  marca solo tiene una variante y no contrasta, sale el aviso «El logotipo apenas se ve sobre este fondo» (no se tiñe
  el logotipo: haría falta un campo nuevo en el documento, la exportación y el trabajador).
- **Logotipo del cierre de los reels** (`reelLogoPath`, `reels/quality.ts`). Antes: el primer logotipo PNG, JPEG o
  WebP del perfil, aunque fuera el oscuro, sobre el fondo oscurecido del cierre. Ahora la misma regla de contraste
  con el fondo como oscuro: con la luminancia medida (parámetro opcional `tones`), la variante que llega a 3:1; sin
  medir, la que su nombre de archivo, su ruta o sus etiquetas dicen clara («claro», «blanco», «white», «negativo»…).
  **Hoy ningún llamador pasa `tones`** (`reels/editor/ReelEditor.tsx` y `campaigns/api.ts`, fuera de esta rama):
  solo actúa el nombre; si el logotipo claro de la marca no lo dice, sigue saliendo el primero. Para medirlo de
  verdad, esos dos llamadores tendrían que cargar las imágenes como hace `useLogoContrast.tsx`.
- **Doble clic en un texto.** Antes: había que elegir el texto y pulsar «Escribir». Causa: Konva solo da su doble clic
  si ninguna pulsación se mueve 3 px (si se mueve, arrastra) y la mano casi siempre se mueve algo. Ahora el lienzo
  escucha el doble clic del navegador y busca la capa bajo el puntero (`canvas/scene.ts`); el doble toque táctil sigue
  siendo el de Konva. Esc sale conservando el texto. Queda: ese primer temblor de 3 px o más sigue moviendo la capa
  unos píxeles (un paso de deshacer), como antes.
- **Plantillas de la marca en el móvil.** Antes: a 402 px el nombre salía partido («Dos / tapas») junto a Renombrar,
  Duplicar y Borrar. Ahora, por debajo de `sm`, la miniatura y el nombre van arriba y las acciones en «⋯»
  (`BrandTemplatesCard.tsx`); en el ordenador siguen a la vista.
- **Probado:** unitarias (`logoCierre.test.ts`: cierre con luminancia medida, por nombre, ruta y etiquetas;
  `logoContrast.test.ts`: claro sobre oscuro con la «Tapa del día» del catálogo, oscuro sobre
  claro, una sola variante, foto detrás), componentes (`plantillasMarca.test.tsx`: el menú «⋯») y `test:layout` en
  Chromium real: `editor-logotipo.spec.ts` (cambio al abrir, Ctrl+Z y aviso), `editor-doble-clic.spec.ts` (doble
  clic con el temblor de la mano, a 1366 y 402 px, fallaba antes del arreglo) y `plantillas-marca.spec.ts` (375, 402
  y 1366 px). Bancos: caso `tapa` de `tests/layout/marcos.tsx` (con `?logos=uno|dos`) y `plantillas-marca.html`.
- **Sin probar:** con los logotipos reales de Casa Tomás y contra Supabase (en staging); el doble clic con un ratón y
  un panel táctil de verdad; una pieza creada desde una plantilla guarda su versión 1 con el primer logotipo hasta
  que se abre en el editor (las miniaturas de las plantillas ya usan la regla de contraste: rama f67).

### Pendientes de los reels y lo publicado a mano (rama `f67/pendientes-reels`, 23/11/2026)

Ocho fallos: cuatro de la lista de pendientes y cuatro del reel real de «Fotos con ritmo» montado en staging el 23/11
(hoja `rrss-recursos-comparativa/reels-calidad/fotos-con-ritmo-staging-antes.jpg`).

- **«Hacer un reel como este» con cierre y papeles** (`reels/like/draft.ts`, `useDraft.ts`). Antes: el borrador salía
  sin cierre de marca y sus textos sin `role`. Ahora cada texto del guion lleva su papel (titular, rótulo, llamada) y,
  con perfil, el borrador lleva `outro` como `buildBrandReel` (logotipo con `reelLogoPath`, llamada, usuario,
  dirección, acento). La llamada final del guion pasa al cierre (también al rellenar su hueco), los textos acaban al
  entrar el cierre, el borrador espera al perfil y a sus logotipos, y las fotos llevan su punto de interés y su máscara
  guardados (también al rellenar un hueco desde el editor).
- **Lo publicado a mano en Calendario, Inicio y Resultados** (`social/manualPublications.ts`, migración
  `20270125010000_publicadas_a_mano_analitica.sql` con vuelta atrás). Antes: solo se leía `scheduled_publications`.
  Ahora el calendario pinta «Publicada (a mano)» en el día en que salió (con su enlace) y «Pendiente en Instagram» en el
  día en que se mandó al móvil; no se mueve, cancela ni publica desde allí (la vista rápida lleva a Instagram y al
  reel) y no sale en «Por programar». En Inicio cuenta en «N de M publicadas» (pendiente cuenta en M, no en N) y sale
  en «Lo último publicado» con «a mano», su enlace y sus cifras. El capturador de métricas mide también los reels
  publicados a mano que reconoce en la cuenta (emparejados, o con el enlace de «Ya lo publiqué» entre las
  publicaciones leídas de la cuenta): `media_metrics_daily.manual_publication_id`, `analytics_media_summary` con la
  columna `manual` y el informe mensual con su título. Sin enlace, o con un enlace que aún no se ha leído de la cuenta
  («Buscar en Instagram»), no hay cifras.
- **Miniaturas de plantillas con el logotipo que se ve** (`useTemplatePreviews.ts`). Antes: el primero del kit. Ahora
  la regla del editor (`logoVariantFor` en `editor/logoContrast.ts`, la misma que usa ahora `reelLogoPath`): tono medido
  y, sin medir, nombre o etiquetas. Vale para el selector de plantillas, «Destacadas» y Marca → Plantillas.
- **«Oferta de la semana» (reel) con un texto por plano** (`agency/catalogo/reels.ts`). Antes: precio, condición y
  llamada en el plano del precio. Ahora precio, condición y llamada van cada uno en su plano (4 planos obligatorios y
  2 opcionales); con el cierre de la marca, la llamada pasa al cierre y su plano lleva el nombre del plato. Hay que
  volver a cargar el catálogo en las marcas para que la plantilla guardada cambie.
- **Orden del selector de material** (`photoLook`, `lookScore`, `reelAssetScore`, `editor/useReelLooks.ts`). Antes:
  primero las fotos grandes de móvil en la cocina (encimera, cables, zapatillas). Ahora se mira la miniatura de cada
  foto (luz y borde: liso, de color y parejo frente a gris, recargado y desigual) y la resolución no suma con un fondo
  malo; el peso por píxel solo resta. Medido con 21 miniaturas de cocina, 7 fotos de carta y 2 de la web: cocina de
  -6 a -16, carta de +8 a +20. El selector ordena una vez al terminar de mirar (2,5 s como mucho) y no se mueve en
  cuanto se elige algo.
- **Encuadre ceñido al plato** (trabajador, `photoFraming`). Antes: la foto a pantalla llena centrada en el sujeto
  (se veían la encimera y unas zapatillas). Ahora, con máscara o saliencia, se acerca hasta que el plato ocupe ~90 %
  del ancho o ~70 % del alto (como mucho ×1,8 con máscara y ×1,5 con saliencia), y el corte a detalle se queda dentro
  de la caja del plato.
- **Detalle sin ampliar de más** (trabajador). Antes: corte a ×1,55 con cualquier foto de 900 px de lado corto.
  Ahora ninguna ampliación deja menos de ~1000 px de la foto a lo ancho (`MIN_USEFUL_WIDTH`): el detalle se queda en
  lo que aguanta la resolución y, por debajo de ×1,25, no se hace.
- **Dirección del cierre** (`reelAddress`). Antes: «…03330 Crevillent (Alicante),». Ahora sin signos colgando y, si
  es larga, calle con número y localidad («Carrer Santa Maria de la Cabeza, 2 · Crevillent»); el trabajador también
  quita los signos colgando de los planes ya guardados.
- **Montajes locales por el camino del editor** (FFmpeg 9, `scripts/reels-desde-editor.ts`, que ahora ordena como el
  selector y admite `--medidas` y `--plantillas`), en `rrss-recursos-comparativa/reels-calidad/`:
  `oferta-semana-arreglada.jpg` (6 planos con 1 texto cada uno, cierre con logotipo y la dirección corta) y
  `fotos-con-ritmo-f67.jpg` (la misma plantilla que el reel de staging: con las miniaturas de cocina en la biblioteca,
  con las medidas de sus originales, el selector propone primero las 7 fotos de carta y el comedor; las de cocina
  quedan las últimas, `orden-selector-f67.json`). Sin corte a detalle: las fotos de carta son de 1200 × 900 y en 9:16
  solo dejan ~500 px de ancho.
- **Probado:** unitarias (`like/draft.test.ts`, `quality.test.ts`, `logoContrast.test.ts`,
  `social/manualPublications.test.ts`), componentes (`reelLike.test.tsx` con perfil y logotipo claro,
  `miniaturasLogotipo.test.tsx`, `ordenSelector.test.tsx`, `calendario.test.tsx`, `inicio.test.tsx`,
  `analitica.test.tsx`), base de datos (`tests/db/analitica-a-mano.test.ts`: el capturador mide lo emparejado y lo
  marcado con enlace, no lo pendiente ni lo marcado sin enlace; Resultados y el informe con su título; y la vuelta
  atrás en `migraciones.test.ts`), trabajador (`reel-quality.test.ts`: encuadre ceñido, límite de resolución y detalle
  dentro del plato), catálogo (`agency/tests/catalogo.test.ts`: un texto por plano en las dos «Oferta de la semana»).
- **Resultado en local (24/11/2026):** `typecheck` y `lint` sin errores; `npm test` 2277 pasan; `test:db` 1308 pasan y 2
  omitidas; `build` bien; `worker/` 192 pasan; `agency/` 134 pasan; `test:layout` 188 pasan y 2 omitidas.
- **Sin probar:** el encuadre ceñido y el detalle con las fotos de cocina a resolución completa (en local solo hay
  sus miniaturas de 300 × 400; el ceñido solo está probado con cifras y con el filtro de FFmpeg generado); medir las
  miniaturas en un navegador real (CORS de R2 y Supabase con `loadCorsImage`); el capturador contra la Graph API real
  con un reel publicado a mano; el calendario con lo publicado a mano en un navegador real.
- **Para llevarlo a staging:** migración `20270125010000_publicadas_a_mano_analitica.sql`; redesplegar el trabajador
  (`worker-fly.yml`); la aplicación; volver a cargar el catálogo de plantillas en las marcas (`agency/`, en seco
  primero). `social-insights` no cambia de código (sigue igual: la migración le da la lista nueva de publicaciones).

### Contenidos, «¿Qué quieres crear?» y Copiloto más sencillos (rama `f69/contenidos-copiloto`, 24/11/2026)

Apartados 6 y 7 de la simplificación aceptada (`rrss-recursos-comparativa/simplificacion/CAMBIOS.md`). Se cuentan
las acciones a la vista con `tests/layout/contenidos-copiloto.spec.ts` (375 px táctil y 1366 px, sin abrir menús,
sin el pie legal ni los enlaces que abren cada pieza).

- **Contenidos** (`ContentListPage.tsx`, `lista/ContentCard.tsx`, `lista/stage.ts`). Antes: cinco pestañas (Ideas,
  En preparación, Listas, Programadas, Publicadas), desplegable de formato, cambio miniaturas/lista, casilla en cada
  pieza y, en el móvil, Duplicar y Archivar siempre a la vista (375 px: 9 de la pantalla + 3 por pieza; 1366 px:
  10 + la casilla). Ahora: buscar, «⋯», tres pestañas (En marcha = ideas, en preparación y listas, con el estado en
  la tarjeta; Programadas; Publicadas) y fichas de formato (Todo, Reels, Publicaciones, Carruseles, Historias); cada
  pieza, un «⋯» (siempre a la vista en el móvil, al pasar el ratón en el ordenador; también con pulsación larga) con
  Programar, Publicar otra vez, Duplicar, Elegir y Archivar (Recuperar en las archivadas). Miniaturas en pantallas
  anchas y lista en el móvil, sin botón. «Elegir varias», «Ver las archivadas» y «Archivar las vacías» en el «⋯» de
  la cabecera; al elegir, tocar la pieza la marca. Se quita el aviso fijo «Hay N piezas vacías…» (está en «⋯»).
  Contadas: 375 px, 10 de la pantalla (las fichas que caben) + 1 por pieza; 1366 px, 10 + 0.
- **«¿Qué quieres crear?»** (`CreateContentDialog.tsx`, `useStartPiece.ts`). Antes: «Nueva idea» con formato,
  nombre, «En blanco / Desde una plantilla», «Cancelar» y «Crear y abrir» (10 controles). Ahora un paso: Reel,
  «Reel como este» (si el servidor puede, con su coste), Publicación, Carrusel, Historia y, en el móvil, «Subir
  fotos»; al tocar el formato sale su galería con «En blanco» la primera y las plantillas de la marca de ese formato
  (para Reel, las de reel); al tocar una tarjeta se crea la pieza («Formato · día») y se abre su editor. Desde
  «＋ Crear» del menú se abre directamente la galería del formato. Una plantilla destacada de la pantalla vacía crea
  la pieza con un toque. Contados: 6 controles a 375 px (con «Subir fotos») y 5 a 1366 px. «Nueva idea» solo sigue
  en la pantalla vacía de Contenidos.
- **Copiloto** (`copilot/VoiceCopilot.tsx`, `PlanCard.tsx`, `voiceEngine.ts`; sin cambios en el servidor ni en el
  editor). Se mantiene el panel acoplado que no tapa el lienzo, el aviso solo al pulsar el micrófono, las notas de lo
  que no se hizo y la tarjeta del plan con su coste. Antes: 6 controles (selector «Transcriptor (OpenAI) / Dictado del
  navegador», cerrar, micrófono, «Elegir foto», campo, enviar), una línea fija de estado y un aviso de 64 palabras
  con «No volver a mostrar», «Entendido, dictar» y «Ahora no». Ahora: 4 controles (campo, un botón al lado —el
  micrófono sin texto escrito, enviar con texto—, «⋯» y cerrar); «Elegir foto» y la voz a usar, en «⋯»; el estado
  solo mientras escucha; el aviso, de una línea (24 palabras con el transcriptor) con «Más» a la política, «Dictar»
  y «Ahora no», y una vez leído no vuelve con ese motor. La tarjeta del plan, con textos más cortos (el estado de
  cada paso queda para el lector de pantalla; el coste, «Hasta que digas “sí” no se gasta…» y «lo ya creado queda en
  la biblioteca» siguen).
- **Pruebas:** las que comprobaban lo que ya no existe se han borrado (cambio miniaturas/lista, barra «Cancelar /
  Crear y abrir», campo Nombre, «No volver a mostrar», selector de motor, el aviso «De la agencia» y el «Ver más» del
  selector de plantillas dentro de «Nueva idea»); las demás, al flujo nuevo. Las e2e crean las piezas con
  `crearPieza` de `tests/e2e/apoyo.ts` (formato, «En blanco» o la plantilla y, en el editor, «Nombre y red» o
  «Cambiar el nombre» del reel) **sin ejecutar** (no hay Docker en el PC).
- **Resultado en local (24/11/2026):** `typecheck` bien; `lint` 0 errores (35 avisos, ninguno de esta
  rama); `npm test` 2274 de 2276 en la tanda completa: los 2 que fallaron (`cutout/chain.test.ts`, tiempo agotado,
  y uno de `editorReels.test.tsx`) pasan solos, con el PC cargado por otras ramas; `build` bien; `test:layout`
  (`--workers=2`) 188 pasan y 2 omitidas. `test:db` no se ha ejecutado (no hay cambios de base de datos).
- **Sin probar:** la pulsación larga con un dedo de verdad (en Chromium simulado solo se ve el «⋯» sin «hover»); la
  e2e (CI); el aviso del transcriptor en un navegador real.
- **Pendiente de la propuesta:** el selector del transcriptor debía pasar a Configuración → Integraciones (K2); queda
  en el «⋯» del copiloto porque `IntegrationsPage` no entraba en esta rama. K1 a medias: el micrófono flotante ya abre
  el copiloto, pero el resultado sigue en el panel acoplado (no como aviso corto con «Deshacer»), como se pidió.

### Reels fiables tras la segunda prueba de calidad (rama `f73/reels-fiables`, 25/11/2026)

Arreglos de los fallos de reels del informe `e2e-calidad-2` (24/11/2026).

- **«El vídeo todavía no tiene los últimos cambios» recién montado.** Causa: `renderOfPlan` comparaba el plan
  del editor con el del trabajo guardado, pero `request_media_job` pasa el encargo por `jsonb_strip_nulls` y un
  texto sin franja ni contorno (`box: null`, `outline: null`, casi todos) llegaba sin esas claves: nunca
  coincidía, «Publicar o programar» quedaba desactivado y al reabrir «Exportar» se volvía a montar. Ahora la
  comparación quita los null como la base de datos (`exportFlow.ts`) y, además, sin cambios vale el vídeo de la
  versión vigente (`ReelEditor.tsx`). Prueba en `exportFlow.test.ts` (fallaba antes).
- **Material del reel con IA que no casa con el guion.** `matchShots` (`like/draft.ts`) busca ahora frente al
  texto de la escena (qué tiene que verse y los rótulos de ese plano) además de las palabras de búsqueda: lo que
  dicen a la vez la escena y la búsqueda es el protagonista; lo que encaja solo por una palabra de contexto
  («marisco») vale a medias y nunca si su nombre dice que es otra cosa («Ostras.jpg» para unas zamburiñas). Lo que
  no encaja queda como hueco y el borrador lo dice («En la biblioteca no hay nada que case con el plano …»). El
  encargo a la IA (`tasks/reel-like.ts`) pide que la primera palabra de búsqueda sea lo que tiene que verse y que no
  use una etiqueta parecida ni una categoría.
- **Errores en crudo.** `jobFailureMessage` (`reels/plan.ts`) traduce los fallos del trabajador y de la cola
  (carga inválida por un trabajador sin actualizar —el «Unrecognized key: role»—, cortes, tiempo agotado,
  tipografía, archivos ilegibles o que faltan, FFmpeg, red) a una frase con qué hacer, sin rutas. Lo usan el
  editor, la lista de reels, «Quitar el fondo» y el análisis de «Hacer un reel como este».
- **Trabajador cortado (Fly en prueba apaga a los 5 min).** «El trabajador dejó de responder y no quedan intentos»
  se cuenta como «se cortó a medias… El reel está guardado: pulsa «Probar otra vez»», que vuelve a encargar la
  misma versión sin rehacer nada. Mientras se reintenta solo, lo dice sin pedir nada. Un montaje que lleva más de
  10 min en cola sin empezar lo avisa en «Exportar» («esperando al servicio de montaje»). No se ha tocado Fly.
- **Para llevarlo a staging:** solo la aplicación y la función `ai-reel-like` (por el cambio del encargo). Sin
  migraciones ni cambios en el trabajador. El «Unrecognized key: role» se arregla del todo desplegando en Fly el
  trabajador al día (el de la rama ya admite `role`).
- **Probado:** `typecheck`, `lint` (0 errores), `npm test` (2283) y `build` en verde. **Sin probar:** en staging con
  el trabajador real; `test:db` y e2e no se han ejecutado en esta rama (no hay cambios de base de datos).

### «Preparar el plan» fiable y copiloto que no pierde lo escrito (rama `f72/campanas-copiloto`, 25/11/2026)

Fallos 1, 6, 8 (en parte) y 9 de la segunda prueba real (`rrss-recursos-comparativa/e2e-calidad-2/INFORME.md`).

- **Causa de «respuesta que no se puede usar»** (10 de 10 en `ai_generations` de staging, 24/11): el modelo copiaba el
  destino del prompt tal cual y ponía `network: "instagram/post"` en todas las piezas; ninguna casaba con los destinos,
  el plan quedaba vacío y se rechazaba (sin cobrar). Ahora el prompt da red y formato por separado
  (`- Destino: network=instagram format=post`), las instrucciones lo piden y el saneado entiende «instagram/post» en la
  red o en el formato (`tasks/targets.ts`). Reprocesadas en local las 10 respuestas reales de staging: salen los 10 planes.
- **Causa de «ha tardado demasiado»** (3 de 3): un mes de 16–20 piezas son ~7.000 tokens de salida (más de dos minutos
  a ~55 tokens/s) y el tope era 60 s. Ahora `campaign.plan` se pide por **tramos** de hasta 5 piezas (semanas enteras
  si el ritmo lo permite), todos a la vez, cada uno con sus fases del acuerdo, y se juntan (`planChunks`). Tope por
  llamada 80 s (`AiGenerateParams.timeoutMs`, nuevo) y 125 s en total; la aplicación espera 140 s.
- **Un segundo intento**: si un tramo no sirve (sin piezas válidas o JSON roto), se pide una vez más diciendo qué
  corregir; la respuesta mala no se cobra. Si tampoco sirve: «No ha salido un plan utilizable ni al segundo intento…
  No se ha consumido cupo… Prueba con menos semanas o cuéntalo de otra forma». Si falla un tramo y los demás no, el
  plan sale con esos días vacíos (`gaps`) y un aviso que los nombra.
- **Coste máximo**: `cost.estimate` suma todos los tramos.
- **Error viejo en pantalla** (fallo 9): al pedir otra propuesta se borra el error de «Preparar el plan».
- **Copiloto: el primer toque no enfocaba el campo** (fallo 6). Causa reproducida en Chromium real: si se estaba
  escribiendo en un texto del lienzo (o encuadrando una foto), tocar el campo del copiloto terminaba esa edición y el
  editor devolvía el foco al lienzo, quitándoselo al campo; lo tecleado iba al lienzo. Ahora el foco solo vuelve al
  lienzo si no se ha pulsado otro campo o botón. Prueba: `tests/layout/copiloto-foco.spec.ts` (falla antes, pasa
  después, a 1366 px con ratón y a 375 px táctil). **No se ha reproducido** el caso exacto «justo después de una orden»
  sin tocar el lienzo (ni con órdenes locales, ni con IA simulada, ni con un plan).
- **Copiloto, diseño**: con el panel abierto ya no sale el botón redondo del micrófono sobre el lienzo (era un segundo
  micrófono junto al del panel); cada orden se ve igual en cualquier ancho (lo dicho arriba; debajo, estado y «Sin
  IA»/«Con IA»).
- **Probado**: `test:db` de campañas, `ai-generate`, servicio y simulado local; componentes de contenidos y campañas;
  `test:layout` del copiloto y del editor. **Sin probar con el modelo real** (no hay clave en local y no se despliega
  desde esta rama). **Para llevarlo a staging:** redesplegar `ai-generate` y la aplicación; sin migraciones.

### «Preparar el plan» respeta la duración pedida y no repite títulos (rama `f75/campanas-duracion-repetidos`, 26/11/2026)

Dos fallos vistos en staging con llamadas reales en «Preparar un plan con IA».

- **Fallo 1, causa:** con «Un mes de publicaciones en diciembre…» y «Preparar el plan» directamente (sin «Que la IA
  proponga duración, redes y ritmo»), el diálogo mandaba los «Detalles» por defecto (la semana siguiente; 4 piezas) y
  no avisaba: la propuesta solo se pedía con su botón. **Ahora** (`NewCampaignDialog.tsx`), si no hay propuesta y la
  persona no ha tocado redes ni fechas de «Detalles», al pulsar «Preparar el plan» se pide antes la propuesta
  (`campaign.brief`) y el plan sale con sus fechas, redes, ritmo, fases y nombre, en un solo paso («Primero, la
  duración, las redes y el ritmo…; después, el plan»). Si la propuesta trae una pregunta, el plan espera a la respuesta
  y sale solo al contestar. Si la propuesta falla (o la respuesta no trae ni pregunta ni propuesta), se explica el error
  y **no** sale un plan con lo de por defecto. Si la persona tocó redes o fechas, vale lo suyo, sin propuesta (el texto
  junto al botón lo dice). Tocar solo el nombre no cuenta como «Detalles».
- **Coste máximo enseñado:** en ese caso, antes de pulsar aún no se sabe qué duración saldrá, así que la línea dice
  «Coste máximo de la propuesta y el plan (hasta 9 semanas)» = estimación de `campaign.brief` + la de `campaign.plan`
  en el caso más largo y denso que puede salir de una propuesta (redes de la marca, 63 días, 14 a la semana → 30
  piezas, 9 fases con textos largos: `longestPlanEnd`, `longestAgreement` en `brief.ts`). Con propuesta o «Detalles»
  tocados, como antes («Coste máximo de este plan»).
- **Fallo 2, causa:** los tramos de un plan largo se piden a la vez y ninguno ve lo que escriben los demás; la única
  indicación era «no repitas la misma idea en todas las semanas». Salían «Empieza a tu nivel» dos veces, o «Tu sitio
  para empezar» y «Un espacio para empezar». **Ahora** (`tasks/plan-variety.ts`, nuevo):
  - antes de pedirlos, cada tramo recibe sus **ángulos** (lista fija y genérica de 12, repartida por rondas: ninguno se
    repite entre tramos mientras alcance la lista y nunca dentro de un tramo) y la lista de los que llevan los demás,
    con la regla de no repetir palabras clave en los títulos (`assignAngles`, `anglesPrompt`; solo con más de un tramo);
  - al juntar, se buscan **títulos repetidos o casi iguales** (sin tildes ni palabras vacías, plurales y género, y
    sinónimos corrientes: sitio/espacio/lugar, empieza/comienza/arranca…) y se renombran sin otra llamada: con el
    titular de la pieza, o el principio de su idea, o su formato, o un número como último recurso. Las **ideas** casi
    iguales (5 palabras clave o más, 3 de cada 5 en común) solo se avisan. El resultado lleva `repeats` y el aviso de
    «Plan listo» lo dice («He cambiado el nombre de 2 piezas…», «Una idea se parece a otra (12/12): revísala»).
- **Coste y tiempo:** sin llamadas de más ni cambios de plazos (80 s por llamada, 125 s en total). Lo reservado (tokens
  de entrada + salida máximos, `estimateTextUsage`) sube un 4,1–4,6 % en planes de 4–9 tramos (35.440 → 36.968 en un
  mes de 4 por semana); el coste real sube menos (la salida, que es lo caro, no cambia).
- **Probado:** `typecheck`, lint de lo tocado, `npm test` y `test:db` de campañas, `ai-generate`, reparto de la
  propuesta, tareas de texto y la nueva `tests/db/ia-campanas-variedad.test.ts` (reparto de ángulos y detección de
  repetidos). `npm test`: 2316 de 2317 en tres pasadas; en cada una se agotó el tiempo (10 s) de una prueba
  distinta de `editorReels.test.tsx`, que no usa nada de lo tocado y pasa entera (44/44) ejecutada sola. Las pruebas nuevas del diálogo (`campanasVoz.test.tsx`) y la de tramos (`campanas.test.ts`) fallan con el
  código de antes y pasan con el nuevo. Se han adaptado tres pruebas de componentes que pulsaban «Preparar el plan» sin
  propuesta. **Sin probar** con el modelo real ni en navegador; e2e 14 no se ha ejecutado (toca «Detalles», así que no
  cambia su recorrido).
- **Para llevarlo a staging:** redesplegar `ai-generate` (lleva `campaign-plan.ts` y `plan-variety.ts`) y la
  aplicación; sin migraciones.

## Sin probar contra el servicio real

| Servicio                                                                                   | Estado                                                                                                                                                                                                              | Detalle                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| IA de texto (Claude por Vertex UE, Bedrock UE, Mistral, Anthropic directo)                 | Adaptadores escritos, sin claves                                                                                                                                                                                    | `docs/ia-texto.md`                         |
| Animar una foto con IA (fal.ai: MiniMax H3 y Kling v3; `docs/ia-medios.md` §15)            | Adaptador y flujo escritos; solo con HTTP simulado; sin clave; modelos inactivos y precios sin verificar (0,06 y 0,084 USD/s según la ficha; la página de precios daba otras cifras)                                         |
| IA de imagen (Vertex UE, FLUX.2, Ideogram, ComfyUI propio) y vídeo (Higgsfield, fal.ai)    | Adaptadores escritos, sin claves; vídeo suelto apagado                                                                                                                                                                     | `docs/ia-medios.md`                        |
| Meta (OAuth, publicación, métricas, portada del reel, renovar el acceso)                   | Adaptador escrito; sin aplicación de Meta; la renovación del acceso y `cover_url` solo contra la Graph API simulada                                                                                                 | `docs/publicacion.md`, `docs/analitica.md` |
| Stripe                                                                                     | Funciones escritas; sin cuenta                                                                                                                                                                                      | `docs/facturacion.md`                      |
| Google Drive (OAuth, listar, servir imágenes)                                              | Adaptador escrito; sin cliente OAuth de Google                                                                                                                                                                      | `docs/biblioteca-drive.md`                 |
| Dictado del navegador (Web Speech API de Chrome)                                           | Probado con una simulada                                                                                                                                                                                            | `docs/copiloto-voz.md`                     |
| Cloudflare R2 (firmas, subidas, «Probar conexión», migración)                              | Probado con MinIO en local; sin cuenta de Cloudflare                                                                                                                                                                | `docs/almacenamiento-r2.md`                |
| Quitar el fondo en el navegador (BEN2 con WebGPU; IS-Net de respaldo; onnxruntime-web)     | Lógica, elección de motor y caída probadas con dobles; BEN2 en CPU de Node con paridad IoU ≥ 0,9998 frente a la referencia; IS-Net y la caída probados en Chromium real (WASM); **BEN2 con WebGPU real sin probar** | `docs/edicion-fotos.md` §7                 |
| Subtítulos automáticos con OpenAI (`gpt-transcribe`)                                       | Adaptador escrito; solo con HTTP simulado y la transcripción simulada; sin clave                                                                                                                                    | `docs/editor-reels.md`                     |
| IA de imagen y edición de fotos con OpenAI (GPT Image: cambiar el fondo, mejorar, generar) | Adaptador escrito; solo con HTTP simulado; sin clave; máscara y consumo real sin contrastar                                                                                                                         | `docs/ia-medios.md` §13                    |
| Edición de fotos con IA (ComfyUI: quitar el fondo y ampliar)                               | Flujos escritos; solo con HTTP simulado y la edición simulada; nodo de quitar fondo sin contrastar                                                                                                                  | `docs/edicion-fotos.md`                    |
| «Guardar y probar» de Integraciones                                                        | Probado con servicios simulados: ninguna llamada real a Meta, Stripe, IA ni ComfyUI                                                                                                                                 | `docs/05-puesta-en-marcha.md`              |

## En staging

Proyecto `zzkdrfhqmjfvrdsoguio`, plan gratuito, región UE:

- 35 migraciones aplicadas (la última, `20261123010000_integrations_drive_copilot`, el 20/11/2026); todas las tablas de `public` con RLS. Organizaciones existentes en el plan «Heredado».
- Funciones desplegadas sin proveedores: `platform-integrations`, `drive-media`, `ai-generate`, `ai-media`, `ai-media-poll`, `ai-media-webhook`, `social-connect`, `social-publish`, `social-insights`, `billing-checkout`, `billing-portal`, `billing-webhook`, `delete-account`, `delete-organization`.
- Plataforma → Integraciones disponible para el superadministrador; ninguna integración configurada todavía.
- pg_cron: `rrss-ai-media-poll` (30 s), `rrss-social-publish` (cada minuto), `rrss-analytics` y `rrss-purge-provisional-assets` (cada hora). Los secretos de Vault del cron (`rrss_project_url`, `rrss_service_role_key`) **ya existen** en staging (auditoría del 21/11/2026); en un entorno nuevo hay que crearlos (`docs/ia-medios.md`, §9).
- Inicio de sesión con retorno a https://rrss-omega.vercel.app y `localhost:5173`.
- Cuentas: la del dueño (superadministrador), una de prueba y la de la agencia (Gestora de Casa Tomás). Casa Tomás está dada de alta en Oficiosos, en modo agencia, con perfil, logotipos y 25 fotos.
- Copiloto del editor con OpenAI (21/11/2026): secretos de `ai-generate` `AI_TEXT_EDITOR_COPILOT_PROVIDER=openai`, `AI_TEXT_EDITOR_COPILOT_MODEL=gpt-6.1-terra`, `OPENAI_BASE_URL=https://eu.api.openai.com` y `AI_PRICES` de ese modelo; `ai-generate` y `platform-integrations` redesplegadas; `VITE_AI_VOICE_COPILOT_ENABLED` ya estaba en `true` en Vercel producción. **Falta la clave `OPENAI_API_KEY`** (la pone el dueño en Plataforma → Integraciones → IA de texto → OpenAI, de un proyecto con residencia en Europa). Sin probar con modelo real hasta entonces.
- Interruptores de Vercel (auditoría del 21/11/2026). **Encendidos:** `VITE_AI_TEXT_ENABLED`, `VITE_AI_IMAGE_ENABLED`, `VITE_SOCIAL_PUBLISHING_ENABLED`, `VITE_AI_VOICE_COPILOT_ENABLED` y `VITE_DRIVE_LIBRARY_ENABLED`; cada módulo sale solo cuando su integración está configurada. **Apagados (`off`):** `VITE_REEL_SUBTITLES_ENABLED` (subtítulos automáticos de los reels; necesita además OpenAI en el servidor), `VITE_CUTOUT_SERVER_URL` (respaldo del recorte de fondo en el servidor; sin ella el navegador recorta solo), `VITE_MEDIA_WORKER_ENABLED` (reels, sin trabajador alojado) y facturación (sin precios decididos).
- Registro `ai_media_models`: hay filas activas en staging, pero una fila activa solo cuenta si su proveedor está configurado; sin su clave no enciende la IA de imagen ni sale en los selectores (`docs/ia-medios.md`, §5).
- IA de texto: de las seis tareas, solo `editor.copilot` tiene proveedor. La disponibilidad ya es POR TAREA (`aiTextTasks`): los botones de textos de las piezas, verificador de tono, propuesta de perfil, plan de campaña e interpretación de la analítica no salen hasta que su tarea tenga proveedor, modelo y precio. Basta poner proveedor y modelo por defecto (Plataforma → Integraciones → IA de texto → «Todo el texto»), más la clave y los precios, para encenderlas todas.

## Para usar en staging lo desplegado

1. Drive: cliente OAuth de Google (Drive API, dirección de vuelta
   `…/functions/v1/drive-media/callback`) metido en Plataforma → Integraciones →
   Google Drive, y `SOCIAL_TOKEN_KEYS` («Generar clave» en Meta).
2. Instagram: «Generar clave» en Meta y conectar la cuenta pegando un token, o
   la aplicación de Meta para OAuth.
3. El trabajador de medios, cuando se aloje, con esta versión (desenfoque y
   fotos de Drive).
4. Fotos de Drive: 371 HEIC convertidas a JPEG; 126 subidas junto a su HEIC el
   20/11/2026, el resto pendiente (copia local en
   `codigo-restaurante/drive-jpeg-pendientes`).
5. Para llevar `f6/integracion` a staging (una sola pasada; solo hay una variable `VITE_` nueva):
   - Migraciones, en este orden (cada una con su vuelta atrás en `supabase/rollbacks/`):
     `20261124010000_media_storage_r2`, `20261126010000_integrations_openai`,
     `20261128010000_photo_editing`, `20261129010000_media_storage_orphans`,
     `20261130010000_publish_now`.
   - Función nueva: `media-storage` (`verify_jwt = false`, ya en `supabase/config.toml`).
   - Volver a desplegar `ai-generate`, `ai-media`, `ai-media-poll`, `ai-media-webhook`,
     `platform-integrations`, `social-publish`, `delete-account` y `delete-organization`;
     conviene redesplegar también `billing-checkout`, `billing-portal`, `billing-webhook`,
     `drive-media`, `social-connect` y `social-insights` para que todas lleven el mismo
     catálogo común de integraciones.
   - pg_cron: la migración `20261129010000` crea `rrss-media-orphans` (cada hora, minuto 41);
     necesita los secretos de Vault `rrss_project_url` y `rrss_service_role_key`, como las demás.
   - Vercel: `VITE_AI_PHOTO_EDIT_ENABLED` (dejarla apagada hasta tener un modelo de edición).
   - Después, la cuenta y el cubo de Cloudflare (`docs/almacenamiento-r2.md` §5) y, con el
     «sí» al recuento, la migración de archivos (560 archivos, ≈ 3,0 GB) y
     `scripts/alta-biblioteca.ts`.
   - El trabajador, cuando se aloje, con esta versión (`WORKER_MEDIA_STORAGE=auto`).

## Bloqueado por algo externo

| Qué                                                           | Qué hace falta                                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publicar en Instagram y medir                                 | Aplicación de Meta (tipo Business), verificación de empresa y revisión de permisos; con acceso estándar se puede probar en staging con una cuenta propia                      |
| IA por API                                                    | Cuenta de Google Cloud con Vertex AI en la UE (o la alternativa elegida) y precios confirmados                                                                                |
| Cobrar                                                        | Cuenta de Stripe, moneda, precios por plan y portal configurado                                                                                                               |
| Correo para cualquiera (registro, recuperación, invitaciones) | SMTP propio (Resend u otro); hoy solo llega al equipo de Supabase, 2 por hora                                                                                                 |
| Reels y recortes en staging                                   | Trabajador ya desplegado y probado con recortes; falta tarjeta en Fly (la prueba corta a los 5 min) y probar un reel completo (`docs/alojamiento.md` §4.2)                    |
| Fotos de Drive en staging                                     | Cliente OAuth de Google (Drive API, pantalla de consentimiento en producción sin verificar)                                                                                   |
| Archivos en Cloudflare R2                                     | Cuenta de Cloudflare, cubo en la UE, regla CORS, token del cubo y DPA firmado (`docs/almacenamiento-r2.md` §5)                                                                |
| Clientes reales                                               | Supabase de producción en Pro (copias de seguridad, sin pausas), dominio propio, páginas legales completadas y revisadas por un abogado, contrato de encargo con cada cliente |

## Decisiones del dueño pendientes

1. Moneda de cuenta, precios y límites de los planes (propuesta en `docs/facturacion.md`) y plan por defecto.
2. Proveedor de IA (por defecto, Google Cloud en la UE) y cupo mensual.
3. Activar el vídeo con IA (por defecto, apagado).
4. Alojamiento del trabajador de medios: ya está en Fly.io (Fráncfort) en staging; falta la tarjeta de pago y decidir el de producción (`docs/alojamiento.md`).
5. Música para los reels: el editor ya pide a la marca que confirme la licencia (queda en la procedencia); falta decidir si se ofrece una biblioteca de música con licencia.
6. Plazos de conservación de datos y revisión legal (`docs/rgpd.md`).
7. **Copiloto por voz en modo agencia (provisional).** `ai-generate` rechaza la IA de texto en marcas en modo agencia, salvo el copiloto por voz (`editor.copilot`), que no redacta: coloca literalmente lo dictado. Decidir si se mantiene, se quita o se hace configurable por marca (`docs/copiloto-voz.md` §4).
8. Decisiones provisionales que se pueden cambiar: una aprobación vale solo para la versión aprobada; quien edita y aprueba puede aprobar sin revisión; cada red es una pieza distinta; los colores fuera de la marca avisan pero no bloquean; aceptar un encargo aprueba la versión entregada; logotipos provisionales se borran a las 48 h.
9. Pasar los archivos a Cloudflare R2: crear la cuenta y dar el «sí» al recuento de la migración (`docs/almacenamiento-r2.md`).
10. Edición de fotos: si se quita el fondo con ComfyUI (GPU, con cupo de IA) o también en el trabajador sin GPU (descargar pesos de BiRefNet o IS-Net, 100–200 MB), y el precio por edición (`docs/edicion-fotos.md` §4 y §5).
3. Activar el vídeo con IA (por defecto, apagado). Decidido el 22/11/2026: ofrecer animar una foto real (rama `f28/animar-foto-ia`); falta que el dueño ponga la clave de fal.ai, admita el tratamiento fuera de la UE y contraste los precios (`docs/ia-medios.md` §15).
4. Alojamiento del trabajador de medios: recomendado Fly.io en Fráncfort; código preparado (`docs/alojamiento.md`), falta la cuenta.
5. Música para los reels y su licencia.
6. Alojamiento del trabajador de medios.
7. Música para los reels: el editor ya pide a la marca que confirme la licencia (queda en la procedencia); falta decidir si se ofrece una biblioteca de música con licencia.
8. Plazos de conservación de datos y revisión legal (`docs/rgpd.md`).
9. **Copiloto por voz en modo agencia (provisional).** `ai-generate` rechaza la IA de texto en marcas en modo agencia, salvo el copiloto por voz (`editor.copilot`), que no redacta: coloca literalmente lo dictado. Decidir si se mantiene, se quita o se hace configurable por marca (`docs/copiloto-voz.md` §4).
10. Decisiones provisionales que se pueden cambiar: una aprobación vale solo para la versión aprobada; quien edita y aprueba puede aprobar sin revisión; cada red es una pieza distinta; los colores fuera de la marca avisan pero no bloquean; aceptar un encargo aprueba la versión entregada; logotipos provisionales se borran a las 48 h.
11. Pasar los archivos a Cloudflare R2: crear la cuenta y dar el «sí» al recuento de la migración (`docs/almacenamiento-r2.md`).
12. Edición de fotos: si se quita el fondo con ComfyUI (GPU, con cupo de IA) o también en el trabajador sin GPU (descargar pesos de BiRefNet o IS-Net, 100–200 MB), y el precio por edición (`docs/edicion-fotos.md` §4 y §5).

## Pendientes conocidos

- Bajar a un plan sin publicación no detiene lo ya programado.
- Publicación: sin historias de Instagram, sin Facebook, el calendario usa la hora del dispositivo, renovar el token es volver a conectar.
- Exportar en el servidor (el editor exporta en el navegador).
- Sin reconocimiento de texto en escaneos ni imágenes; los reels no usan tipografías .woff.
- Editor: sin ajuste a guías al mover varias capas; zonas seguras solo para 9:16 y orientativas.
- Fase 4: lotes, coordinador y automatizaciones.
- Avisos de encargos por sondeo (60 s), sin tiempo real ni correo.
- ~~El trabajador usa la clave de servicio~~: resuelto con el intermediario `worker-gateway` (abajo); aplicado en staging con el trabajador de Fly (21/11/2026).
- Variables nuevas sin llevar a `.env.example` (documentadas en `docs/`), entre ellas `VITE_AI_VOICE_COPILOT_ENABLED`, `VITE_DRIVE_LIBRARY_ENABLED`, `AI_TEXT_EDITOR_COPILOT_*` y las de Drive.
- Copiloto por voz: falta un aviso en el propio copiloto antes del primer dictado (el audio va a Google o Microsoft; la política de privacidad ya lo dice).
- Integraciones: tokens de «inicio de sesión de Instagram» (IG…) no admitidos; el vídeo con IA sigue solo por variables.

## Trabajador de medios en Fly.io (rama `f11/fly-trabajador`, 21/11/2026)

**Desplegado y probado en staging (21/11/2026).** App `rrss-worker` en Fráncfort, máquina `48e73d3b067698` (shared-cpu-2x, 2 GB, sin puertos, reinicio «no», modo `drain`), desplegada con la Action `worker-fly.yml` (el panel de Fly construyó una imagen equivocada: `docs/alojamiento.md` §4.2). Secretos en Fly: solo `SUPABASE_URL` y `WORKER_GATEWAY_TOKEN` (entra por `worker-gateway`, sin clave de servicio). Prueba real: 3 recortes de una foto de la biblioteca → la base de datos despertó la máquina, trabajo `succeeded` en ~20 s y la máquina se paró sola a los ~40 s sin trabajo. `VITE_MEDIA_WORKER_ENABLED=true` en Vercel. Reel completo probado el mismo día: el primer montaje falló con «plan: Invalid input» porque `request_media_job` quita los null (jsonb_strip_nulls) y el trabajador exigía `outline`; arreglado en el esquema del trabajador (ausente = null) y redesplegado; el reel salió 1080×1920, H.264 + AAC, 30 fps, en la biblioteca (carpeta Reels). Pendiente: borrar la máquina sobrante `1859526f369798` (parada) y tarjeta en Fly (la prueba corta a los 5 min).

- `worker/fly.toml`: Fráncfort, shared-cpu-2x con 2 GB y 1 GB de intercambio, modo `drain`, sin puertos, `[[restart]] policy = "never"` (la máquina se queda parada al salir).
- Migración `20261208010000_media_worker_wake.sql` (con vuelta atrás): integración «Trabajador de medios (Fly.io)» en Plataforma → Integraciones (`FLY_API_TOKEN` en Vault, `FLY_APP`, `FLY_MACHINE_ID`, «Probar conexión» = GET de la máquina), `private.media_worker_wake()` con pg_net a la API de máquinas de Fly, disparador al encolar trabajos `media.*`/`source.extract` y pg_cron `rrss-media-worker-wake` cada 2 minutos. Como mucho una llamada cada 10 s y ninguna si el trabajador tiene una reserva viva; sin configuración, solo un aviso.
- Token: uno **de despliegue de la app** del trabajador (el de menor permiso documentado que arranca su máquina).
- Despliegue: panel de Fly («Deploy from GitHub», directorio `worker`, configuración `fly.toml`). Alternativas sin ejecutar: GitHub Actions (`worker-fly.yml`, `worker-fly-preparar.yml`) y `worker/scripts/fly-preparar.mjs` (probado solo en modo «solo enseñar»; `flyctl` está bloqueado por Windows en el ordenador del dueño).
- Para llevarlo a staging: aplicar la migración, volver a desplegar `platform-integrations` (y, para el mismo catálogo, las demás funciones que lo importan) y, con el trabajador probado, `VITE_MEDIA_WORKER_ENABLED=true` en Vercel.

## Trabajador sin la clave de servicio (rama `f12/worker-sin-clave`, 21/11/2026)

El dueño no quiere `SUPABASE_SERVICE_ROLE_KEY` en Fly. Implementado y probado en local y en CI; **aplicado y en uso en staging** (el trabajador de Fly entra por él, 21/11/2026). Detalle, opciones valoradas y pasos en `docs/alojamiento.md` §5.

- Elegida la opción del intermediario: Edge Function `worker-gateway` (`verify_jwt = false`) con las operaciones exactas del trabajador (reclamar, renovar, terminar, fallar, devolver, URL firmadas de lectura y subida de una ruta). La clave de servicio se queda en Supabase. Descartado el rol de Postgres con JWT propio: no se puede revocar al momento y con las claves nuevas no está claro que Supabase lo admita.
- Migración `20261210010000_worker_gateway.sql` (con vuelta atrás): ajuste `WORKER_GATEWAY_TOKEN` (solo la huella SHA-256, en Vault; un disparador impide guardar otra cosa), funciones `worker_gateway_*` solo para la clave de servicio, que comprueban token, trabajo reservado por ese trabajador, tipos del trabajador y ruta de la organización y marca del trabajo, y tope de 1.200 llamadas por minuto (`private.worker_gateway_calls`).
- Plataforma → Integraciones → Trabajador de medios: «Generar token» (sale una vez para pegarlo en Fly), «Generar uno nuevo (rotar)» y «Revocar». «Probar conexión» avisa si falta.
- Trabajador: modo `gateway` por defecto (`worker/src/gateway.ts`); `service-key` solo pidiéndolo (local y CI); en Fly no arranca si encuentra la clave. `fly-preparar.mjs` y `worker-fly-preparar.yml` ya ponen el token y quitan la clave si quedaba.
- En Fly solo van `SUPABASE_URL` y `WORKER_GATEWAY_TOKEN`.
- E2E del reel y de un recorte por el intermediario del stack local (`tests/e2e/11-reels.spec.ts`), **pasa en CI** (22/11/2026).
- Para llevarlo a staging: aplicar la migración y desplegar `worker-gateway` y `platform-integrations`; después, el dueño genera el token y lo pega en Fly.

## Pulido (rama `f6/pulido`, en `f6/integracion`, 20/11/2026)

- Política de privacidad (versión `2026-11-20`, sigue siendo plantilla pendiente de revisión legal): añadidos el dictado por voz del navegador, Google Drive y Cloudflare R2 como encargados.
- Reels: deslizador de desenfoque (0 a 100) por foto; viaja en el plan (`blur`).
- Huérfanos en R2: `uploadAsset` pide `media-storage/discard` si falla el alta, y la tarea `rrss-media-orphans` (cada hora, necesita los secretos de Vault) barre lo apuntado sin recurso tras 24 h. Migración `20261129010000` con vuelta atrás. Probado con la función simulada; contra R2 real, sin probar.
- OpenAI como proveedor de texto (`f6/openai`, migración `20261126010000`): claves `OPENAI_API_KEY`, `OPENAI_BASE_URL` (UE: `https://eu.api.openai.com`), `OPENAI_ORGANIZATION` y `OPENAI_PROJECT` en Plataforma → Integraciones → IA de texto; sin clave no se carga. Sin probar contra OpenAI real.
- Plan «Prueba»: las funciones de IA salen como no incluidas si el cupo de IA es 0.
- Conexión con Meta sin marca conocida: aviso en la pantalla de entrada.
- Miniaturas (`f11/textos-miniaturas`, migración `20261209010000`, sin aplicar en ningún entorno): `media_assets.thumb_path`, miniatura WebP de ~400 px generada en el navegador al subir y usada en biblioteca, selectores, calendario, Campañas y tira del carrusel; URL firmadas en caché. Las imágenes que ya existen: `scripts/miniaturas-biblioteca.ts` (en seco por defecto, **sin ejecutar**; ver `docs/almacenamiento-r2.md`).
- Textos para el dueño: diccionario `src/lib/texts.ts` (actividad, estados, zonas horarias) y prueba `src/lib/texts.test.ts` que falla si una pantalla enseña nombres de tablas, UTC, JSON, undefined/null…; «Exportar JSON» → «Descargar configuración», «unidades de cuenta» → «créditos», token → «clave de acceso»/«conexión avanzada». Pendiente de la auditoría: la erratas «publicaciónes» no está en el código (viene de datos guardados); se corrige al mostrarla.

## Siguiente paso

1. Probar en https://rrss-omega.vercel.app el primer encargo real de Casa Tomás (post del chuletón) y el resto de pantallas con datos reales.
2. El dueño crea la aplicación de Meta, la cuenta de correo y, si quiere IA por API, Google Cloud.
3. Con la aplicación de Meta: conectar la cuenta de Instagram de Casa Tomás en staging y publicar una pieza aprobada.

## Estudio de costes y margen por plan (rama `f29/costes`, 22/11/2026)

**Solo documentación** (sin código, sin configuración, sin llamadas de pago): `docs/costes.md` y la
hoja editable `rrss-recursos-comparativa/costes-rrss.xlsx` (fuera del repositorio).

- **Hecho:** costes fijos para lanzar (unos 47 € al mes lo mínimo, unos 108 € lo recomendado), coste
  variable por marca en tres perfiles (0,37 / 2,17 / 9,20 € al mes; más del 95 % es IA), margen por
  plan con los precios propuestos, punto de equilibrio, topes que existen y que faltan, y tres
  escenarios (5, 20 y 50 marcas). Precios de infraestructura consultados el 22/11/2026 en las páginas
  oficiales; los de IA salen de `docs/modelos-ia-comparativa.md`.
- **Sin confirmar:** todo lo marcado NO CONFIRMADO en `docs/costes.md` §7 (precio de la máquina de
  4 GB de Fly en Fráncfort, dominio, tarifas de imagen de OpenAI y de fal.ai…). Los perfiles de uso y
  el reparto de clientes son supuestos: no hay datos reales.
- **Sin comprobar en Excel:** la hoja no se ha podido abrir con Excel desde la sesión; sus fórmulas
  se han verificado con un evaluador aparte.
- **Decisiones que deja al dueño:** bajar el cupo de IA de Agencia (100 → 50) y de Profesional
  (25 → 20), descontar el cupo con recargo, y dejar el vídeo con IA fuera de los planes base.

## Coherencia de la IA (f26, 22/11/2026)

Cierra los fallos de la auditoría de staging del 21/11/2026. Rama `f26/ia-coherente`.

- **Texto por tarea.** `computeAvailability` devuelve `aiTextTasks` (una por tarea) además de `aiText` (alguna). Cada botón de la interfaz mira su tarea (`useTextTask`): textos de las piezas y verificador de tono en el editor, propuesta de perfil, interpretación de la analítica, Campañas en el menú y copiloto. Plataforma → Integraciones: «Qué ve la gente» lista una fila por tarea, y el apartado de IA de texto se divide en «Todo el texto: proveedor y modelo por defecto» y «Excepciones por tarea». Un servidor sin redesplegar no manda `aiTextTasks`: mientras tanto la interfaz usa `aiText` como antes.
- **Modo agencia e imagen.** `ai-media` ya mira `ai_mode`: en modo agencia solo el personal de la agencia o de la plataforma usa la imagen con IA (409 `agency_mode` para los miembros de la marca; listados vacíos); el editor lo explica en una frase. Migración `20261216010000_ai_brand_access` (función `ai_brand_access`, con vuelta atrás). Decisión a confirmar por el dueño: se considera personal de la agencia a propietario y administradores de una organización de tipo «agencia» y a los superadministradores; un miembro de la marca con rol (gestor, editor…) no.
- **Falta de cupo.** El mensaje de «sin cupo asignado» dice a quién pedirlo: a quien administra la organización y, si es quien la administra, a la plataforma.
- **Registro de modelos.** Una fila activa de un proveedor sin configurar no cuenta como disponible ni sale en los selectores (probado en `tests/db/ia-openai-imagen.test.ts`).
- **Para llevarlo a staging:** aplicar la migración `20261216010000`; redesplegar `platform-integrations` y `ai-media`; después, la web. Para encender el texto: en Plataforma → Integraciones → IA de texto, proveedor y modelo por defecto (y la clave y los precios de ese proveedor).
## Animar una foto con IA (rama `f28/animar-foto-ia`, 22/11/2026)

«Animar con IA…» en la ficha de una foto de la biblioteca: un clip de 5 s (máx. 10)
con MiniMax H3 (principal) o Kling v3 Standard (respaldo) por fal.ai; el vídeo queda en
«Vídeos con IA» con su procedencia y la marca de contenido generado con IA, y el
selector de clips de los reels ya lo puede elegir. Detalle, ids, precios y pasos en
`docs/ia-medios.md` §15.

- **Hecho y probado (con fal.ai simulado):** migración `20261217010000` (con vuelta
  atrás), acciones `video.*` de `ai-media`, cupo, permisos, aislamiento, modo agencia,
  «Probar conexión» de fal.ai, diálogo con coste máximo y estado, script de prueba
  a ciegas.
- **Sin probar:** ninguna llamada real a fal.ai (no hay clave); duración real de un clip;
  si el plato queda intacto (de ahí el aviso y la prueba a ciegas); el diálogo en un
  navegador contra un servidor real.
- **Sin confirmar:** los precios (la ficha de cada modelo y la página general de
  fal.ai no coinciden); región y entrenamiento con lo enviado.
- **Pendiente del dueño:** clave de fal.ai en Plataforma → Integraciones, admitir el
  tratamiento fuera de la UE, contrastar y activar los dos modelos, `ai_video` en el
  plan, `VITE_AI_ANIMATE_ENABLED=true`, aplicar la migración y redesplegar `ai-media`,
  `ai-media-poll` y `ai-media-webhook`.

## Pendientes de Instagram (rama `f30/instagram-pendientes`, 22/11/2026)

Cierra los pendientes de desarrollo de la publicación que no dependen del dueño.
Todo probado contra la Graph API **simulada**; nada contra Meta real (sigue sin
aplicación de Meta). Detalle en `docs/publicacion.md`.

- **Portada del reel.** El publicador manda la portada del montaje como `cover_url`
  del contenedor `REELS` (según la referencia de `/{ig-user-id}/media`: JPEG público,
  8 MB, sRGB, mejor 9:16; si van `cover_url` y `thumb_offset`, gana `cover_url`).
  Migración `20261218010000` (`social_publication_cover`, solo clave de servicio). Sin
  portada o si falla la lectura, el reel sale igual.
- **Renovar el acceso sin volver a conectar.** `social-publish` cambia el token largo
  del usuario por uno nuevo antes de que caduque (≤ 14 días) y solo da la renovación
  por buena si Meta amplía la caducidad; si no, anota el motivo y avisa a la marca y a
  la agencia (calendario, inicio de la marca, Cuentas conectadas y listado de marcas).
  Migración `20261218020000` (columnas `token_renewed_at`, `renewal_attempted_at`,
  `renewal_error`; `social_accounts_to_renew`, `social_account_renew`,
  `social_account_renewal_failed`; el reloj despierta a la función si hay algo que
  renovar). **No se sabe si Meta amplía la caducidad al repetir el cambio**: la
  documentación no lo promete.
- **Hora de la marca.** Calendario, ficha, programar y fechas de Cuentas conectadas en
  `brands.timezone` (`src/features/social/zone.ts`). Sin migración.
- **Plan sin publicación.** Motivo nuevo «Detenida: tu plan no incluye la publicación»
  con botón «Cambiar de plan»; cambiar de plan o de funciones de un plan reevalúa y
  rearma al volver. Migración `20261218030000`.
- **Pruebas:** `tests/db/publicacion.test.ts` (+14: portada, renovación, plan),
  `zone.test.ts`, `zonaHoraria.test.tsx`, `renovacionAcceso.test.tsx`, casos nuevos en
  `calendar.test.ts`, `holdAdvice.test.ts` y `avisosResolubles.test.tsx`; e2e 13
  ampliada (plan sin publicación), **sin ejecutar** (solo CI).
- **Para llevarlo a staging:** aplicar `20261218010000`, `20261218020000` y
  `20261218030000` (con el «sí» del dueño); redesplegar `social-publish`; después, la web.
## Operación y control de gasto (rama `f32/operacion-gasto`, 22/11/2026)

Detalle en `docs/operacion-gasto.md`. Migración `20261219010000_operacion_gasto.sql` (con vuelta
atrás), **sin aplicar en staging**.

- **Implementado y probado en base de datos y componentes:** pantalla de superadministrador «Gasto
  y uso» (IA por organización y tipo, trabajador de medios con segundos de máquina estimados,
  almacenamiento por marca, cupo consumido, precios de IA sin verificar, cupos a mano y planes sin
  límites marcados); avisos de plataforma (cupo al 80 % y 100 %, tope global, trabajos de medios
  que fallan, tope de trabajos por marca, tareas programadas, máquina de Fly); tope global
  mensual de IA (`AI_GLOBAL_MONTHLY_CAP`, error `AI003` → `ai_paused`); tope mensual de trabajos de
  medios por marca (`MEDIA_JOBS_MONTHLY_PER_BRAND`, apagado por defecto, igual que el tope global); limpieza de
  `storage_cleanup_queue` de marcas borradas; aviso que bloquea hasta aceptar la versión vigente
  de los documentos legales (no bloquea a superadministradores); aviso previo al primer dictado del copiloto.
- **Para llevar a staging:** migración `20261219010000`; redesplegar `ai-generate`, `ai-media`,
  `ai-transcribe`, `media-storage` y `platform-integrations`; la aplicación web.
- **No probado:** nada contra Supabase, Fly o proveedores reales; `pg_cron` y `pg_net` solo
  imitados; la e2e 19 está actualizada pero no se ha ejecutado (sin Docker).
- **Pendiente:** aviso hacia fuera (correo o Telegram), comprobación periódica de la máquina de Fly,
  cargar y verificar precios reales de IA, decidir si se activan los topes (apagados por defecto; los avisos y la pantalla son solo informativos).

### Plantillas: miniaturas reales y tarjetas legibles (rama `f34/plantillas-ui`)

- **Miniatura real** (`content/templates/preview.ts`, `useTemplatePreviews.ts`): se dibuja la primera página con el motor del exportador (`renderDocument`), con las 8 fotos más recientes de la biblioteca en los huecos de foto (marcador neutro si no hay) y el texto de muestra de la plantilla. Una a una, cacheada (LRU de 80, por plantilla y fotos) y con esqueleto; si falla, el esquema de siempre. Sirve a «Nueva idea», «Desde una plantilla» y Marca → Plantillas.
- **Tarjetas**: nombre, una frase (primera del resumen, sin la etiqueta «PROPUESTA de la agencia…»), formato, páginas y «Con hueco para N fotos»; el texto largo, el tipo de foto y la repetición, en «Ver más». Etiqueta «Manual» pasa a «De la agencia». Filtro por formato. «Nueva idea» ofrece «En blanco» / «Desde una plantilla» siempre.
- **Datos de staging**: `supabase/scripts/renombrar-plantillas-neutras.sql` (a mano; sin migración).
- **Sin probar**: dibujo real en navegador (en jsdom Konva no dibuja: allí sale el esquema), 375 px a mano.
## Integraciones en dos niveles, precios al día y sugerencias de modelo (rama `f33/integraciones-sencillas`, 22/11/2026)

Detalle en `docs/integraciones-sencillas.md`. Migración `20261222010000_precios_y_coste_real.sql`
(con vuelta atrás), **sin aplicar en staging**.

- **Implementado y probado en componentes y en base de datos (con fuentes y proveedores simulados):**
  vista sencilla de «Plataforma → Integraciones» (una tarjeta por servicio, estado en una palabra,
  la clave imprescindible, «Guardar», «Probar conexión» y «Con esto se enciende»; todo lo demás en
  «Opciones avanzadas» de cada tarjeta); resumen «Qué funciona ahora» (8 funciones); OpenAI como una
  sola tarjeta; al guardar la clave de OpenAI se aplican valores por defecto (servidor europeo,
  modelo barato para el copiloto, modelo mejor para redactar, precios, modelos de imagen de OpenAI
  activados) con «Deshacer»; «Usar la configuración recomendada»; sugerencia de modelo por tarea con
  su precio por uso (OpenAI y, como tarjeta nueva y opcional, Claude); precios al día leídos por el
  servidor desde LiteLLM (caché de 12 h, último valor guardado si la fuente falla) comparados con
  los cargados, con «Usar estos precios»; coste real medio por operación del mes; si la clave de
  OpenAI no es de un proyecto europeo, «Probar conexión» lo dice y ofrece el servidor general en un
  clic (con el aviso de los datos fuera de la UE).
- **Para llevar a staging:** migración `20261222010000`; redesplegar `platform-integrations` (hace
  falta salida a `raw.githubusercontent.com` y a la API de OpenAI); la aplicación web.
- **No probado:** nada contra OpenAI, Anthropic ni GitHub reales desde la aplicación (la fuente de
  precios se leyó a mano el 22/11/2026 para elegirla); la pantalla no se ha visto en un navegador
  ni a 375 px reales (maquetación con rejilla y `flex-wrap`, sin captura); la e2e 18 y la 21 están
  adaptadas pero no se han ejecutado (sin Docker; corren en CI).
- **Pendiente:** leer el gasto real del proveedor con una clave de administración (documentado, sin
  implementar: `docs/integraciones-sencillas.md` §6); medir con nuestros casos los modelos que hoy
  salen como «sin medir con nuestros casos»; precio por imagen (la fuente solo da precio por token de imagen).

## Copiloto del editor por herramientas, teclado y transcriptor (rama `f37/copiloto-herramientas`, 22/11/2026)

Detalle en `docs/copiloto-voz.md`. Decisión del dueño: «vamos con luna y todo con
herramientas para ver si sale mejor».

- **Antes:** el copiloto solo admitía voz (dictado del navegador), devolvía un JSON con 8
  operaciones, mandaba el perfil de marca entero en cada orden y «deshaz» contestaba «No
  puedo deshacer desde aquí». «Probar conexión» de IA de texto solo listaba modelos.
- **Ahora:**
  - **Herramientas** (function calling) por defecto: 26 herramientas: 23, una por operación, con
    todo lo que el editor hace a mano (textos y efectos, capas, figuras, fotos, lienzo,
    páginas, deshacer, guardar, plantillas y los flujos de foto), y 3 pasos de plan (más
    abajo). Adaptadores de OpenAI y de
    Claude por la misma interfaz (`AiInput.tools`). La ruta JSON sigue detrás de
    `AI_TEXT_EDITOR_COPILOT_MODE=json`.
  - **Órdenes frecuentes sin IA** (intérprete local): «deshaz», «guarda», «más grande»,
    «siguiente página»… coste cero y respuesta inmediata.
  - **Órdenes por teclado**: campo de texto en el panel; el copiloto sale y funciona sin
    micrófono.
  - **Dos motores de voz**: dictado del navegador o transcriptor de OpenAI (`ai-transcribe`,
    con cupo), a elegir; aviso de privacidad por motor, en una franja compacta que no tapa el
    lienzo (auditoría de usabilidad).
  - **Prompt compacto**: herramientas e instrucciones comunes delante (cacheables), marca en
    tres líneas, documento en una línea por capa.
  - **«Probar conexión» de IA de texto hace una generación mínima real** (1 token de salida
    por modelo configurado) con el mismo endpoint que las tareas: una clave que lista modelos
    pero no puede generar ya no da «Funciona».
  - **Banco** `scripts/copiloto-banco.ts`: 82 órdenes (7 de plan); en seco por defecto.
  - **Órdenes que montan una pieza** («haz el menú de otoño: crea un fondo otoñal y pon los
    platos en el centro»; `docs/copiloto-voz.md` §15). Tres herramientas nuevas en la misma
    llamada (`generate_background`, `find_photos`, `place_photos`). El editor no aplica nada:
    enseña un plan en lenguaje llano con el coste máximo (el de `image.estimate` de
    `ai-media`), espera el «sí» (botón, voz o teclado, sin IA), lo ejecuta por pasos con
    «Cancelar» y lo mete en el documento como un solo paso de deshacer. **Regla del dueño: la
    IA solo crea el fondo; los platos y productos son siempre fotos de la biblioteca**
    (herramienta, instrucciones, saneado del servidor, comprobación del navegador y coletilla
    fija en lo que se manda al generador). Topes: 12 pasos, 6 fotos y 1 crédito por plan. Sin
    IA de imagen no se ofrece generar: se propone el color de fondo de la marca.
- **Probado:** unitarias, componentes y base de datos (proveedores y micrófono simulados);
  e2e 19 adaptada (compila; **sin ejecutar en local**, corre en CI). Los planes, igual: todo
  con simulados (IA de texto, generador de imágenes, biblioteca y recorte) y un caso nuevo en
  la e2e 19, sin ejecutar.
- **Medido en staging con IA real** (22/11/2026, lo hizo el coordinador: `gpt-6-luna`,
  servidor general de OpenAI, 10 órdenes sobre un documento de prueba, primera versión de la
  ruta de herramientas): coste medio **100 micros por orden** (462 con JSON y luna; 4.495 con
  terra), latencia de servidor **1,25 s** (3,07 s con JSON) y **562 tokens de entrada sin caché**
  + 2.121 leídos de caché (3.308 + 1.345 con JSON). Los objetivos (< 1,5 s y < 1.500 tokens sin
  caché) se cumplen en esa medida. **Acertó 7 de 10** (JSON, 10 de 10): en tres órdenes con dos
  acciones solo llegó la primera y se perdió una corrección a mitad de frase; además no llegaba
  la nota para la persona.
- **Arreglo de las órdenes con varias acciones** (mismo día, **sin volver a medir con IA
  real**). Causa: el código recogía todas las llamadas, pero el modelo emitía UNA por
  respuesta (llama y espera el resultado, como en un bucle de herramientas) y solo se hacía una
  vuelta; y con `gpt-6-luna` las herramientas exigen razonamiento `none` (la ruta JSON iba con
  el razonamiento por defecto). Ahora: instrucciones explícitas («una orden puede necesitar
  varias herramientas: llámalas todas»; «si la persona se corrige, vale lo último que dijo»),
  herramienta de cierre `done` con la nota para la persona, `tool_choice: required` y, si el
  modelo llama sin cerrar, hasta 5 vueltas devolviéndole «hecho» (solo OpenAI; cada vuelta es
  una generación más, casi toda de caché). El banco tiene esos tres casos y diez más.
- **Sin probar contra nada real:** el arreglo anterior, la ruta de herramientas con Claude, el
  transcriptor, el micrófono, la sonda de generación y el banco con `--apply`. Con el contador
  del simulado el total por orden sube
  de 2.455 a 3.473 tokens (3.122 antes de los pasos de plan) y lo no compartible entre marcas
  baja de 1.065 a 149; que se cumpla depende de que el proveedor lea de caché el prefijo común.
  De los planes no se ha probado nada real: ni que el modelo devuelva los pasos, ni un fondo
  generado de verdad, ni el recorte de fotos reales, ni la composición a la vista.
- **Para llevar a staging (en este orden):** aplicación → migración `20261226010000` (dos
  ajustes de Integraciones, con vuelta atrás) → funciones `ai-generate`, `ai-transcribe` y
  `platform-integrations`. Después, el banco real (`docs/copiloto-voz.md`, apartado 13). Los
  planes no añaden migraciones ni funciones: basta con la aplicación y `ai-generate` (en ese
  orden) y con que `ai-media` siga desplegada.
- **Pendiente:** volver a medir en staging las órdenes con varias acciones; si la corrección a
  mitad de frase sigue fallando con razonamiento `none`, pasar el copiloto a la API Responses de
  OpenAI (admite herramientas con razonamiento `low`); precio de la escritura de caché de OpenAI (se cuenta como entrada normal);
  política de privacidad con el motor transcriptor; elegir plantilla concreta por voz.

## «Hacer un reel como este» (rama `f36/reel-como-este`, 22/11/2026)

Una persona sube un reel que le gusta (o pega su enlace) y el sistema lo estudia y lo rehace con las
ideas y el material de la marca. Detalle, costes, límites y despliegue en `docs/reel-como-este.md`.

- **Implementado**: trabajo `media.reel.analyze` en el trabajador (mide sin IA: cortes, planos, compás,
  fotogramas; enlaces sin trucos, con `robots.txt`); migración `20261223010000_reel_like.sql` (tabla
  `reel_references`, el tipo nuevo en `request_media_job`, borrado y caducidad de los archivos del
  análisis); visión en los adaptadores de texto (`AiInput.images`: OpenAI y Anthropic); función
  `ai-reel-like` (coste máximo antes, cupo, registro, modo agencia como la imagen); pantalla en
  Biblioteca → Reels con progreso por pasos y las cuatro salidas (plantilla, guion, borrador con la
  biblioteca y textos); el editor de reels abre el borrador con sus huecos «Falta grabar: …»;
  «Guardar como plantilla» entrega en el formato compartido de plantillas de reel (`rrss.reel-template`,
  origen `reference`, con el tipo de plano como campo opcional nuevo); script de prueba real de un comando.
- **Probado**: trabajador con FFmpeg real y un vídeo de 4 planos generado (cortes y duraciones a menos de
  0,1 s); base de datos, aislamiento y función con proveedores **simulados**; de punta a punta en local
  (vídeo → trabajador → cola → función → plantilla, sin rastro del vídeo); componentes; maquetación en
  Chromium a 375 px.
- **Cifras en local** (22/11/2026, PC de desarrollo, tras unir `f35/catalogo-plantillas`): `npm test` 1311,
  `npm run test:db` 1082 (2 omitidas), `worker/` 154, `npm run test:layout` 33 y `agency/` 125, todas en
  verde; `typecheck`, `lint` y `build` también. El CI de GitHub no se ha ejecutado con esta rama (sin subir).
- **Sin probar**: ningún proveedor de IA real (visión ni transcripción), el trabajador en Fly con este
  trabajo, la función desplegada, enlaces reales de redes y vídeos reales de móvil.
- **Bloqueado**: la clave de OpenAI de staging (401: proyecto no europeo contra el endpoint de la UE).
- **Decisión del dueño pendiente**: en marcas en modo agencia lo usa solo el personal de la agencia
  (regla de la IA de imagen), no «cerrado para todos» como el texto.
- **Para llevarlo a staging**: las dos migraciones (`20261223010000` y `20261224010000`), la función
  `ai-reel-like`, redesplegar el trabajador de Fly, un modelo con visión con precio y
  `VITE_REEL_LIKE_ENABLED=true`.

## Preparar un plan de campaña dictando y con la IA que rellena el formulario (rama `f40/campanas-voz`, 22/11/2026)

Petición del dueño: «aquí hay que meter también el copiloto con IA para que puedas dictar lo que quieres, y la IA te
tiene que ayudar a hacer la duración y todo». Detalle: `docs/ia-texto.md` («Rellenar el formulario de la campaña») y
`docs/copiloto-voz.md` («Dictar en cualquier campo»).

- **Antes:** el diálogo «Preparar un plan con IA» era un formulario con la instrucción, las ocho redes marcables, dos
  fechas y un nombre; la duración y el ritmo se decidían a mano y el texto solo se escribía.
- **Ahora:**
  - Arriba, solo «¿Qué quieres preparar?», con micrófono (mismo motor y aviso que el copiloto del editor), y un botón
    para que la IA proponga. La propuesta trae una frase de por qué («Te propongo 3 semanas porque…»), la duración,
    el ritmo por formato, las redes, el objetivo y la semana a semana; queda **rellenada** en «Detalles» (plegados,
    con un resumen de una línea) para corregirla. Se ajusta con «Más corta», «Más larga» (llaman a la IA) y «Solo
    Instagram» (sin IA). Si falta un dato, UNA pregunta corta. El coste de la propuesta se ve en pequeño.
  - Por defecto, «Detalles» enseña solo las redes de la marca (conectadas o con plantillas; Instagram si no hay);
    «Otras redes» enseña el resto, desmarcadas.
  - «Preparar el plan» lleva lo acordado (ritmo, reparto, fases, objetivo) a `campaign.plan`, que fija el máximo de
    piezas con él; cada pieza del plan dice de qué plantilla de diseño o de reel de la marca encajaría
    (**sugerencia**: el motor al aceptar todavía no aplica la plantilla; se elige al preparar la pieza).
  - Componente reutilizable `DictableField`, en los campos de texto libre de «Editar foto» (fondo con IA), «Hacer
    un reel como este», «Animar con IA» y «Generar imagen con IA», sin cambiar su comportamiento.
- **Probado:** componentes (dictado y aviso, propuesta, ajustes, pregunta única, sin IA/sin cupo, modo agencia,
  acuerdo hacia el plan, sugerencias de plantilla), base de datos (`campaign.brief`: saneado de redes/fechas/ritmo,
  pregunta, ajustes, agencia, cupo, `agreement`), maquetación a 375 px en Chromium.
- **Sin probar:** ningún modelo real con `campaign.brief` (la calidad de la duración y del ritmo propuestos); el
  micrófono real en el diálogo; que «Más corta/larga» devuelva siempre una semana menos/más (el producto no lo
  comprueba, solo sanea).
- **Decisiones:** `campaign.brief` se registra como `campaign.plan` (sin variable ni migración nuevas); si se quiere
  un modelo más barato solo para esto habrá que separar el propósito (migración del catálogo de Integraciones).
- **Para llevarlo a staging:** redesplegar `ai-generate`; la aplicación. Sin migraciones.
## Calendario para planificar (rama `f41/calendario`, 22/11/2026)

Detalle en `docs/publicacion.md` («Calendario para planificar»). Sin migración.

- **Hecho**: vistas Semana (por defecto en pantallas anchas), Mes compacto y Lista (por defecto en móvil;
  se recuerda la elegida en el dispositivo); tarjetas con miniatura, hora de la marca, red y formato con
  icono y estado con color y texto; vista rápida (pie de foto, «Abrir», «Mover a…», «Publicar ahora»,
  «Cancelar») con el motivo y el botón de arreglo de las «Detenidas»; arrastrar para mover (conserva la hora)
  con «Deshacer»; «+» solo al pasar el ratón o enfocar; bandeja «Por programar» arrastrable; huecos de la
  semana, contador frente al objetivo y franja de campañas (solo lectura); filtros de estado, red, formato
  y campaña en una fila; página sin scroll (el calendario se desplaza por dentro).
- **Probado**: `calendarPlan.test.ts`, `calendarioVistas.test.tsx` (tres vistas, mover, huecos, bandeja,
  permisos), el resto de pruebas del calendario adaptadas a la vista rápida; maquetación en Chromium a
  1440 y 375 px (`tests/layout/calendario.spec.ts`).
- **Sin probar**: e2e 13 y 23 adaptadas a la vista rápida, **sin ejecutar** (solo CI); arrastrar con el
  ratón real (las pruebas simulan los eventos de arrastrar); pantallas táctiles reales.
- **Límites**: la hora no se cambia arrastrando (solo el día; la hora, con «Mover a…»); el objetivo semanal
  se guarda en el dispositivo, no en la marca (compartirlo entre personas pide una migración); sin vista
  de día ni «Por red» (las sustituyen la semana y el filtro de red).

## Inicio de la marca y Contenidos con miniaturas (rama `f42/inicio-contenidos`, 22/11/2026)

- **Implementado**: Contenidos es una rejilla de tarjetas con la miniatura real de la pieza (primera
  página dibujada con el motor de las plantillas y su caché; reels con su portada o el primer clip;
  esquema de capas si no se puede dibujar; icono del formato si no hay diseño), vista de lista compacta
  (se recuerda), pestañas por etapa con contador (Ideas · En preparación · Listas · Programadas ·
  Publicadas: mezclan el estado de la pieza con el de su publicación), búsqueda, formato y campaña en
  una fila, acciones rápidas (abrir, duplicar, programar, archivar con «Deshacer»), selección múltiple
  para archivar, marca «Vacía» (sin ninguna versión guardada) y «Archivar las vacías» de una vez; la
  pantalla vacía ofrece «Nueva idea» y hasta tres plantillas. «Nueva idea» elige el formato con
  tarjetas (Publicación, Carrusel, Reel, Historia, con su proporción), el nombre es opcional («Reel · 22
  nov») y «Crear y abrir» lleva al editor que toca. El inicio de la marca responde «qué hago hoy»:
  accesos grandes (Nueva publicación, Nuevo reel, Hacer un reel como este si el servidor puede, Subir
  fotos), la semana en siete columnas con miniaturas, lo parado con su botón de arreglo, lo último
  publicado con cifras solo si existen y los avisos (Instagram sin conectar, acceso que caduca).
- **Quitado del inicio** (a propósito): los contadores de archivos y fuentes, «Accesos rápidos» y
  «Actividad reciente» (sigue en Configuración → Actividad). El porcentaje del perfil queda como una
  línea para quien gestiona la marca, solo si falta algo.
- **Sin migración.** Las piezas y las publicaciones se leen con las tablas de siempre.
- **Probado**: unitarias (etapas, semana), componentes (lista, miniaturas, acciones, vacío, inicio),
  maquetación en Chromium a 375, 768 y 1366 px (sin scroll lateral, miniaturas dibujadas de verdad, el
  inicio cabe en 1366×768 y 1024×768 sin bajar la página). Las e2e se adaptaron (el formato ya no es un
  desplegable) y corren en CI.
- **Sin probar**: con una marca real y muchas piezas (la lista trae hasta 600 y enseña de 24 en 24);
  miniaturas de reels con vídeo real (en el banco no hay recursos firmados); el aspecto en un móvil real.
- **Añadido tras la auditoría de usabilidad (tanda D)**: «Nueva idea → Reel» ya no dice que el vídeo
  «llegará más adelante»; ofrece las plantillas de reel de la marca (`brand_reel_templates`) con su muestra
  en movimiento y «Hacer un reel como este» (si el servidor puede), con el botón «Crear y abrir» fijo abajo.
  Con una plantilla de reel, la pieza se abre en el editor con `?plantilla=<clave>`; el editor de reels
  lo lee desde la rama `f39/reels-editor-movil` y abre el selector de esa plantilla. Las plantillas de pieza salen en una rejilla de
  miniaturas grandes y filtradas por el formato. La red ya no se pregunta (solo Instagram se publica) y los
  formatos que no se publican solos lo dicen. El coste de «Hacer un reel como este» se dice como «≈ N % del
  cupo de este mes» (lo ven los administradores; el resto, en créditos).

## Biblioteca y Analítica más claras (rama `f43/biblioteca-analitica`, 22/11/2026)

Petición del dueño: «un producto de calidad» con menos carga visual.

- **Implementado (Biblioteca)**: barra lateral de carpetas en árbol con contadores (selector en móvil)
  y migas de pan; mover arrastrando o con «Mover a…»; crear, renombrar y eliminar carpeta vacía; rejilla
  con miniaturas (`thumb_path`) de tamaño ajustable, pintada por tandas; selección con casillas y Mayús
  con barra de acciones (mover, etiquetar, descargar hasta 20, eliminar con confirmación); chips Fotos,
  Vídeos, Logotipos, Con fondo quitado, Hechas con IA, Sin usar y Recientes; orden por fecha, nombre o uso;
  búsqueda sin distinguir tildes por nombre, etiqueta y carpeta; ficha como panel lateral con ← y →,
  «Dónde se usa», «Editar foto», «Usar en una publicación» (crea la idea con la foto), «Usar en un reel»
  (`reels?con=<id>`) y «Animar con IA…» si está disponible; subir arrastrando a la página o a una
  carpeta, con progreso, error claro y «Reintentar» por archivo; `PhotoPanel` reutilizable
  (`docs/panel-de-fotos.md`), sin conectar a ningún editor.
- **Implementado (Analítica)**: frase del periodo con la variación en palabras, de 3 a 4 cifras grandes
  (elegir una la lleva al gráfico), gráfico de línea con guía por puntero y teclado y tabla día a día,
  «Lo que mejor funcionó» con miniaturas, y el resto plegado en «Más detalle». Estados honestos sin
  cuenta, sin cifras y con la cuenta por reconectar. Ambas pantallas son pantallas de trabajo: la página
  no se desplaza (y no llevan el pie legal, como el editor).
- **Migración** `20270101010000_asset_usage.sql` (función de lectura `asset_usage`, con la RLS de quien
  pregunta; vuelta atrás en `supabase/rollbacks/`). Sin aplicar en staging. Sin ella, la pantalla no
  inventa usos: oculta «Sin usar» y «Más usadas».
- **Limitación conocida**: una carpeta vacía creada desde la pantalla solo existe en ese navegador hasta
  que se mueve un archivo dentro (en la base de datos una carpeta es el texto de `media_assets.folder`).
  La biblioteca lee de una vez hasta 5.000 archivos por marca (avisa si hay más).
- **Probado**: componentes (`biblioteca.test.tsx`, `photoPanel.test.tsx`, `analitica.test.tsx`), unitarias
  (`carpetas.test.ts`, `resumen.test.ts`), base de datos (`aislamiento.test.ts`, `asset_usage`) y
  maquetación en Chromium real a 375, 768 y 1366 px (`tests/layout/biblioteca-analitica.spec.ts`).
  e2e 04, 11, 15 y 24 adaptadas a la interfaz nueva (la 04 con un caso nuevo) **sin ejecutar**: necesitan
  el stack local.
- **Sin probar**: descarga de varios archivos a la vez (los navegadores pueden pedir permiso),
  arrastrar desde el escritorio con archivos reales, miniaturas reales (el banco no firma URL) y el
  móvil real.

## Editor de reels «como los de móvil» (rama `f39/reels-editor-movil`, 22/11/2026)

Petición del dueño (lo que más le importa) y hallazgos H1, H3, H4, H15 y H33 de la auditoría de usabilidad.
Detalle, patrones adoptados y fuentes en `docs/editor-reels.md` §10.

- **Implementado**: pantalla fija sin scroll de página (vista previa 9:16 grande, barra de herramientas que
  cambia con lo elegido y línea de tiempo con el cabezal fijo en el centro; panel al lado en escritorio y
  hoja en móvil); tira de fotogramas por clip, textos apilados, música con onda; zoom con pellizco, Ctrl +
  rueda y botones; dividir en el cabezal, sustituir, duplicar, velocidad 0,5×–2×, volumen y silenciar,
  filtros de color, transición por corte con vista previa; textos que se arrastran, se escalan y se editan
  sobre el vídeo, con guías y cuatro estilos prediseñados; atajos (Espacio, S, Supr, ← →, Ctrl+Z/Y, Ctrl+D);
  **guardado automático** del montaje como borrador (`reel_drafts`) con indicador, recuperación al volver y
  pregunta al salir si no se pudo guardar; «Ver el vídeo» dentro del editor; subir el audio desde el diálogo
  de la música; `?plantilla=<clave>`.
- **Plan v2 ampliado** (compatible): `speed` y `filter` en el clip, `filter` en la foto, `offset` en el texto;
  a la vez en la aplicación, el trabajador y la base de datos.
- **Migración** `20261228010000_reel_editor_pro.sql` (validación del plan y tabla `reel_drafts` con sus dos
  funciones y un disparador; vuelta atrás en `supabase/rollbacks/`). **Sin aplicar en staging.**
- **Probado**: unitarias, componentes, base de datos (con aislamiento y deshacer/rehacer la migración),
  trabajador con FFmpeg real y maquetación en Chromium real a 1440, 1366 y 375 px, con reproducción,
  miniaturas y onda de verdad.
- **Sin probar**: un móvil real (pellizco, inercia, pulsación larga), Safari/iOS, archivos reales de móvil en
  R2, el FFmpeg de la imagen de Fly, la e2e 29 (adaptada, sin ejecutar) y la migración en staging.
- **No hecho, a propósito**: pistas de música incluidas (hace falta que el dueño elija una fuente con licencia
  de uso comercial); rotar textos, curvas de velocidad, pegatinas y varias pistas de vídeo (el trabajador no
  los monta).
- **Para staging**: migración → redesplegar el trabajador (el anterior rechaza los campos nuevos) → Vercel.

## Editor de piezas «tan fácil como Canva» (rama `f44/editor-canva`, 23/11/2026)

Tanda A de la auditoría de usabilidad (`rrss-recursos-comparativa/auditoria-ux/INFORME.md`:
H2, H6, H7, H10, H12, H13, H16 y parte de H18 y H24). Se toman de Canva las formas de trabajar,
no su aspecto.

- **Marcos de foto (documento v6).** Una imagen puede ser un hueco sin foto
  (`source: { kind: 'empty' }`, con la marca `frame`) y la foto se amplía dentro de su caja (`zoom`).
  El hueco enseña «Poner foto» (un botón dibujado encima de todo el diseño, para que no lo tape un
  velo ni un titular); al pulsarlo, o al soltar una foto encima, la foto **rellena el marco**. Doble
  clic en una foto (también a través de una forma que la tape) la **encuadra**: se arrastra dentro
  del marco y se amplía con la rueda o el deslizador, sin mover la caja. «Sustituir» conserva el
  marco y los efectos (luz, filtro, sombra, fondo) y quita lo que era de la foto anterior (recorte,
  giro, encuadre). «Imagen», pegar y la imagen con IA van al hueco vacío de la página si lo hay; si
  no, la foto entra con su proporción y al 70 % del lienzo (antes, a lienzo completo y encima de
  todo). Un hueco vacío **no sale en la imagen exportada** y la cabecera avisa («Falta 1 foto»).
  Las plantillas del catálogo (`agency/catalogo`) usan ya marcos; las antiguas (una forma llamada
  «… (sustituir)») se convierten al leerlas (`document/migrate.ts`, 5 → 6), también en las piezas
  ya creadas.
- **Guardado automático.** Lo que no es una versión se guarda solo como **borrador** a los 1,5 s
  del último cambio, al esconder la pestaña y al salir del editor (tabla `content_drafts`, uno por
  pieza y persona; no cambia el estado ni entra en el historial). La cabecera dice «Guardando…»,
  «Borrador guardado», «Guardado» o «Sin guardar · Reintentar». Al volver a abrir la pieza se
  sigue donde se dejó (con «Descartarlos»). Salir ya no pregunta, salvo que el borrador no se haya
  podido guardar. «Guardar versión» (y Ctrl+S) guarda **al momento**, sin diálogo; la nota, en
  «⋯ → Guardar versión con una nota…», con el foco en la nota. Los diálogos pueden marcar dónde
  cae el foco (`data-autofocus`); también «Nombre y red».
- **Esc al escribir en el lienzo** termina y conserva lo escrito (se deshace con Ctrl+Z).
- **Barra de acciones sobre lo elegido**, también en el móvil: foto (Sustituir, Editar foto,
  Recortar, Quitar fondo, Duplicar, Borrar), texto (Escribir, tipografía, tamaño −/+, color,
  alineación), forma (color), varias (Agrupar) y «⋯» con orden, alinear, repartir, bloquear, copiar
  y «Todas las opciones». Se coloca encima del elemento, debajo si no cabe, y nunca se sale del
  lienzo; el tirador de girar pasa abajo para dejarle sitio. El mismo menú sale con el botón derecho.
- **Publicar sin tropiezos.** Un botón «Publicar o compartir» (ver cómo quedará, descargar,
  programar, publicar ahora). Quien puede aprobar tiene «Aprobar y publicar ahora…» y «Aprobar y
  programar…»: guarda la versión, la aprueba y sigue. Cambiar de estado con cambios sin versión los
  guarda antes en vez de bloquear. «Programar» desde el editor ya no rechaza la pieza por tener la
  exportación en PNG: **prepara sola la imagen** al guardar, como «Publicar ahora», y propone ya
  marcada la que hubiera. El pie de una plantilla es un **pie de ejemplo** (`copy.captionHint`): se
  ve en gris en el campo y nunca se publica.
- **Lo habitual.** Ctrl+C / Ctrl+X / Ctrl+V entre páginas (y entre piezas de la misma marca, en la
  misma pestaña), Ctrl+D, Ctrl+A, pegar una imagen del portapapeles y soltar archivos sobre el
  lienzo (se suben a la biblioteca), rueda del ratón para acercar hacia el cursor, Espacio para
  arrastrar la vista, bloquear y agrupar. El panel de fotos de la biblioteca (`PhotoPanel`) está
  conectado dentro de «Diseño» («Fotos de la marca», sin nada elegido o con un hueco vacío
  elegido): tocar una foto la pone y se puede arrastrar a un marco. No es una pestaña más: con
  cinco, «Marca» dejaba de verse en el panel de escritorio.
- **Migración** `20270103010000_editor_frames_drafts.sql` (vuelta atrás en `supabase/rollbacks/`):
  las plantillas aceptan el documento v6 y se crea `content_drafts` con RLS (solo los propios, y
  solo donde se edita), `save_content_draft()` y el disparador que borra el borrador al guardar una
  versión. **Sin aplicar en staging.** Hasta aplicarla: el editor funciona, pero el borrador no se
  guarda (dice «Sin guardar» y vuelve a preguntar al salir) y no se pueden cargar las plantillas
  del catálogo ni guardar una plantilla nueva desde el editor (son documentos v6).
- **Probado:** componentes (`marcos.test.tsx`, `guardadoAutomatico.test.tsx`,
  `barraFlotante.test.tsx`, `publicarCompartir.test.tsx` y las de siempre, adaptadas), base de
  datos (`marcos-borradores.test.ts`, 12 casos, con la vuelta atrás), agencia (catálogo con marcos)
  y Chromium real sin Supabase (`tests/layout/editor-marcos.spec.ts`: poner la foto bajo un velo,
  encuadrar con doble clic, barra a 375 px, Esc, zoom con rueda, mano con Espacio y botón derecho).
  La comparación de píxeles lienzo/exportación sigue pasando.
- **Sin probar:** contra Supabase de verdad (las e2e 09, 13, 19, 20, 21, 23, 27 y 28 están
  adaptadas pero aquí no corren: necesitan el stack local); arrastrar con el dedo en un móvil real
  (encuadre, pellizco); pegar imágenes desde otras aplicaciones en Safari y Firefox; dos personas
  editando la misma pieza a la vez con borradores; y la distinción entre rueda de ratón y panel
  táctil (se decide por el tamaño del gesto).
- **Decisiones tomadas y límites:** el borrador es por persona (dos personas no ven el borrador de
  la otra; al guardar una versión, la otra ve el aviso de conflicto de siempre). Los borradores no
  entran en la descarga de datos del RGPD (son trabajo a medias, se borran con la pieza y con la
  cuenta). Una pieza ya creada desde una plantilla antigua conserva su pie: no hay forma de saber si
  es la indicación o un pie escrito a mano. Aprobar no se bloquea por tener un hueco vacío.

## Pulido de interfaz: siete arreglos (rama `f46/pulido`, 23/11/2026)

De la auditoría de UX (hallazgos F9, H11, H20, H31 y H32) y de dos defectos de maquetación.

- **Implementado**
  1. **Integraciones: cada tarjeta prueba y enseña solo su proveedor.** La de Claude ya no enseña la
     prueba de OpenAI (ni fal.ai la de «Otras imágenes con IA»): «Probar conexión» manda la tarjeta
     (`service`) y el servidor prueba, devuelve y anota solo lo suyo. Migración
     `20270105010000_pruebas_por_tarjeta.sql` (fila propia de última prueba para Claude y fal.ai; vuelta
     atrás en `supabase/rollbacks/`). Detalle en `docs/integraciones-sencillas.md`.
  2. **Autogestión sin planes, cupos ni márgenes.** Con `work_mode = 'self'`: sin pestaña «Plan», sin la
     tarjeta «Cupo de IA», avisos de la IA sin cupos ni planes («tope de gasto»), y en Plataforma (uso
     interno) cupos, margen y planes plegados, «Gasto y uso» sin cupos ni planes e Integraciones sin
     cobros. El gasto real se sigue viendo. Solo visibilidad. Detalle en `docs/modo-de-trabajo.md`, §3.
  3. **Un solo selector de marca**: el de organización desaparece; el de marca lista las marcas de
     todas las organizaciones (agrupadas si hay más de una) y la organización se lee bajo la marca.
  4. **«Nueva idea»**: la barra fija de «Cancelar / Crear y abrir» tapa hasta el borde del diálogo.
  5. **Coste de «Hacer un reel como este»**: «Cuesta unos céntimos.» en autogestión; con agencia,
     «Gasta menos del 1 % del cupo de este mes.» (`src/features/ai/cupo.ts`).
  6. **Biblioteca**: la fila de filtros ya no enseña la barra de scroll nativa (salta de línea desde
     tablet; en móvil se desplaza con la barra oculta).
  7. **Banco de maquetación del calendario**: sembraba «la semana de hoy» con el lunes en UTC y, entre
     las 00:00 y la 01:00 (02:00 en verano) de un lunes en Madrid, dejaba el calendario vacío (10
     pruebas en rojo). Ahora usa `seedWeek` (`src/test/semana.ts`), con las funciones del calendario y
     la zona de la marca. Los demás bancos no tienen ese borde (el Inicio siembra respecto a «ahora» y
     la analítica cuenta los días en UTC, como la pantalla).
- **Probado**: `npm test` (1959 pasan, 151 archivos), con casos nuevos en `integraciones.test.tsx`, `usoInterno.test.tsx`,
  `selectorUnico.test.tsx`, `cupo.test.ts`, `listaContenidos.test.tsx` y `semana.test.ts`; base de datos
  (`tests/db/integraciones.test.ts`: sondas por tarjeta con proveedores **simulados**, la función y la
  migración, que también pasa `migraciones.test.ts`); maquetación en Chromium real (112 pasan con `--workers=2`): la
  barra del diálogo a 375, 768 y 1366 px, los filtros de la biblioteca a 375, 800, 900, 1024 y 1180 px
  y el calendario un lunes a las 00:39 de Madrid (dentro del borde). El banco se pasó en otro puerto
  (5396) porque el 5391 lo ocupaba el banco de otro trabajo: `playwright.layout.config.ts` reutiliza
  el servidor que encuentre y probaría el código de esa otra carpeta.
- **Pendiente**
  - Redesplegar la función `platform-integrations` y aplicar la migración `20270105010000` en staging
    (en cualquier orden: sin la migración, la prueba de Claude y la de fal.ai se hacen y se enseñan,
    pero no quedan anotadas).
  - Textos con «cupo» o «plan» que quedan en autogestión porque viven en zonas que no se tocaron en
    esta rama: editor de reels («Cuenta en el cupo de IA…»), «Hacer un reel como este» (su página),
    copiloto (el de «Editar foto» se quitó en `f51/editar-foto-simple`), importar publicaciones («Ocupan espacio de
    tu plan») y el aviso «Cambiar de plan» del calendario (lleva a una pestaña que en autogestión ya
    no existe y vuelve a General).
  - El criterio de «uso interno» de Plataforma mira las organizaciones de quien abre la pantalla, no
    todas las de la instalación (la lista de Plataforma no trae el modo de trabajo).
- **Sin probar**: nada contra un proveedor real (las sondas, con respuestas HTTP simuladas); las e2e
  01, 06 y 08, adaptadas al selector único **sin ejecutar** (necesitan el Supabase local); un
  navegador y un móvil reales fuera del banco.

## Ajustes del copiloto tras la prueba real (rama `f48/copiloto-ajustes`, 23/11/2026)

Prueba del dueño en staging con `gpt-6-luna` por la interfaz: las órdenes con corrección y dos
acciones ya llegan enteras y con nota; el plan «menú de otoño» generó un buen fondo sin comida.
Cuatro defectos corregidos (detalle en `docs/copiloto-voz.md`, apartados 9 bis y 15):

1. **Fotos sin recortar.** Antes: el recorte dependía de que el modelo mandase `cutout: true`.
   Ahora: si las fotos van sobre una imagen de fondo (generada, propia o ya puesta), el recorte es
   lo predeterminado, lo fija el navegador y la tarjeta lo dice («recortadas, sin su fondo»), con
   una casilla para colocarlas enteras. Un recorte ya guardado de esa foto se reutiliza.
2. **Colocación y legibilidad.** Antes: el título centrado quedó ilegible sobre el fondo nuevo y
   las fotos se fueron al tercio inferior. Ahora: se mide el tono del fondo generado (medio y por
   zonas) y los textos que ya había se revisan con la regla de contraste de siempre; si no se
   puede medir, llevan un contorno del color contrario. Los textos del centro dejan sitio a las
   fotos (los de titular suben, el resto baja) y las fotos van centradas en el hueco libre.
3. **El panel tapaba el lienzo.** Ahora es estrecho y acoplado (columna junto al lienzo en
   escritorio, hoja baja en móvil), con el historial plegado y sin scroll de página.
4. **El aviso «Antes de dictar»** sale solo al pulsar el micrófono por primera vez; para escribir
   no hace falta, y el micrófono ya no se abre solo al abrir el copiloto.

- **Probado:** unitarias, componentes, base de datos y banco en seco; maquetación en Chromium real
  (`tests/layout/copiloto-lienzo.spec.ts`, a 375, 1024 y 1366 px).
- **Sin probar:** nada de esto con IA real ni en staging. En particular, que el navegador pueda
  leer los píxeles del fondo generado (depende de las cabeceras CORS del almacenamiento; si no
  puede, sale el contorno), el recorte de fotos reales dentro de un plan y el aspecto final de la
  composición. La e2e 19 está adaptada y sin ejecutar en local.
- **Para staging:** solo la aplicación (sin migraciones ni funciones).

## Fotos y vídeos borrados de la biblioteca, y subir desde los selectores (rama `f49/medios-borrados`, 23/11/2026)

Origen: el reel «Reel nuevo» de staging usaba una foto que después se borró de la biblioteca; se
abría negro y sin aviso, y «Montar otra vez» enseñaba la ruta interna en rojo. Además, el dueño pidió
poder subir y crear con IA desde los selectores de material, y que el de reels no mezcle piezas ya
diseñadas con fotos.

- **Editor de reels** (`reels/editor/missing.ts`, `MissingMedia.tsx`): al abrir (versión, borrador
  automático o «Hacer un reel como este») se pregunta qué rutas del plan siguen en `media_assets`.
  Lo que falta se marca en la línea de tiempo y en la vista previa («Falta esta foto / este vídeo /
  esta música», con «Sustituir» y «Quitar»), con un aviso de una línea arriba. «Montar el vídeo» no se
  encarga mientras falte algo: lo dice y lleva al primero. Sustituir conserva duración, movimiento,
  filtro, transición y textos; si era la foto de la portada, la portada la sigue.
- **Editor de piezas** (`content/editor/missingAssets.tsx`): las capas de imagen y de logotipo cuyo
  recurso falta (de las que tenía la pieza al abrirla) pasan a ser un marco vacío «Poner foto», con aviso
  en la cabecera; un marco vacío no se exporta, así que exportar sigue funcionando. En solo lectura,
  solo el aviso.
- **Servidor** (migración `20270107010000_media_missing_messages.sql`, con vuelta atrás):
  `private.media_job_input` ya no enseña rutas; «La foto N ya no está en la biblioteca» (o «El vídeo
  N», «La música», «La foto de la portada») si la ruta es de la carpeta de la marca y no hay recurso;
  «Pieza N: el archivo no es un recurso de esta marca» si es de otra (sin revelar si existe). Mismo
  `errcode`. `asset_usage` busca también la ruta (los reels guardan la ruta) y mira el borrador de
  los reels.
- **Cliente**: `translateError` y el motivo de los trabajos pasan por `cleanMessage` (sin rutas ni
  identificadores; los errores de archivos, con qué hacer, también el mensaje antiguo del servidor).
- **Biblioteca**: el aviso al eliminar nombra las piezas afectadas (tres y «y N más») y dice que
  quedan con un hueco para sustituir.
- **Selectores** (`library/PickerUpload.tsx`): «Subir» a la vista y soltar archivos sobre el selector
  (cola de `UploadPanel`, con progreso, errores y duplicados), y «Crear con IA» (`GenerateImageDialog`
  con la proporción del plano o del hueco) si la imagen con IA está disponible. Lo nuevo queda elegido.
  En el material de reels («Añadir», «Sustituir», planos de una plantilla), en «Poner foto» y
  «Sustituir la foto» y en todo `ImagePickerDialog` con `uploadTo` (también el del copiloto, sin tocar
  su carpeta; para darle «Crear con IA» basta pasarle `aiRatio`). La música admite soltar la pista. El
  selector de reels oculta exportaciones, reels montados y portadas (`isAppDesign`) salvo con «Ver
  también diseños y montajes»; las fotos con IA y las ediciones sí salen.
- **Probado**: componentes (`mediosBorrados.test.tsx`, `piezaMediosBorrados.test.tsx`,
  `selectoresSubir.test.tsx`, `usageText.test.ts`, `errors.test.ts`, `biblioteca.test.tsx`), base de
  datos (`editor-reels.test.ts`, `medios.test.ts`, `aislamiento.test.ts` con el rechazo exacto sin ruta,
  `migraciones.test.ts`) y maquetación en Chromium (`tests/layout/medios-borrados.spec.ts`, 375 y
  1366 px: aviso y marca a la vista sin scroll de página; «Subir» a la vista sin scroll lateral).
- **Para llevarlo a staging**: aplicar `20270107010000` (sin ella la aplicación funciona igual y traduce
  el mensaje antiguo sin enseñar la ruta) y desplegar la aplicación. No hay funciones que redesplegar.
  El reel de staging lo arregla el dueño con «Sustituir».
- **Sin probar**: arrastrar archivos de verdad desde el escritorio (solo con eventos simulados y en
  Chromium sin archivo real); la imagen con IA real (solo con `ai-media` simulada); la migración en
  staging; un móvil de verdad.

## «Editar foto» en tres pestañas (rama `f51/editar-foto-simple`, 23/11/2026)

Cambio «"Editar foto" en 3 pestañas» de la propuesta de simplificación aceptada por el dueño
(`rrss-recursos-comparativa/simplificacion/`, F1, F2, F3, F6 y F7). Solo `src/features/photo-edit/`;
sin tocar el recorte ni el servidor. Detalle en `docs/edicion-fotos.md` §15.

- **Implementado.** Tres pestañas: **Ajustar** (automático + intensidad; Luz, Contraste, Color y
  Calidez a la vista; el resto en «Más ajustes»), **Recortar** (Entera, 1:1, 4:5, 9:16, siempre con
  encuadre inteligente; «Ampliar con IA» debajo) y **Fondo** (Quitar, Desenfocar, Cambiar con IA). Cada
  acción en un solo sitio: el encuadre sale de Ajustar, «Deshacer cambios» lo hace «Cancelar», la
  casilla de encuadre centrado desaparece. Ajustar y Recortar se guardan en una sola copia.
  **«Mejorar con IA» oculto** (`HIDDEN_AI_OPERATIONS`; el código y la tarea del servidor se quedan).
  Párrafos largos → una línea con «Más información»; el aviso de fuera de la UE y el coste máximo,
  siempre a la vista antes de gastar. En autogestión el coste ya no habla del cupo. Móvil: pestañas
  arriba, foto en medio, ajustes en hoja baja (≤ 45 %) que se oculta; sin scroll de página.
- **Probado.** `npm test` (componentes de `editarFoto.test.tsx` adaptados y 6 casos nuevos),
  `test:layout` (`editar-foto-pestanas.spec.ts` a 375 y 1366 px; `fotos-ia.spec.ts` por el camino nuevo).
- **Sin probar.** A mano en un navegador o un móvil reales; la e2e 26 (ajustada a «Fondo → Cambiar con
  IA» y a «Usar esta») no se ha ejecutado.
- **Pendiente / para decidir.** De la propuesta quedan fuera «Cancelar» y «Listo» (F5), el formato
  «libre» (F4) y lo repetido del panel del editor de piezas (P3). «Ampliar con IA» sigue ofreciéndose
  (en Recortar): si «la IA solo crea fondos» vale también para él, se oculta añadiéndolo a
  `HIDDEN_AI_OPERATIONS`.

## IA sin perfil, planes que no fallan ni cobran y reels de campaña listos (rama `f55/ia-campanas`, 23/11/2026)

Arreglos de la prueba de calidad en staging del 23/11/2026 (`rrss-recursos-comparativa/e2e-calidad/INFORME.md`,
fallos 1, 2, 3, 15, 16 y 23). Migración nueva `20270115010000_ia_inservible_y_piezas_de_plan` (con su vuelta atrás).

- **IA sin perfil (fallo 1).** `ai-generate` y `ai-reel-like` ya no responden «Esta marca todavía no tiene perfil»: sin
  perfil, la IA trabaja con el nombre, el sector y la web de la marca (`_shared/ai/text/tasks/brand-context.ts`, con una
  nota para que no invente datos); con perfil, recibe además el nombre de la marca (los lugares, como en el perfil: fallo 23).
  Solo si no hay perfil NI sector, `post.caption`, `campaign.brief`, `campaign.plan` y `brand.check` responden 409
  `brand_basics_missing` antes de reservar cupo, y los diálogos piden «¿A qué se dedica la marca?» (se manda como
  `brandSector` y, si la persona gestiona la marca, se guarda en `brands.sector`). Con un perfil incompleto, «Redactar
  con IA» y «Preparar un plan» avisan en una línea con enlace a completarlo. El copiloto del editor recibe el perfil tal
  cual si existe (no cambia nada más). Inicio ya no presenta el perfil como requisito. «Hacer un reel como este» sin
  perfil responde `available: true, profileMissing: true` (la pantalla de reels/like no se ha tocado: su aviso
  «profile_missing» ya no sale).
- **Plan con «Detalles» a mano (fallo 2). Causa:** el servicio validaba la respuesta con el esquema completo y lo
  único que el proveedor no garantiza (longitudes) tiraba el plan entero; con una descripción detallada el modelo
  escribe ideas de más de 300 caracteres, fechas con hora o en «24/11/2026», «Instagram»/«Publicación», el nombre de la
  foto en lugar de su id… y con 1.500 + 700 tokens por pieza un modelo que razona se cortaba. El camino de «Que la IA
  proponga» tenía más piezas (más margen) y fases que acortaban las ideas. Además, lo inservible se cobraba (se cerraba
  con `ai_complete_generation`). **Arreglo:** `campaign.plan` valida solo la forma (`AiOutputSchema.localSchema`: campos
  y tipos; un campo no previsto sigue invalidando) y sanea el resto (`sanitizePlan`: recorta, normaliza red, formato,
  fecha y hora, mapea nombres de foto), con `3000 + 800 × piezas` tokens de salida. Lo que no sirve (esquema roto,
  cortado o un plan sin ninguna pieza válida, vía `AiGenerateParams.accept`) se cierra con `ai_waive_generation`:
  reserva devuelta, nada en el libro de la organización y el coste real en `ai_generations.waived_cost_micros`, que
  sí cuenta para el tope de gasto de la plataforma (`private.ai_global_committed`). La respuesta lleva `charged: false`
  y la interfaz dice «No se ha descontado nada». Si la migración no está, se cobra como antes (no se rompe nada). El
  diálogo enseña «Preparando el plan…» mientras espera. **No reproducido contra el modelo real**: la causa se ha
  deducido del código y de lo que cuenta el informe; los registros `brief_mix_normalized` de staging no se han leído.
- **Reels de campaña (fallo 3).** Al aceptar un plan, cada pieza en formato reel se guarda como versión 2 con un
  proyecto de reel construido por el mismo camino que «Desde una plantilla» (`buildReelFromTemplate`, sin tocar el
  montaje ni el plan v2): la plantilla de reel de la marca que sugiere la ficha (o la menos usada en la campaña; sin
  plantillas, una sencilla sobre el primer estilo), y fotos o vídeos de la biblioteca elegidos por el tema de la pieza
  (primero los que sugiere el plan), sin repetir dentro del reel y repartidos entre reels, sin exportaciones, montajes,
  portadas, imágenes de IA ni recortes. El titular del plan sustituye al gancho de la plantilla y se quitan los textos
  de muestra de planos concretos; el pie y los hashtags del plan van en `copy`. Con trabajador
  (`VITE_MEDIA_WORKER_ENABLED`), el diálogo de aceptar ofrece montar los vídeos al momento, diciendo antes que no gasta
  cupo de IA y cuántos montajes cuenta. Como el reel ya tiene material, el aviso de «diseño por capas» no sale. La IA
  ya no debe proponer reels tipográficos sin imágenes (instrucciones de `campaign.plan` y `campaign.brief`).
  Código: `src/features/campaigns/reelPieces.ts` y `prepareCampaignReels` en `api.ts`.
- **Lo que promete el plan (fallo 15).** Las piezas del plan tienen cuatro campos opcionales (`title`, `time`, `aspect`,
  `headline`; DB: `private.campaign_plan_problem`; cliente: `plan.ts`). El motor usa la proporción del plan si la red la
  admite (4:5 es 4:5), pone el titular en una franja con el color y la tipografía de la marca, y llama a la pieza con
  su título corto. «Programar» propone el día y la hora del plan (`usePlannedSlot`; sin hora, a las 10:00). El texto de
  la propuesta se rehace si sus cifras no cuadran con el ritmo final y, si el reparto del modelo no sirve pero el texto
  lo dice con cifras, se usa ese. Los pies terminan con la llamada a la acción de la marca (instrucción).
- **Coste antes de pulsar (fallo 16).** Acción nueva `cost.estimate` de `ai-generate` (`post.caption`,
  `campaign.brief`, `campaign.plan`): ejecuta la tarea con un servicio que no genera y devuelve lo que se reservaría,
  sin cupo ni proveedor. «Redactar con IA» y «Preparar un plan» enseñan «Coste máximo de …» antes de pulsar.
- **La IA en la biblioteca para el plan** ya no recibe exportaciones ni montajes (fallo 17, de paso).
- **Pruebas nuevas:** `tests/db/ia-generate.test.ts` (sin perfil: sector, nombre, coste máximo, no cobrar),
  `tests/db/campanas.test.ts` («plan con detalles a mano»: respuesta realista saneada, sin piezas no cobra, cortada no
  cobra, la base de datos acepta los campos nuevos), `tests/db/ia-campanas-reparto.test.ts` (texto frente a ritmo),
  `src/features/campaigns/reelPieces.test.ts` (material, plantilla, titular, 4:5, título corto) y
  `src/features/campaigns/campanasCalidad.test.tsx` (sector en el diálogo, coste, indicador, «no se ha cobrado»,
  reels guardados con plantilla y fotos, fecha y hora al programar). El simulador de Supabase de las pruebas responde
  solo a `cost.estimate` y no lo cuenta como llamada.
- **Para desplegar en staging** (en este orden): la migración `20270115010000` (antes que lo demás: sin ella, la base de
  datos rechaza los planes con `title`/`time`/`aspect`/`headline`); las funciones `ai-generate` y `ai-reel-like`; la web.
- **Sin probar:** nada contra un modelo real (calidad de títulos, horas y titulares, si el modelo real sigue mandando un
  reparto inservible en `campaign.brief`); los reels preparados al aceptar no se han montado de verdad ni visto en un
  navegador; el aviso de «diseño por capas» que seguía tras montar a mano un reel vacío es del editor de reels (zona de
  otra rama) y no se ha tocado.

## Arranque rápido (rama `f60/arranque-rapido`, 23/11/2026)

El dueño veía 8–10 s al entrar por una dirección directa en staging: «Cargando…» y después
siluetas varios segundos. Zona: arranque y carga; sin cambiar lo que se ve salvo que sale antes.

- **Causas medidas.** (1) Cascada de tres viajes a Supabase antes del menú: lo legal y si se
  administra la plataforma (LegalGate, con «Cargando…» a pantalla completa) → organizaciones,
  marcas y permisos (OrgLayout) → la pantalla. (2) La precarga de las 4 secciones principales
  (la Biblioteca arrastra el editor de fotos) salía durante el arranque, también en «Entrar»:
  88 trozos de JS antes del menú. (3) El menú «Crear» metía en el primer paquete el módulo de
  «Hacer un reel como este» con zod, plantillas de reels y la API de IA. (4) En staging los
  recursos con huella se servían con `max-age=0, must-revalidate`: cada visita, ~90 respuestas 304.
- **Implementado.**
  - `src/features/orgs/startup.ts` (`prefetchStartup`): en cuanto RequireAuth sabe la sesión,
    lanza a la vez lo legal, administración de la plataforma, organizaciones, marcas y permisos de
    la organización de la dirección (en «/», la última visitada) y la disponibilidad de la IA de
    texto. Las consultas pasan a `queryOptions` (`myOrganizationsQuery`, `platformAdminQuery`,
    `brandsQuery`, `myBrandRolesQuery`, `legalAcceptancesQuery`): misma clave, nada se pide dos
    veces. LegalGate pinta el armazón con siluetas mientras comprueba. RootRedirect decide igual
    que antes al entrar en frío por «/» (`isColdRootEntry`), llegue antes o no la lista.
  - Precarga de secciones (`PreloadMainSections` en `src/App.tsx`): solo dentro de una marca,
    tras 1 s sin consultas en marcha y con el navegador libre.
  - `src/layout/ReelLikeProbe.tsx`: la disponibilidad de «Hacer un reel como este» se pregunta
    desde un trozo que el menú carga bajo demanda (sin tocar `src/features/reels/`). El trozo
    fijo `ui` ya no lleva Dialog ni Tabs de Radix.
  - `vercel.json`: `/assets/*` con `public, max-age=31536000, immutable`.
  - `vite.config.ts`: `<link rel="preconnect">` al proyecto de Supabase (si hay `VITE_SUPABASE_URL`).
  - Control de tamaño: `npm run check:initial-js` (tras `npm run build`; `scripts/check-initial-js.mjs`)
    falla si el JS inicial pasa de **229 KB gzip** (208 conseguidos + 10 %). No va dentro de
    `build`: hay que ejecutarlo aparte (o añadirlo al CI).
- **Medidas** (build local con `vite preview` y un Supabase simulado que responde a los 250 ms
  —600 ms las funciones—; Chromium con red limitada por CDP: 100 ms de latencia, 4 Mbit/s;
  entrada directa a `/o/:org/m/:marca/inicio` con sesión; mediana de 8 vueltas alternadas):

  | | Antes | Ahora |
  | --- | --- | --- |
  | JS inicial (gzip, 5 archivos) | 239,7 KB | 208,2 KB |
  | Peticiones antes de ver el menú | 102 (88 de JS) | 51 (37 de JS) |
  | Olas de peticiones a Supabase | 3 | 2 |
  | Menú pintado | 3,28 s | 2,01 s |
  | Pantalla con sus datos | 3,33 s | 2,46 s |
  | Con la CPU 4× más lenta (6 vueltas): menú / pantalla | 2,79 / 2,86 s | 1,71 / 2,42 s |

  La máquina estaba cargada (otros agentes): las cifras absolutas varían ±1 s entre tandas; las
  vueltas alternadas mantienen la comparación. Staging (solo lectura, sin sesión en el navegador
  integrado): «Entrar» pedía 90 trozos y precargaba secciones; los recursos, sin caché larga.
- **Sin probar.** El arranque con sesión en staging tras desplegar (no había sesión en el
  navegador integrado y no se despliega desde esta rama); la caché larga y la preconexión solo
  se verán en Vercel. Queda una ola: las consultas de la pantalla (perfil, publicaciones…) esperan
  a las marcas porque viven en carpetas de otros agentes; adelantarlas sería el siguiente paso.

## Reels con acabado profesional (rama `f54/reels-calidad`, 23/11/2026)

El dueño vio los reels de staging del 23/11 («la calidad de los reels es muy mala»). Detalle por punto,
plan v2 ampliado, fuentes de música propuestas y lo que falta en las pantallas: `docs/reels-calidad.md`.
Montajes de antes y después con fotos reales en `rrss-recursos-comparativa/reels-calidad/comparativa.html`.

- **Implementado** (trabajador, con cualquier plan): textos por papel con tamaño mínimo, cortes equilibrados,
  zonas seguras de Instagram (250/400/60 px) y sin solapes (se apilan o se encadenan); Montserrat
  ExtraBold/SemiBold (OFL) dentro de la imagen; encuadre sobre el sujeto (máscara de «Quitar el fondo» o
  saliencia) con movimiento suavizado; gradación ligera; cierre con la marca (`plan.outro`); sin música ni
  sonido, vídeo sin pista de audio; H.264 High ~9 Mbps con `+faststart`. Aplicación: material sin repetir y
  por calidad (`quality.ts`), estilos por papel con los colores de la marca, catálogo de restaurante revisado.
  Migración `20270113010000_reels_calidad.sql` (campos opcionales `role`, `subjectMaskPath`, `outro`, `grade`).
- **Probado**: trabajador con FFmpeg real (`worker/tests/reel-quality.test.ts`), base de datos
  (`tests/db/editor-reels.test.ts`), aplicación (`quality.test.ts`, plantillas, «como este») y catálogo.
- **Pendiente**: elegir fuente de música. Sin probar en Fly (FFmpeg 7.1) ni publicar en Meta un reel sin pista
  de audio. Lo de las pantallas (guardar los campos nuevos, aviso «Sin música», selectores ordenados y vista
  previa fiel) lo hizo la rama `f64/calidad-en-editor` (sección siguiente).
- **Para staging**: migración, trabajador (imagen con `worker/fonts/`), aplicación y volver a cargar el catálogo.

## La calidad de las muestras, en el editor de reels (rama `f64/calidad-en-editor`, 23/11/2026)

Conecta lo de `f54/reels-calidad` al editor, para que los reels que se crean desde la app salgan como las muestras.
Detalle, antes y después por punto, en `docs/editor-reels.md` §12. Sin migraciones ni cambios en el trabajador.

- **Implementado**: el proyecto guarda y envía `role`, `outro`, `grade` y `subjectMaskPath`; «Desde una plantilla»,
  «Plantillas de la marca» y los reels de las campañas pasan por `buildBrandReel` (la mejor foto abre, vídeos a los
  planos de ambiente, rótulo por plano, cortes al pulso, puntos y máscaras guardados, papel en cada texto, colores
  y cierre con logotipo, llamada, usuario y dirección del perfil; se quita o se pone desde «⋯»); selectores
  ordenados con `rankReelAssets`; «Sin música» junto a «Exportar» (`AudioNotice`, con su forma para la hoja
  «Exportar» de f62); vista previa con los mínimos de texto del trabajador (`editor/textFit.ts`) y el cierre.
- **Probado**: unitarias (`editor/calidadEditor.test.ts`), componentes (`editorReels.test.tsx`), la cuenta de la
  vista previa frente a la del trabajador y el esquema del trabajador con un reel del editor
  (`tests/db/vista-previa-textos.test.ts`), `test:layout` y dos montajes reales con FFmpeg por el camino del editor
  (`scripts/reels-desde-editor.ts`; hojas en `rrss-recursos-comparativa/reels-calidad/desde-editor-*.jpg`): sin
  solapes, texto en cada plano, sin bandas, cierre con logotipo y sin fotos repetidas.
- **Pendiente**: enganchar `AudioNotice` en la hoja «Exportar» con «Terminar en Instagram» (f62); que «Hacer un reel
  como este» escriba `role` y el cierre; un logotipo claro de la marca para el cierre (el de la web de Casa Tomás es
  oscuro y no se vería); comprobar el usuario de Instagram del perfil (la web enlaza a `@casatomascrevillent`; las
  muestras usan `@restaurantecasatomas`, como las de f54).
- **Sin probar**: la vista previa en un navegador real con la letra de la marca (las medidas se acercan, no son las
  del archivo de la tipografía); móvil y Safari reales.
- **Para staging**: lo de f54 (migración `20270113010000` y trabajador nuevo) antes que esta aplicación.

### Plantillas de menús del restaurante (rama `f74/plantillas-menus`, 25/11/2026)

«＋ Crear → Menú o carta del restaurante» (ruta `…/m/:brand/menus`, `src/features/menus/`). Escribir los platos → elegir la
foto de la biblioteca (o subirla) → vista previa real (mismo motor que la exportación) → «Publicar o programar», que crea la
pieza (historia, publicación o carrusel) y abre el editor ya en «Compartir» (`?compartir=1`) con el pie escrito.

- **Diarias:** menú del día (primeros, segundos, postre, precio, qué incluye), menú de tapas (foto, nombre y precio por tapa),
  tapa de la semana, carta o vinos destacados («Nombre | 3,50 €» por línea). **Eventos** (grupo aparte, un solo diseño con
  marco dorado doble, precio en pastilla y fondo opcional de foto o IA velado): Nochevieja, Navidad, San Valentín y otro.
  Cada una en historia (1080 × 1920) y publicación (1080 × 1350). Partieron de las historias de tapas y menú del catálogo.
- **Reglas de diseño:** Libre Baskerville (`@fontsource-variable/libre-baskerville`, SIL OFL, registrada en `appFont.ts`), sin
  cursivas; todas las líneas de un plato con el mismo color y peso; foto de fondo siempre bajo un velo; nombres propios y
  cantidades con espacios duros (`medir.ts`); cada plato con su caja medida (lienzo del navegador; estimación en pruebas).
  Menú largo: la publicación se reparte en carrusel (hasta 10 páginas); la historia, al ser una imagen, avisa y no se publica.
- **Catálogo (`agency/catalogo/historias.ts`):** quitadas las cursivas de las historias de tapas y menú.
- **Menú del día automático:** en este repositorio NO hay publicación automática del menú del día; el único automático que
  existe es la story del jueves de tapas del panel de Casa Tomás (sección Instagram antigua, programada por
  `instagram-programador`). El menú del día se sube solo a la web (`menus_diarios`), no a Instagram. La plantilla es una
  función pura (`construirMenu(tipo, datos, formato, tema)`) lista para que una automatización la llame con esos datos.
- **Probado:** unitarias (`disenos.test.ts`: reglas, sin solapes, zona segura, carrusel), `test:layout` (`menus.spec.ts`: cada
  plantilla en historia y publicación, corto y largo, textos medidos con Konva real, flujo por la interfaz hasta «Compartir»;
  `menu.spec.ts`), componentes de `layout/`. **Sin probar:** contra el Supabase de staging (la sesión pide contraseña); publicar
  de verdad. Capturas en `rrss-recursos-comparativa/plantillas-menus/`.

## Reels con IA ocultos (rama `f76/ocultar-reels-ia`, 26/11/2026)

Decisión del dueño: los reels hechos por la IA salen mal; de momento se hacen a mano (plantilla de reel, fotos y vídeos propios, editor, exportar y «Terminar en Instagram»).

- **Interruptor:** `REELS_IA_VISIBLE` en `src/config/flags.ts`, en `false`. Para reactivarlo, ponerlo en `true` (siguen mandando `VITE_REEL_LIKE_ENABLED` y el trabajador de medios). No se ha borrado código ni funciones del servidor.
- **Ocultado:** «Hacer un reel como este» en «＋ Crear», en «Crear contenido» y en Reels (todos pasan por `reelLikeEnabled()`); la ruta `biblioteca/reels/como-este[/:id]` redirige a Reels. En campañas, al aceptar un plan ya no se preparan ni se montan solos los reels (`campaignReelsAutoEnabled()`): quedan como borrador para montar a mano, y el aviso de aceptar lo dice. El copiloto, Inicio y Contenidos no tenían otra entrada para hacer un reel con IA.
- **Sin cambios:** editor de reels, plantillas de reel, subtítulos y la IA de fondos/imágenes.
- **Pruebas:** borrada `reelLike.test.tsx` (pantallas de «como este») y dos de `listaContenidos.test.tsx` (coste de «como este»); añadida `src/features/reels/like/reelsIaOculto.test.tsx` (sin entradas y la ruta redirige).
