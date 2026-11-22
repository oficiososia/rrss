# Estado del proyecto

Última actualización: 22/11/2026 (rama `f40/campanas-voz`; antes, `f37/copiloto-herramientas` y `f36/reel-como-este`).
Rama de trabajo: `claude/focused-noether-hk502p` (PR abierto a `staging`; `main` y `staging`
existen desde el 16/11/2026). Lo que falta para lanzar, por área y con responsable, está en
`docs/PENDIENTES.md`.

## Resumen por área

Regla: «implementado» = el código existe; «probado» dice con qué (simulado ≠ real);
nada se da por funcionando contra un servicio real que no se haya llamado.

| Área | Implementado | Probado | Pendiente | Bloqueado |
| --- | --- | --- | --- | --- |
| Núcleo multiempresa (Fase 1) | Sesión, organizaciones, marcas, perfil versionado, biblioteca, equipo y roles, aislamiento | Unitarias, componentes, base de datos y e2e 01–08 en CI | Correo propio para invitaciones y recuperación | SMTP propio (hoy 2 correos por hora) |
| Editor de piezas | Capas, documento v5, páginas (carrusel), plantillas, atajos, menú plegable, sin scroll de página, móvil con hoja inferior, copiloto por voz | Unitarias, componentes, base de datos, `test:layout` en Chromium real y e2e 09, 19, 27, 28 | Revisión a mano en navegador y móvil reales; migración `20261220010000` (renombrar y duplicar plantillas) sin aplicar en staging | Dictado real y proveedor de IA real |
| Editar foto | Pantalla completa, mejora automática (intensidad), recortes, fondos, sombra, quitar el fondo (BEN2 con WebGPU, IS-Net, servidor de respaldo), modo retrato con vista previa y pincel de retoque de la selección, cambiar el fondo con IA | Unitarias, componentes, base de datos, e2e 22, 25 y 26 | BEN2 con WebGPU real; el pincel con teclado y el guardado en worker, a mano en un navegador real | Clave de OpenAI / ComfyUI real |
| Reels | Plantillas, editor con línea de tiempo, subtítulos automáticos, música, pantalla de salida de tres pasos, «Hacer un reel como este» (estudiar un vídeo de referencia y rehacerlo para la marca; solo en local, con IA simulada) | Trabajador con FFmpeg real (CI), componentes, e2e 11 y 29; un reel real por plantilla salió en staging el 21/11 | Ver el editor nuevo y la pantalla de salida en staging; redesplegar `media-storage` y `ai-transcribe` | Tarjeta en Fly; clave de OpenAI para subtítulos |
| IA (texto e imagen) | Adaptadores, cupo, coste, perfil de voz, campañas | Con proveedores simulados (e2e 09, 10, 14) | Elegir proveedor y precios reales | Cuenta y claves del proveedor |
| Publicación en Instagram y analítica | OAuth, token pegado, publicar, programar, publicar ahora, carrusel, reel, importar histórico, métricas, informe | Contra la Graph API **simulada** (e2e 13, 15, 18, 23, 24, 27) | Probar con una cuenta real | Aplicación de Meta y su revisión |
| Facturación y planes | Planes como datos, límites en la base de datos, margen, Stripe (Checkout, portal, webhook) | Planes y límites en base de datos y e2e 16; Stripe solo simulado | Precios, desplegar funciones | Cuenta de Stripe |
| Alojamiento | Staging en Supabase gratuito y Vercel; trabajador en Fly (modo `drain`, `worker-gateway`); R2 y Drive escritos | Trabajador y gateway en staging con recortes y un reel; R2 solo con MinIO; Drive con Drive simulado | Producción (Supabase Pro, dominio, Vercel Pro) | Cuentas de Cloudflare y Google; tarjeta en Fly |
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
| «Probar conexión» de Integraciones                                                         | Probado con servicios simulados: ninguna llamada real a Meta, Stripe, IA ni ComfyUI                                                                                                                                 | `docs/05-puesta-en-marcha.md`              |

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
  - **Herramientas** (function calling) por defecto: 23 herramientas, una por operación, con
    todo lo que el editor hace a mano (textos y efectos, capas, figuras, fotos, lienzo,
    páginas, deshacer, guardar, plantillas y los flujos de foto). Adaptadores de OpenAI y de
    Claude por la misma interfaz (`AiInput.tools`). La ruta JSON sigue detrás de
    `AI_TEXT_EDITOR_COPILOT_MODE=json`.
  - **Órdenes frecuentes sin IA** (intérprete local): «deshaz», «guarda», «más grande»,
    «siguiente página»… coste cero y respuesta inmediata.
  - **Órdenes por teclado**: campo de texto en el panel; el copiloto sale y funciona sin
    micrófono.
  - **Dos motores de voz**: dictado del navegador o transcriptor de OpenAI (`ai-transcribe`,
    con cupo), a elegir; aviso de privacidad por motor.
  - **Prompt compacto**: herramientas e instrucciones comunes delante (cacheables), marca en
    tres líneas, documento en una línea por capa.
  - **«Probar conexión» de IA de texto hace una generación mínima real** (1 token de salida
    por modelo configurado) con el mismo endpoint que las tareas: una clave que lista modelos
    pero no puede generar ya no da «Funciona».
  - **Banco** `scripts/copiloto-banco.ts`: 75 órdenes; en seco por defecto.
- **Probado:** unitarias, componentes y base de datos (proveedores y micrófono simulados);
  e2e 19 adaptada (compila; **sin ejecutar en local**, corre en CI).
- **Sin probar contra nada real:** la ruta de herramientas con OpenAI o Claude (formato,
  `strict`, `reasoning_effort: "none"`, caché), el transcriptor, el micrófono, la sonda de
  generación y el banco con `--apply`. Los objetivos de latencia (< 1,5 s) y de tokens sin
  caché (< 1.500) **no están medidos**: con el contador del simulado el total por orden sube
  de 2.455 a 3.122 tokens y lo no compartible entre marcas baja de 1.065 a 149; que se cumpla
  depende de que el proveedor lea de caché el prefijo común.
- **Para llevar a staging (en este orden):** aplicación → migración `20261226010000` (dos
  ajustes de Integraciones, con vuelta atrás) → funciones `ai-generate`, `ai-transcribe` y
  `platform-integrations`. Después, el banco real (`docs/copiloto-voz.md`, apartado 13).
- **Pendiente:** precio de la escritura de caché de OpenAI (se cuenta como entrada normal);
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
