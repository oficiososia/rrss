# Integraciones sencillas: dos niveles, precios al día y sugerencias de modelo (22/11/2026)

Rama `f33/integraciones-sencillas`. Migración `20261222010000_precios_y_coste_real.sql` (vuelta
atrás en `supabase/rollbacks/`). Origen: la queja del dueño sobre la pestaña «IA de texto»
(«esto es muy complicado, hay demasiadas cosas») y sus dos peticiones siguientes (ver los
precios de OpenAI y Claude al día; que la pantalla sugiera qué modelo usar para cada cosa).

## 1. Qué cambia

**Antes.** Una pestaña por integración técnica (`ai_text`, `ai_image`, `meta`…), cada una con todos
sus ajustes a la vista: proveedor y modelo por defecto, excepciones por tarea, credenciales de
cada proveedor, tabla de precios, nombres de variable (`AI_TEXT_PROVIDER`…) y la etiqueta «En la
variable de entorno del servidor». OpenAI estaba partido entre «IA de texto» y «IA de imagen».

**Ahora.** Dos niveles.

1. **Vista sencilla (por defecto).** Arriba, «Qué funciona ahora» (8 funciones en lenguaje llano con
   su estado). Después, una tarjeta por servicio con nombre llano y una frase de para qué sirve,
   el estado en una palabra con color (Funciona, Sin probar, No funciona, Falta la clave, Falta
   algo con el qué, Sin configurar si es opcional), el campo o campos imprescindibles, «Guardar»,
   «Probar conexión» (el resultado en una frase) y «Con esto se enciende», que lista qué
   funciones quedan activas y cuáles no y por qué.
2. **«Opciones avanzadas»**, plegado dentro de cada tarjeta: todo lo que había (proveedor y
   modelo por tarea, precios, región, nombres de variable, lo que viene del servidor). Se guarda
   con su propio «Guardar». No se ha quitado ninguna capacidad: una prueba comprueba que cada
   ajuste del catálogo está en exactamente una tarjeta, o a la vista, o en avanzadas.

### Las tarjetas

| Tarjeta | A la vista | Avanzadas |
| --- | --- | --- |
| **OpenAI** (una sola, aunque sus ajustes sigan siendo de `ai_text` y `ai_image`) | La clave | Modelo y proveedor por defecto y por tarea, precios, región (`OPENAI_BASE_URL`), organización y proyecto, modelo de transcripción, tiempo máximo, tope global de gasto, modelo de imagen fijo, permiso fuera de la UE |
| **Claude (Anthropic / Google Cloud)**, opcional | Proyecto, región y cuenta de servicio de Google (Vertex) | Clave directa de Anthropic, Mistral, Bedrock |
| **Instagram (Meta)** | App ID, App Secret, dirección de la aplicación y «Generar clave» de cifrado | `config_id`, versión de la Graph API, clave con la que se cifra lo nuevo |
| **Almacenamiento (Cloudflare R2)**, opcional | Account ID, cubo, Access Key ID, Secret Access Key | Jurisdicción, dónde se guardan las subidas nuevas |
| **Máquina de vídeo (Fly.io)** | Token de Fly, app, máquina, «Generar token» del trabajador | Tope mensual de trabajos por marca |
| **fal.ai — animar fotos**, opcional | La clave (y, si falta, un botón «Permitir fuera de la UE») | — |
| **Google Drive**, opcional | ID y secreto de cliente | Dirección de la aplicación |
| **Pagos (Stripe)** | Clave secreta, secreto del webhook, dirección | — |
| **ComfyUI propio**, opcional | Dirección y token | Región de los datos |
| **Otras imágenes con IA**, opcional | Clave de Black Forest Labs | Servidor de BFL, Ideogram, Google Vertex (imagen) |

«Qué enseña este despliegue» (interruptores de compilación) y «Actividad» pasan a un bloque
«Opciones avanzadas» al final de la página, con su jerga.

