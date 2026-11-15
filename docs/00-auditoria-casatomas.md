# Fase 0 · Auditoría del módulo de redes sociales de Casa Tomás

Fecha: 15/11/2026. Origen: repositorio `admin-casatomas`, leído en **solo lectura**
(no se ha modificado nada allí, ni en `web-casatomas`, ni en ningún proyecto de
Supabase o Vercel).

**Cómo se hizo.** Se leyeron enteros `docs/rrss.md` y `docs/instagram.md`, las
cabeceras y fragmentos de las piezas centrales (render, publicación, programador,
editor IA, secretos, migración `rrss`) y se recorrió el resto con búsquedas. La
madurez de cada área se deduce de la documentación y de la cantidad de tests: no
se ha ejecutado el módulo.

## 1. Tamaño

Unas 570 rutas y ~89.000 líneas (TypeScript, SQL y scripts), de las que ~24.000
son tests.

| Área | Archivos | Líneas |
|---|---|---|
| Frontend (`components/instagram`, `components/rrss`, `marketing/instagram`, `lib/instagram`, `lib/rrss`, páginas) | 262 | ~45.900 |
| API Node en Vercel (3 endpoints + `_lib`) | 37 | ~5.300 |
| Edge Functions (`instagram-*`, `rrss-ia`, `_shared`) | 79 | ~21.100 |
| SQL (18 migraciones + 18 vueltas atrás) | 36 | ~9.600 |
| Scripts (pruebas de BD y trabajador de reels) | 24 | ~6.300 |
| E2E, documentación y recursos estáticos | 129 | — |

## 2. Qué hace hoy

| Área | Qué hace | Madurez |
|---|---|---|
| Estudio | Resumen semanal y sugerencia de la IA | Alta |
| Crear | 1–10 fotos, «Montar con IA», render en servidor, publicar o programar | Alta (en rediseño) |
| Render de imagen | Plantillas HTML + Chromium → JPEG; mismo código en vista previa y servidor | Muy alta |
| Publicación en Instagram | Imagen, carrusel, reel y story por la Graph API oficial, con cerrojo e idempotencia | Muy alta |
| Calendario y programación | Programador llamado por cron cada 5 minutos | Alta |
| Campañas IA | Propone campañas de 2–4 semanas como borradores | Media (muy ligada a la carta) |
| Reels | Editor + trabajador externo en un PC de la agencia | Media (depende de esa máquina) |
| Encargos | Flujo restaurante ↔ agencia | Alta, pero específico de una agencia |
| Story de tapas | Automática al guardar las tapas, orquestada desde el navegador | Específica de Casa Tomás |
| Métricas | Captura diaria e informe mensual en PDF | Alta |
| Facebook | Solo prepara y descarga: **no publica** | Baja |
| Editor IA de fotos y vídeos | La IA devuelve un plan y un motor determinista (sharp / ffmpeg) lo aplica | Reciente, poco rodado |

## 3. Datos, permisos y tareas programadas

- **Tablas**: ~30 con prefijo `instagram_` y `rrss_` (piezas, fotos, métricas,
  programaciones, cerrojo de publicación, guías de marca, cupos de IA, campañas,
  cola de render, encargos, tapas, proyectos y generaciones del editor).
- **RPC**: ~80 (programación, cerrojos, colas, encargos, cupos).
- **Storage**: `instagram` (público), `instagram-video` (público) y `rrss` (privado).
- **Cron** (`pg_cron` + `pg_net`): métricas diarias, programador cada 5 min, limpieza.
- **Permisos**: por *sección del panel* (`marketing`), no por empresa. No existe
  el concepto de organización ni de marca como entidad: la marca es un texto con
  `check in ('casa-tomas','touza')`.

## 4. Integraciones externas

| Servicio | Uso | Observación para el SaaS |
|---|---|---|
| Meta Graph API | Publicar, leer media, estadísticas | Cliente sólido. Los tokens son **secretos de entorno**, uno por marca, de *system user*: no hay OAuth ni renovación. No escala a muchos clientes. |
| OpenAI | Montaje, textos, visión, campañas, transcripción | Llamadas directas, sin capa de proveedor. Cupos diarios en SQL. |
| Google Drive | Archivo y biblioteca de fotos | Credenciales compartidas con otra parte del panel. |
| Chromium, sharp, ffmpeg, ONNX | Render de imagen, edición de foto y vídeo | Funciona dentro de los límites del plan gratuito de Vercel. |

