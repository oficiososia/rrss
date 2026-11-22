# Pendientes para lanzar

Lista única de lo que falta para pasar de «probado en local y en staging con
proveedores simulados» a «clientes de pago usándolo». Para saber qué hay hecho y
cómo está probado, mira `docs/ESTADO.md`; aquí solo lo que **falta**.

Última revisión: 22/11/2026 (ramas `f30/instagram-pendientes` y `f31/flecos-editor`).

- **Quién:** `Dueño` = necesita una cuenta, una decisión, dinero o una firma suya;
  `Desarrollo` = trabajo de código o de despliegue que se puede hacer sin él (o
  con un «sí» suyo puntual); `Ambos` = el dueño pone la cuenta o el «sí» y
  desarrollo lo conecta y lo prueba.
- **Prioridad:** `P0` bloquea el lanzamiento con clientes de pago; `P1` hay que
  tenerlo en las primeras semanas o el producto cojea; `P2` mejora, sin bloquear.
- Una fila con **Bloqueado** espera algo externo (Meta, Google, Stripe…): hasta que
  llegue, el código correspondiente sigue siendo «escrito y probado con un
  proveedor simulado», nunca «funciona».

## 1. Publicación en Instagram (y medir)

| P | Qué falta | Quién | Notas |
| --- | --- | --- | --- |
| P0 | Crear la aplicación de Meta (tipo Business), verificación de empresa y revisión de permisos (`instagram_business_content_publish`, métricas) | Dueño | **Bloqueado.** Sin ella no hay OAuth ni publicación real. Con acceso estándar y una cuenta propia ya se puede probar en staging (`docs/publicacion.md` §4) |
| P0 | Fijar `SOCIAL_APP_URL` en las funciones de staging (el botón «Conectar con Meta» no sale sin él) y meter App ID, App Secret y la clave de cifrado en Integraciones | Ambos | Configuración, no código (`docs/ESTADO.md`, «Acciones claras») |
| P0 | Publicar una pieza real (imagen, carrusel y reel) en una cuenta de pruebas y comprobar el enlace, el calendario y la métrica | Desarrollo | Hoy solo probado contra la Graph API simulada (e2e 13, 23 y 27) |
| P1 | Importar publicaciones y capturar métricas contra Meta real (límites de la API, paginación, tokens que caducan a los 60 días) | Desarrollo | Escrito y probado con simulador; sin Meta real |
| P1 | Probar contra Meta real la renovación automática del acceso (¿amplía `fb_exchange_token` la caducidad de un token largo vigente?) y el `cover_url` de la portada de un reel | Ambos | **Bloqueado** por la aplicación de Meta. Escrito y probado con la Graph API simulada; si Meta no amplía la caducidad, la renovación no se da por buena y el aviso pide volver a conectar con 14 días de margen (`docs/publicacion.md`) |
| P2 | Historias de Instagram, Facebook y otras redes | Desarrollo | No implementado; decidir si entra en el primer lanzamiento |

## 2. Editor de piezas

| P | Qué falta | Quién | Notas |
| --- | --- | --- | --- |
| P0 | Revisión a mano en un navegador real y en un móvil real (escritorio y 375 px): dibujo con Konva, recorte arrastrando el marco, pellizco táctil, «Editar foto» a pantalla completa, hoja inferior | Ambos | Todo está probado con navegador real **sin** Supabase (`test:layout`) y en componentes; falta el uso de verdad con datos reales |
| P0 | Aplicar en staging `20261220010000` (renombrar y duplicar plantillas); sin ella, esos dos botones de Marca → Identidad visual dan error | Ambos | Las migraciones `20261207…` a `20261217…` **ya están aplicadas en staging**, salvo `20261213120000` (uso de la función de Vercel `api/cutout-mask`, que está apagada: no hace falta) |
| P1 | Que `media-storage` registre el mensaje del error y no solo su nombre | Desarrollo | `media-storage/sign` ya firma por tandas (el 500 con muchas rutas está arreglado) y la migración de `thumb_path` está aplicada en staging |
| P2 | Zonas seguras de 1:1 y 4:5 con cifra publicada por la red (hoy son un cálculo propio de la rejilla del perfil, orientativo) | Desarrollo | Las guías al mover varias capas ya están (`f31`) |
| P2 | Exportar en el servidor (hoy solo en el navegador) y `media.document.export` | Desarrollo | |

## 3. Reels y trabajador de medios