### El estado en una palabra

Honesto: **Funciona** solo si lo imprescindible está puesto y la última «Probar conexión» salió
bien; si no se ha probado, **Sin probar**; si la prueba falló, **No funciona** y dice por qué.
**Falta la clave** / **Falta algo: …** salen de lo que falta de verdad (con nombres llanos).
La prueba de «IA de texto» es de todos los proveedores: a la tarjeta de Claude solo le cuenta si
alguna tarea usa Claude.

## 2. Valores por defecto al guardar la clave de OpenAI

Al guardar `OPENAI_API_KEY` desde la vista sencilla, la pantalla pide al servidor
(`platform-integrations`, acción `ai_apply`, alcance `defaults`) que **rellene lo que falte, sin
pisar nada ya elegido**:

- **Región**: `OPENAI_BASE_URL=https://eu.api.openai.com` (los datos se quedan en la UE) salvo que
  ya se admitiera tratar fuera de la UE.
- **Texto**: `AI_TEXT_PROVIDER=openai`, `AI_TEXT_MODEL` = el modelo barato (el del copiloto) y, por
  tarea, el modelo mejor para redactar donde la sugerencia sea otra. Si ya hay un modelo de texto
  elegido (aunque sea de otro proveedor) no se toca.
- **Precios** de esos modelos en `AI_PRICES` (con el 10 % de recargo si es el servidor europeo).
- **Imagen**: activa en el registro de modelos los de OpenAI sembrados (`gpt-image-2.5-flare` y
  `gpt-image-2.5-sunburst`, que la migración `20261202010000` deja apagados). **Deshacer no los
  apaga**: se desactivan en el registro de modelos.
- **Transcripción**: `gpt-transcribe` ya es el modelo por defecto del código y su precio también.

La respuesta trae `previous` (lo que había antes de cada ajuste) y «Deshacer» vuelve a guardarlo
(o borra el ajuste si no había nada). «Usar la configuración recomendada» (alcance `all`) hace lo
mismo pero **sustituye** los modelos y los precios.

Si la clave se guarda pero no se pueden aplicar los valores (por ejemplo, la fuente de precios no
responde), la clave queda guardada y se dice qué hacer.

## 3. La región

Con el servidor europeo y una clave que no es de un proyecto con región Europa, OpenAI responde
con un error. «Probar conexión» lo dice en claro («OpenAI no acepta esta clave en su servidor
europeo…») y ofrece **Usar el servidor general de OpenAI**, con el aviso de que los datos se
tratarían fuera de la UE. Un clic (acción `openai_region`) guarda `OPENAI_BASE_URL=https://api.openai.com`,
`AI_ALLOW_NON_EU_PROCESSING=true` y `AI_MEDIA_ALLOW_NON_EU=true`, **recalcula sin el 10 %** los precios
que coincidían con la fuente, vuelve a probar y deja «Deshacer». Mientras se use el servidor
general, la tarjeta lo recuerda y ofrece «Volver al servidor europeo».
Ojo: el permiso de fuera de la UE es global (afecta también a otros proveedores de imagen y a
fal.ai); al volver al servidor europeo **no se retira**, porque otros servicios pueden depender de él.

### «Probar conexión» de la IA de texto genera de verdad (22/11/2026, rama `f37/copiloto-herramientas`)

**Antes.** La prueba de la IA de texto solo hacía la comprobación gratuita de cada proveedor
(listar modelos en Anthropic, Mistral, OpenAI y Bedrock; pedir un token en Vertex). El 22/11/2026
dio «Funciona» con una clave de OpenAI que `eu.api.openai.com` aceptaba en `GET /v1/models` y
rechazaba con un 401 al generar: la pantalla decía que funcionaba y el copiloto fallaba.

**Ahora.** Si la comprobación gratuita de un proveedor va bien, la prueba hace además **una
generación mínima real por cada par proveedor/modelo distinto** que usan las tareas de texto (como
mucho seis, que son las tareas; las que comparten modelo no repiten), en paralelo:

- Con **el mismo adaptador que usará la tarea** (`provider.generate` de
  `_shared/ai/text/*`): misma dirección (en OpenAI, la de `OPENAI_BASE_URL`, que es lo que
  fallaba), mismas cabeceras y misma autenticación (token de Google en Vertex, firma SigV4 o token
  en Bedrock). No hay una segunda forma de construir la petición.
- Petición: la palabra «Hola» y **1 token de salida** (`max_completion_tokens: 1` en OpenAI;
  `max_tokens: 1` en Anthropic, Vertex, Bedrock y Mistral). En OpenAI se envía además
  `reasoning_effort: "none"` (en los modelos que razonan el tope incluye el razonamiento); si el
  modelo responde 400 nombrando ese parámetro, **se reintenta una vez sin él**. Las tareas no
  envían `reasoning_effort`: el adaptador solo lo pasa si se le pide en `params`.
- Cada generación es un elemento de `checks` («Generar con `<proveedor>/<modelo>`») y hay uno más,
  «Coste de la prueba», que dice cuántas se han hecho.
- **Mensajes** (nunca citan la clave ni cabeceras; en los 401/403 no se copia el texto del
  proveedor, que puede llevar parte de la clave):
  - 401/403 al generar: «La clave lista modelos, pero el servidor europeo de OpenAI
    (eu.api.openai.com) la rechaza al generar con «…» (401): revisa que la clave sea de un proyecto
    con región Europa y, si es una clave restringida, que tenga permiso para generar…», y ofrece el
    mismo arreglo de un clic (**Usar el servidor general de OpenAI**). Con el servidor general y
    con los demás proveedores, el mensaje equivalente sin ese arreglo.
  - 404 (o un error de «modelo no encontrado»): «… no encuentra el modelo «…» (404): revisa el
    nombre del modelo elegido para la tarea…».
  - Otro 400, 429, sin red o sin respuesta: el motivo que da el adaptador (ya sin secretos) y una
    pista («suele ser el nombre del modelo o un parámetro…», «falta de saldo o un límite…»).
  - Un 400 de OpenAI que dice que se alcanzó el tope de salida cuenta como que genera (clave,
    dirección y modelo valen; el modelo razonó antes de contestar).
- Si la comprobación gratuita ya falla (clave rechazada al listar), **no se intenta generar**.
- **Coste.** Unos pocos tokens de entrada y uno de salida por modelo: despreciable, pero **no
  cero**. Se dice junto al botón de las tarjetas de OpenAI y de Claude («Probar conexión hace una
  generación mínima real (1 token de salida) por cada modelo configurado: coste despreciable, pero
  no cero.») y en el resultado. **No pasa por el cupo de ninguna organización** ni queda en
  `ai_generations`: es una prueba de plataforma de un superadministrador y no usa `AiService`.
- Las demás integraciones siguen igual: su prueba no genera ni gasta nada.

**Sin probar contra ningún proveedor real**: solo con respuestas HTTP simuladas. En particular,
no está confirmado con el servicio que todos los modelos de OpenAI acepten `max_completion_tokens: 1`
ni la forma exacta del 400 de `reasoning_effort` (se reconoce por `error.param` o porque el mensaje
lo nombra).

## 4. Precios al día

### De dónde salen (investigado el 22/11/2026)

Ni OpenAI ni Anthropic publican una API oficial de tarifas. Candidatos mirados hoy:

| Fuente | Qué trae | Pega |
| --- | --- | --- |
| **LiteLLM** (`BerriAI/litellm`, `model_prices_and_context_window.json`) — **elegida** | Para los dos proveedores: texto por token con caché (lectura y escritura), transcripción por segundo e imagen por token de imagen. Cada entrada de OpenAI cita su página oficial (`source`) | Mantenido por la comunidad: puede tardar en reflejar un cambio. ~5 MB |
| OpenRouter (`/api/v1/models`) | Texto por token (con caché) de `openai/*` y `anthropic/*`; ~0,9 MB, API estable | Sin transcripción ni imagen por token de imagen; el listado de OpenRouter no es la tarifa del proveedor |
| Páginas oficiales de precios | La tarifa de verdad | Solo HTML, sin formato para máquinas |

Se contrastaron `gpt-6-luna`, `gpt-6.1-terra`, `claude-haiku-5-5` y `claude-sonnet-5-5` entre
LiteLLM y OpenRouter y **coinciden** (y con `docs/modelos-ia-comparativa.md`). Por eso se eligió LiteLLM:
es la única que cubre también transcripción e imagen. Cambiar de fuente toca solo
`supabase/functions/_shared/integrations/pricing.ts`.

### Cómo se lee

- **Solo el servidor** (la función `platform-integrations`, acción `ai_overview`); el navegador
  nunca llama a la fuente. Ninguna prueba llama a la fuente real.
- **Caché de 12 h** guardada en el ajuste `AI_PRICE_SNAPSHOT` (migración `20261222010000`): solo los
  modelos que se usan (unos 20), con la fecha de lectura. **«Actualizar»** salta la caché pero no
  lee más de una vez cada 10 minutos.
- **Si la fuente falla**, se usa la última lectura guardada y se dice («se usan los últimos precios
  guardados»); si no hay ninguna, se dice y no se inventa nada.
- La pantalla lo enseña siempre así: «Precios de LiteLLM, actualizados el …; no es la tarifa
  oficial de tu cuenta», con enlace a la tarifa oficial.
- Los precios cargados en la aplicación llevan el **10 % por procesar en la UE** (OpenAI con el
  servidor europeo; Claude por Vertex o Bedrock). Es el criterio de `docs/modelos-ia-comparativa.md`.

### Comparar y usar

Por cada modelo que usamos: precio al día (entrada y salida por millón de tokens; transcripción en
céntimos por minuto) frente al cargado. Si difiere: aviso y **«Usar estos precios»** (acción
`ai_apply`, alcance `prices`: solo toca `AI_PRICES`, mantiene lo demás y se puede deshacer).
Para Claude (`anthropic-vertex/<modelo>`) incluye el precio de escribir en caché.
**Imagen**: la fuente da el precio por token de imagen, no por imagen; la pantalla lo dice y **no
calcula un precio por imagen** (el gasto real sale abajo o en el panel del proveedor).

## 5. Sugerencias de modelo por tarea

Un **único archivo de datos**: `supabase/functions/_shared/integrations/recommendations.ts`. Para
cada tarea (copiloto, pies de foto, perfil de marca, revisión de marca, campañas, analítica,
crear imagen, editar foto, subtítulos) lista los candidatos por proveedor en orden de preferencia,
con una frase de por qué y qué se ha medido. Los **precios no están en ese archivo**: salen de la
lectura al día. Origen: `docs/modelos-ia-comparativa.md`.

- La pantalla propone **el primero que existe en la lista de modelos de la cuenta** de OpenAI
  (gratis, la misma que «Probar conexión») y tiene precio; si no, el siguiente, y dice cuál se
  saltó. Si no se puede mirar la cuenta, lo dice y propone sin comprobar.
- Cada tarea enseña «Recomendado: X · ≈ N céntimos por uso» y el modelo que usa hoy; cambiarlo se
  hace en «Opciones avanzadas» (la excepción por tarea de siempre).
- **Calidad: solo lo medido.** Lo único medido con nuestros casos es el copiloto con Claude
  (12 de 12, `docs/copiloto-voz.md` §8). Todo lo demás sale como «sin medir con nuestros casos».
