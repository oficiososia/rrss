# Operación y control de gasto

Rama `f32/operacion-gasto`, 22/11/2026. Migración `20261219010000_operacion_gasto.sql`
(vuelta atrás en `supabase/rollbacks/`). Estado: **implementado y probado en base de datos y en
componentes; nada probado contra Supabase, Fly o proveedores reales.**

## 1. Pantalla «Gasto y uso» (`/plataforma/gasto`, solo superadministrador)

Se llega desde Plataforma («Gasto y uso», con el número de avisos abiertos). Reutiliza lo que ya
existía (`ai_usage`, `ai_generations`, `usage_quotas`, `jobs`, `media_assets`, `org_plan`) y añade
solo funciones de lectura:

| Bloque | Origen | Notas |
| --- | --- | --- |
| Tope global del mes | `platform_ai_global_status()` | Estado del tope de §2 |
| Avisos | `platform_alerts` | §3 |
| IA por organización y tipo | `platform_usage_overview(mes)` | Coste real (`ai_generations` con éxito) por texto (texto, visión, embeddings), imagen, vídeo y transcripción; cupo comprometido (coste + reservas vivas) frente al cupo vigente |
| Precios de IA | `platform_price_review(mes)` | §4 |
| Trabajador de medios | `platform_usage_overview(mes)` | Trabajos, hechos, fallidos, en curso y **segundos de máquina estimados** = suma de los valores numéricos de `jobs.result.timings` (`downloadMs`, `renderMs`, `uploadMs`, `inferenceMs`…) de los trabajos hechos del mes. Los hechos sin tiempos (p. ej. `media.image.process`) no cuentan y la pantalla dice cuántos son. Es tiempo de proceso, **no** la factura de Fly (arranque y espera no entran) |
| Almacenamiento | `org_storage_bytes` y `platform_storage_by_brand()` | Por organización frente al límite del plan y por marca (biblioteca + fuentes; bytes en R2 aparte) |
| Trabajos de medios por marca | `platform_storage_by_brand()` | Este mes frente al tope (§5) |

«Cupo consumido» es lo mismo que enseña a cada organización «Ajustes → Consumo de IA» y
«Ajustes → Plan» (ya existían). Lo nuevo en la organización: aviso al pasar del 80 % del cupo
(en las dos pantallas) y el mensaje de IA en pausa (§2).

Marcas de la pantalla (no cambian ningún cupo ni plan; eso lo decide el dueño):

- **Cupo puesto a mano**: la organización tiene una fila en `usage_quotas` que sustituye al cupo
  de su plan (no tiene techo propio salvo el que pongas).
- **Plan sin límites**: el plan no limita marcas, personas o almacenamiento (Heredado, Enterprise).

## 2. Tope global mensual de IA

- Ajuste `AI_GLOBAL_MONTHLY_CAP` (Plataforma → Integraciones → IA de texto → «Tope global de gasto
  mensual»), en la moneda de cuenta y con punto decimal (`50`, `50.5`). Sin valor = sin tope.
  `0` = IA de pago apagada. Un valor mal escrito no cuenta como tope.
- Lo impone la base de datos en `ai_reserve_generation` (error `AI003`): reserva + lo ya
  comprometido por **todas** las organizaciones no puede pasar el tope. Con tope, las reservas se
  serializan con un bloqueo de aviso (después del de la suscripción: sin interbloqueos). Las
  reservas caducadas que nadie cerró no cuentan.
- Cubre todo lo que pasa por el cupo: texto (también el copiloto por voz), imagen, vídeo,
  transcripción. **No** afecta a lo que no cuesta: editar, plantillas, publicar, el recorte en el
  navegador, los reels por plantilla (que no son IA) ni el dictado del navegador.
- Las funciones lo traducen al código `ai_paused` (HTTP 503) con un mensaje claro; la interfaz
  muestra «La IA de pago está en pausa» y recuerda que se puede seguir a mano. «Animar una foto»
  dice `ai_paused` en su disponibilidad.