| P | Qué falta | Quién | Notas |
| --- | --- | --- | --- |
| P0 | Tarjeta de pago en Fly (sin ella la prueba corta a los 5 min) y borrar la máquina sobrante `1859526f369798` | Dueño | **Bloqueado** por la tarjeta (`docs/alojamiento.md` §4.2) |
| P0 | Probar un reel completo desde el **editor de reels nuevo** y la **pantalla de salida de tres pasos** en staging, en escritorio y 375 px (nadie los ha visto en un navegador real) | Ambos | El reel por plantilla sí salió en staging el 21/11 |
| P0 | Desplegar `ai-transcribe` y `worker-gateway` si aún no están en staging | Desarrollo | Con el «sí» del dueño. `media-storage` ya firma por tandas y `20261207010000` y `20261208010000` están aplicadas en staging |
| P1 | Subtítulos automáticos contra OpenAI real (clave de Integraciones con residencia UE) y precio real por minuto | Ambos | Hoy transcripción simulada |
| P1 | Música: decidir si se ofrece una biblioteca con licencia (hoy la marca confirma que tiene la licencia) | Dueño | |
| P2 | Tipografías .woff para los textos del reel | Desarrollo | Cortes al compás, animaciones de texto y portada ya están (`docs/editor-reels.md` §8); la portada también se manda a Instagram al publicar |
| P2 | Pantalla de «Recortes» de vídeo en la aplicación | Desarrollo | La base de datos ya acepta el encargo |

## 4. IA (texto, imagen y edición de fotos)

| P | Qué falta | Quién | Notas |
| --- | --- | --- | --- |
| P0 | Elegir proveedor y cupo mensual: Google Cloud/Vertex en la UE, OpenAI con `eu.api.openai.com` u otro (hay comparativa en `docs/ia-texto.md` y `docs/ia-medios.md`) | Dueño | **Bloqueado** hasta que haya cuenta y precios confirmados |
| P0 | Poner la clave `OPENAI_API_KEY` (o la del proveedor elegido) en Integraciones y probar de verdad: redactar, copiloto por voz, cambiar el fondo, mejorar, subtítulos | Ambos | Todo lo de IA está probado solo con proveedores simulados; precios y modelos nacen inactivos y sin precio verificado |
| P1 | Quitar el fondo en el servidor: medir tiempo y memoria reales en Fly con fotos de clientes (la cadena es navegador con BEN2 → trabajo `media.cutout` en Fly → IS-Net) | Desarrollo | Va por Fly y está probado en staging. `api/cutout-mask` (Vercel) queda **apagada** y sin desplegar; solo se reactiva con `VITE_CUTOUT_SERVER_URL=/api/cutout-mask` |
| P1 | Probar BEN2 con WebGPU real y el recorte sobre fotos reales de 12 MP | Ambos | El corte «en diagonal» del chuletón quedó explicado: esa foto es un post ya diseñado y la franja de texto tapa la bandeja; no era un fallo del recorte |
| P1 | Decidir si se quita el fondo también en el trabajador sin GPU (pesos de 100–200 MB) o con ComfyUI | Dueño | `docs/edicion-fotos.md` §4 y §5 |
| P1 | Pasar el cupo y el coste reales a los planes (el cupo por plan se calcula con precios inventados del simulador) | Ambos | |
| P1 | Valorar el modo retrato y la mejora automática con fotos de platos reales de los clientes (los números actuales salen de 12 fotos) | Ambos | |
| P2 | Vídeo con IA: sigue apagado por criterio de datos; decidir si se activa | Dueño | |
| P2 | Copiloto por voz en modo agencia: mantener, quitar o hacerlo configurable por marca | Dueño | `docs/copiloto-voz.md` §4 |
| P2 | Aviso dentro del copiloto antes del primer dictado (el audio va a Google o Microsoft) | Desarrollo | La política ya lo dice |

## 5. Facturación y planes

| P | Qué falta | Quién | Notas |
| --- | --- | --- | --- |
| P0 | Decidir moneda, precios y límites de los planes (propuesta en `docs/facturacion.md`) y el plan por defecto | Dueño | |
| P0 | Abrir la cuenta de Stripe de la empresa; un producto y un precio recurrente por plan; configurar el portal de cliente | Dueño | **Bloqueado.** Hoy Stripe solo está probado simulado |
| P0 | Desplegar `billing-checkout`, `billing-portal` y `billing-webhook`, dar de alta el punto de conexión y probar alta, impago, cambio de plan y cancelación con tarjetas de prueba; después `VITE_BILLING_ENABLED=true` | Ambos | `docs/facturacion.md` «Qué falta para activarlo» |
| P1 | Impuestos (Stripe Tax o tipos fijos), datos fiscales en la factura, periodo de prueba en Stripe y avisos de impago por correo | Ambos | |
| P1 | Comprobar el margen por cliente con costes reales de IA y de almacenamiento | Desarrollo | Hoy sale con precios de simulador |

## 6. Alojamiento y operación