## 5. Cómo resuelve los trabajos largos (lo más valioso)

- **Publicación**: cerrojo antes de llamar a Meta; `media_publish` nunca se
  reintenta a ciegas (si falla, se consulta el contenedor); el identificador de
  la publicación se guarda antes que el resto.
- **Programador**: `FOR UPDATE SKIP LOCKED` con caducidad, 3 intentos y
  presupuesto de tiempo por pasada. Una reserva caducada se cierra sin republicar.
- **Editor**: índice único (una generación viva por trabajo), reserva de 6 min,
  respuesta 202 y consulta periódica. Topes diarios atómicos en SQL.

Este diseño contra duplicados está probado en producción y **es el que se
reutiliza** en el SaaS (añadiéndole el inquilino).

## 6. Acoplamiento a Casa Tomás

- Dos marcas escritas en el código, en restricciones de BD y en los nombres de
  los secretos.
- Prompts con el nombre y las reglas del restaurante.
- Plantillas `ct-*` / `tz-*`, logotipos y tipografías de la marca en el
  repositorio; colores y tipografías en un archivo de constantes.
- Lectura directa de tablas del panel: carta, vinos, tapas, turnos, novedades.
- Identificadores de proyectos de Supabase, dominio del panel y zona horaria fijos.
- Una sola cuenta de Instagram por marca; una agencia concreta con su sección.

## 7. Qué se reutiliza, qué se rehace y qué se descarta

**Reutilizar (portándolo, no copiándolo tal cual)**

- Cliente de la Graph API, clasificación de errores y saneado de secretos.
- Núcleo de publicación (imagen, carrusel, reel) y las reglas de cerrojo y
  programación.
- Motor de render isomórfico (documento → maquetación → imagen).
- Contrato «la IA propone un plan, un motor determinista lo ejecuta» y sus
  validadores.
- Lógica pura de informes y de «qué funciona».

**Rehacer**

- Identidad de marca: de constantes en el código a un *perfil de marca* en la
  base de datos, por inquilino (ya hecho en la Fase 1).
- Cuentas sociales: de secretos de entorno a cuentas en BD con OAuth y tokens
  cifrados.
- Prompts: las reglas de marca salen del perfil, no del código.
- Cola de vídeo: de un PC externo a un trabajador gestionado.
- Permisos: de secciones del panel a pertenencia a organización y marca (ya hecho).

**Descartar**

- Story de tapas, integración con la carta y biblioteca en Google Drive (lógica
  de un solo cliente; se sustituye por la biblioteca propia de cada marca).
- Encargos tal como están (se replantea como colaboración y aprobaciones).
- La pestaña de Facebook vacía y las campañas con calendario local fijo.

## 8. Deuda que no se traslada

- **Dos módulos paralelos** (`instagram/` y `rrss/`) con dos IA, dos motores y
  tres cubos: en el SaaS hay un solo estudio creativo.
- **Copias manuales** de código entre servidor y cliente mantenidas con scripts:
  se sustituye por un paquete compartido.
- **Lógica crítica en el navegador** (orquestar una publicación, escribir tablas
  directamente): pasa al servidor.
- **Secretos de cuentas en variables de entorno.**
- Funciones redefinidas en varias migraciones sucesivas y archivos de más de
  1.000 líneas.
- Recursos con derechos de terceros: los logotipos y tipografías de Casa Tomás
  **no se copian** al producto; cada marca sube los suyos.

## 9. Conclusión

El módulo demuestra que el producto es viable y aporta tres activos reales: la
publicación fiable en Instagram, el motor de render y el patrón «plan de IA +
motor determinista». Lo que no tiene es precisamente lo que define un SaaS:
inquilinos, permisos por empresa, cuentas conectadas por el propio cliente y
control de costes por cliente. Por eso el repositorio nuevo **empieza por el
núcleo multiempresa** y va portando encima las piezas valiosas, en lugar de
copiar el módulo y «generalizarlo» después.