- Es una cifra de la plataforma, **no sustituye** al límite de gasto del panel de cada proveedor
  (`docs/costes.md` §5.3).

## 3. Avisos de plataforma

Tabla `platform_alerts` (solo la lee el superadministrador; solo se escribe por funciones). La
tarea `rrss-platform-alerts` (pg_cron, cada 10 min) ejecuta `private.platform_alerts_scan()`; la
pantalla tiene «Revisar ahora» (`platform_alerts_refresh()`) y «Visto» (`platform_alert_resolve`).
Un aviso se identifica por motivo y periodo: repetir la revisión no lo duplica; uno visto no
reaparece salvo que el hecho se repita después (fallos), y los de situación continua (cupos) no
reaparecen en el mismo mes.

| Aviso | Cuándo |
| --- | --- |
| `ai_quota_80` / `ai_quota_100` | Una organización pasa del 80 % o llega al 100 % de su cupo del mes (cupo a mano o del plan; sin cupo no avisa) |
| `ai_global_cap_80` / `ai_global_cap_reached` | El gasto de todas las organizaciones pasa del 80 % o llega al tope global |
| `media_jobs_failing` | 3 o más trabajos de medios fallidos en 24 h en una organización (uno por organización y día) |
| `media_jobs_cap_reached` | Una marca llega a su tope mensual de trabajos (§5) |
| `scheduled_job_failed` | Una tarea `rrss-*` de pg_cron tiene ejecuciones fallidas en la última hora (lee `cron.job_run_details`) |
| `scheduled_http_failed` | Alguna llamada de pg_net a una función (respuesta ≥ 400, tiempo agotado o error) en la última hora (lee `net._http_response`; no distingue qué función) |
| `worker_machine_long` | La máquina de Fly lleva encendida más de 3 h (§6) |

**Vía de avisos.** No existe un canal general de avisos (el único, `request_notifications`, es de
encargos y por marca; no se ha reutilizado) y no hay correo propio (SMTP bloqueado). Por eso los
avisos viven en la plataforma y no salen a ningún sitio. Un canal hacia fuera (correo o Telegram)
queda pendiente. El aviso para quien administra la organización es el de las pantallas de plan y
consumo (80 % y agotado).

Limitación honesta: las dos últimas comprobaciones de tareas programadas dependen de `pg_cron` y
`pg_net` y de que estas tablas existan; en pruebas se imitan con tablas de la misma forma. **Sin
probar con Supabase real.** Las funciones que devuelven 200 pero hacen mal su trabajo no se ven.

## 4. Precios de IA sin verificar

`platform_price_review(mes)` clasifica cada modelo usado en el mes: `verified` (imagen/vídeo con
`price_verified` en `ai_media_models`), `unverified`, `unknown` (no está en el registro),
`simulated` (proveedor simulado), `unconfirmed` (texto o transcripción con precio en `AI_PRICES`:
el sistema **no guarda si se contrastó con la factura**) y `no_price`. La pantalla avisa de que el
cupo solo protege si el precio es real.

## 5. Tope mensual de trabajos de medios por marca

- Ajuste `MEDIA_JOBS_MONTHLY_PER_BRAND` (Integraciones → Trabajador de medios). Por defecto **400**
  (una cifra de partida, no medida); `0` = sin tope. Es por marca, no por plan: no se han tocado los
  planes ni sus cupos.
- Lo impone `request_media_job` (reels, recortes e imagen del trabajador; no cuentan los
  cancelados): al llegar, falla con «Esta marca ha llegado a su tope mensual de N trabajos de
  medios… Se renueva el día 1 del mes que viene…». Se suma al máximo de 5 a la vez que ya existía.
- El recorte en la función de Vercel (`api/cutout-mask`) tiene sus propios topes (60 por persona y
  día, 600 por marca y mes) y no entra aquí.

## 6. Máquina de Fly encendida demasiado tiempo