| P | Qué falta | Quién | Notas |
| --- | --- | --- | --- |
| P0 | Supabase de **producción** en plan Pro (copias de seguridad, sin pausas) y aplicar todas las migraciones allí; las de staging siguen por delante | Dueño | Hoy solo hay staging (plan gratuito) |
| P0 | Vercel: el plan Hobby es solo para uso no comercial y da 4 h de CPU al mes; para clientes de pago hace falta Pro (el recorte ya no depende de Vercel: va por Fly) | Dueño | `docs/ESTADO.md`, recorte refinado |
| P0 | Dominio propio y retorno de inicio de sesión a ese dominio | Dueño | Hoy `rrss-omega.vercel.app` |
| P0 | Correo propio (SMTP: Resend u otro) para registro, recuperación e invitaciones; hoy llega solo al equipo de Supabase, 2 por hora | Ambos | **Bloqueado** hasta tener el servicio |
| P0 | Secretos de Vault `rrss_project_url` y `rrss_service_role_key` en staging y producción, para que los trabajos programados (publicador, analítica, huérfanos, despertador del trabajador) hagan algo | Ambos | Sin ellos solo dejan un aviso |
| P1 | Cloudflare R2: cuenta, cubo en la UE, CORS, token solo del cubo y DPA; después recuento y migración de ~3 GB (`scripts/migrar-a-r2.ts`, `scripts/alta-biblioteca.ts`) | Dueño | **Bloqueado** hasta la cuenta. Probado solo con MinIO |
| P1 | Google Drive: cliente OAuth (Drive API, pantalla de consentimiento en producción sin verificar) y las 371 HEIC pendientes de convertir | Dueño | **Bloqueado**; HEIC aún no se pueden usar |
| P1 | Vigilancia: alertas de errores de funciones, de cupo y del coste de IA; la limpieza de `storage_cleanup_queue` de organizaciones borradas | Desarrollo | |
| P1 | Pasar las variables nuevas a `.env.example` (`VITE_AI_VOICE_COPILOT_ENABLED`, `VITE_DRIVE_LIBRARY_ENABLED`, `VITE_REEL_SUBTITLES_ENABLED`, `VITE_CUTOUT_*`, `AI_TEXT_EDITOR_COPILOT_*`, Drive) | Desarrollo | |
| P2 | Tiempo real en los avisos de encargos (hoy sondeo de 60 s) | Desarrollo | |

## 7. Legal y datos personales

| P | Qué falta | Quién | Notas |
| --- | --- | --- | --- |
| P0 | Que un abogado revise y rellene las páginas legales (privacidad, condiciones, cookies) | Dueño | Hoy son plantillas con huecos |
| P0 | Contrato de encargo del tratamiento con cada cliente y registro como encargado | Dueño | `docs/rgpd.md` §7 |
| P0 | DPA con Supabase, Vercel, Fly, Cloudflare, Google/OpenAI y Meta según lo que se active, y confirmar regiones UE | Dueño | |
| P1 | Decidir los plazos de conservación (marcados «a decidir») | Dueño | |
| P1 | Pedir que se vuelvan a aceptar los documentos cuando cambie su versión (hoy no bloquea el uso) | Desarrollo | |
| P2 | Exportar organizaciones muy grandes como trabajo en segundo plano; exportación RGPD de lo importado de Instagram | Desarrollo | |

## 8. Calidad y pruebas (lo que queda por cerrar)

| P | Qué falta | Quién | Notas |
| --- | --- | --- | --- |
| P0 | Ver la e2e completa en verde varias ejecuciones seguidas en CI y **entonces** quitar `continue-on-error` del trabajo `e2e` y hacerlo obligatorio | Desarrollo | Estado y números en `docs/ESTADO.md` |
| P1 | Ejecutar la e2e en un Supabase local contra el flujo nuevo del editor (guardar plantilla, exportar de verdad, ediciones) | Desarrollo | No hay Docker en el PC de desarrollo; solo CI |
| P1 | Pasar `test:db` con las dos pruebas de simultaneidad omitidas contra un Postgres real | Desarrollo | Pasaron el 16/11/2026 contra Postgres 16 |
| P2 | Quitar `continue-on-error` del trabajo `maquetacion` tras unas ejecuciones estables en Linux | Desarrollo | |

## Orden sugerido para llegar a «primer cliente de pago»

1. Dueño: Meta (aplicación), correo propio, proveedor de IA elegido, dominio, Supabase Pro y Vercel Pro, tarjeta en Fly.
2. Ambos: aplicar migraciones y desplegar funciones pendientes en staging; probar con cuentas y claves reales publicar, IA y un reel completo.
3. Dueño: revisión legal, contratos de encargo y decisión de precios; después Stripe.
4. Desarrollo: arreglos de lo que salga de esas pruebas reales y CI obligatoria.