- **Coste por uso y mensual**: son **estimaciones con supuestos de consumo** (tokens de entrada y
  salida por uso y usos al mes, en el mismo archivo): copiloto y pies, de `docs/modelos-ia-comparativa.md` §2;
  perfil, revisión, campañas y analítica, **supuestos propios** (marcados). El mensual (5-10 marcas)
  no cuenta las imágenes.
- **Claude** sale como segunda tarjeta, opcional: sugerencia, precio y «Usar estos precios», sin que
  haga falta configurarlo. Su «configuración recomendada» no existe (solo precios).

## 6. «Lo que cuesta de verdad»

`platform_cost_per_operation(mes)` (solo superadministradores) suma el coste **liquidado** de
`ai_generations` (el mismo que cuenta el cupo) por tarea, propósito y modelo, sin proveedores
simulados, con el nº de operaciones y los segundos de audio. La pantalla enseña el coste medio por
orden del copiloto, por pie de foto, por imagen y por minuto transcrito del mes en curso. **Es el
coste con los precios que tiene cargados la aplicación**: la factura del proveedor manda.

### Gasto real desde el proveedor (documentado, sin implementar)

Verificado en la documentación oficial el 22/11/2026:

- **OpenAI**: API de uso y costes de la organización (`GET /v1/organization/costs` y
  `/v1/organization/usage/*`), con una **clave de administración** (`Authorization: Bearer
  $OPENAI_ADMIN_KEY`, distinta de la clave normal de la API).
- **Anthropic**: Usage and Cost Admin API (`GET /v1/organizations/cost_report` es la antigua; la
  documentación remite a `GET /v1/organizations/analytics/cost` para integraciones nuevas), solo
  para **organizaciones** y con clave de administración (no sirve una cuenta individual). Solo
  cubre Anthropic directo, no Claude por Vertex o Bedrock (ahí, la factura de Google o AWS).

No se ha implementado porque no se puede probar sin una clave de administración real y era
opcional. Si se hace: un ajuste secreto nuevo por proveedor (migración), una acción en
`platform-integrations` que lea el mes y lo compare con `platform_cost_per_operation`, y la clave
en «Opciones avanzadas».

## 7. Pruebas

- `tests/db/integraciones-ia.test.ts`: la fuente (extracción, caché de 12 h, último valor si falla,
  «Actualizar»), la lógica de valores por defecto y de «usar la configuración recomendada» (modelo
  siguiente si la cuenta no tiene el recomendado, sin pisar lo elegido, con y sin recargo de la UE,
  Claude solo precios), «Probar conexión» y la región, y la función con la base de datos real
  (permisos, guardar/deshacer, cambio de servidor con precios ajustados) y `platform_cost_per_operation`.
  **Fuentes y proveedores simulados: ninguna llamada de pago ni de red.**
- `tests/db/integraciones.test.ts`, «Probar conexión de la IA de texto: generación mínima real»:
  listar 200 y generar 401 en `eu.api.openai.com` (no funciona, lo explica y ofrece el servidor
  general), todo bien (con el elemento de generación y el de coste), modelo inexistente (404), el
  reintento sin `reasoning_effort`, que la petición va a la dirección configurada con las cabeceras
  del adaptador y pide 1 token, una sola generación por par proveedor/modelo, que no se genera si
  la clave ya falla al listar, y Mistral, Anthropic, Bedrock y Vertex con sus direcciones.
  **Proveedores simulados.**
- `src/features/platform/integrations/integraciones.test.tsx` (también: el aviso de coste junto al
  botón en las tarjetas de OpenAI y Claude, y el detalle del resultado) y `services.test.ts`: la vista
  sencilla (una tarjeta por servicio, una sola clave a la vista en OpenAI, nada de nombres de
  variable fuera de avanzadas), el resumen, los estados, los valores por defecto al guardar la
  clave, el cambio de servidor, los precios y el coste real.
- e2e `18-integraciones` y `21-almacenamiento-r2` adaptadas (corren en CI).