La función `platform-integrations` tiene la acción `worker_check` (superadministrador): consulta la
API de máquinas de Fly con el token, la app y la máquina de Integraciones (solo lectura), lee el
último evento `start` y, si lleva encendida más de 3 h (`WORKER_MAX_UPTIME_HOURS`), deja el aviso
`worker_machine_long` (uno por día). La pantalla la lanza con «Comprobar la máquina de Fly».

**No hay comprobación periódica automática**: la función exige la sesión de una persona y no hay
una tarea que la llame. Para tenerla sin tocar nada más, configura una alerta en Fly (métricas de
la app: máquina `started` más de 3 h) o añade después una tarea de pg_cron con un camino de clave
de servicio. Queda anotado en `docs/PENDIENTES.md`.

## 7. Limpieza de `storage_cleanup_queue`

El cliente solo ve las anotaciones de marcas que aún existen, así que las de marcas u
organizaciones borradas se acumulaban. Ahora `media-storage/purge-cleanup` (solo clave de servicio)
pide a `storage_cleanup_orphans()` las de más de 1 h cuya marca ya no existe, borra los archivos
(Supabase Storage y R2), y olvida las rutas borradas; las que fallan se reintentan. La tarea
`rrss-storage-cleanup` (pg_cron + pg_net, cada hora, al minuto 23) la dispara si hay algo que barrer.
Necesita los secretos de Vault `rrss_project_url` y `rrss_service_role_key`.

## 8. Legal: volver a aceptar al cambiar la versión

`LegalGate` envuelve las rutas con sesión. Si la versión vigente de las condiciones o de la
política (`LEGAL_VERSIONS` en `src/features/legal/legal.ts`) no consta como aceptada, bloquea la
interfaz con un aviso que dice qué documento cambió, enlaza a los textos y pide marcar la casilla;
«Aceptar y continuar» llama a `accept_legal_documents`, que registra la aceptación con la hora del
servidor (`legal_acceptances`, origen `app`). Deja pasar «Mi cuenta» (descargar o borrar los datos
sin aceptar) y cerrar sesión. Quien nunca aceptó también queda bloqueado. Si no se puede leer el
registro, no bloquea. **Es un bloqueo de la interfaz**: la base de datos no impide usar la API a
quien no ha aceptado. Para volver a pedir la aceptación a todos, basta subir la versión en `legal.ts`.

## 9. Copiloto por voz: aviso previo

Antes del primer dictado el copiloto enseña un aviso (el servicio de voz del navegador, no la
aplicación, procesa el audio: Google o Microsoft según el navegador; aquí solo llega el texto) con
enlace a la política y «No volver a mostrar» (en `localStorage`, clave `rrss.voiceNoticeHidden`).
Hasta pulsar «Entendido, empezar a dictar» no se escucha. La e2e 19 pasa por el aviso.

## Variables y ajustes

Ninguna variable `VITE_` nueva. Los dos ajustes nuevos se ponen en Plataforma → Integraciones (o
como secretos de las funciones con el mismo nombre). Para `.env.example` (no se ha tocado):

```
# Opcional, ajustes de Integraciones que también valen como variable de las funciones:
# AI_GLOBAL_MONTHLY_CAP=50
# MEDIA_JOBS_MONTHLY_PER_BRAND=400
```

## Para desplegar

- Migración `20261219010000_operacion_gasto.sql` (staging primero).
- Funciones: `ai-generate`, `ai-media`, `ai-transcribe` (código `ai_paused`), `media-storage`
  (`purge-cleanup`) y `platform-integrations` (`worker_check` y los dos ajustes nuevos).
- Aplicación web (pantalla, aviso legal, aviso de voz).

## No probado

- Nada contra Supabase, Fly o proveedores reales; `pg_cron` y `pg_net` no existen en las pruebas
  (se imitan sus tablas).
- La e2e completa (sin Docker en el PC de desarrollo): la 19 se ha actualizado, no ejecutado.
  `LegalGate` bloquea a quien no tenga aceptaciones; las e2e registran por la interfaz (con la
  casilla), pero las cuentas creadas por otros caminos quedarían bloqueadas.
- El valor por defecto de 400 trabajos al mes por marca es una suposición.
