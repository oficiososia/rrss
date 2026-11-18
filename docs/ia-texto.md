# IA de texto: adaptadores, tareas y función `ai-generate`

Estado a 17/11/2026. **Nada de esto se ha probado contra un proveedor real**: no
hay cuentas ni claves. Todo está probado con el proveedor simulado y con
respuestas HTTP simuladas. Tampoco hay pantallas: es la parte de servidor.

| Pieza | Estado |
|---|---|
| Servicio (reservar cupo → generar → registrar), salida estructurada validada, modelo por tarea | Implementado y probado con la base de datos real y el proveedor simulado |
| Adaptadores Vertex AI (UE), Anthropic directo, Mistral, Bedrock (UE) | Implementados; **sin probar contra el servicio real** (solo HTTP simulado) |
| Tareas: texto de publicación, propuesta de perfil, comprobación de marca | Implementadas y probadas con el proveedor simulado. **La calidad de los textos no se ha medido** con ningún modelo |
| Lógica de `ai-generate` (`handler.ts`) | Probada en Node con la base de datos real |
| Arranque de `ai-generate` en Deno (`index.ts`) | Ejecutado **solo en local** (`supabase functions serve`, edge-runtime 1.74) con el proveedor simulado de pruebas locales, en la prueba de extremo a extremo de la Fase 2. **Sin desplegar** |
| Interfaz (redactar en el editor, comprobar tono, proponer perfil desde fuentes de texto, consumo de IA, cupo en Plataforma) | Probada con Supabase simulado (componentes) y de extremo a extremo en local con el proveedor simulado |

## 1. Dónde está cada cosa

```
supabase/functions/_shared/ai/
  contract.ts            contrato (ampliado: esquema de salida, material estable, propósitos)
  service.ts             reservar → generar → validar → registrar
  schema.ts              validación propia de JSON Schema y versión «para el proveedor»
  simulated-provider.ts  solo para pruebas
  text/
    config.ts            variables de entorno → adaptadores, modelos y precios
    http.ts              llamada HTTP común y traducción de errores
    prompt.ts            material delimitado y cota de consumo
    anthropic-messages.ts  formato de la API de mensajes (común a los tres de Claude)
    vertex.ts  google-auth.ts   Claude por Vertex AI (token de cuenta de servicio)
    anthropic.ts                Claude por la API directa
    bedrock.ts  sigv4.ts        Claude por Amazon Bedrock (firma SigV4)
    mistral.ts                  Mistral
    tasks/               post-copy.ts · profile-proposal.ts · brand-check.ts · shared.ts
supabase/functions/ai-generate/
  handler.ts             lógica (sin Deno, probada)
  index.ts               arranque en Deno: cliente de Supabase y variables
```

Imagen y vídeo viven en `_shared/ai/media/` y no forman parte de este documento.

## 2. Adaptadores

Todos con `fetch` puro, sin SDK. Ninguno está elegido por defecto: se elige por
configuración (apartado 3).

| Adaptador (`id`) | Punto de entrada | Autenticación | Datos en la UE |
|---|---|---|---|
| `anthropic-vertex` | `https://aiplatform.eu.rep.googleapis.com/v1/projects/{proyecto}/locations/eu/publishers/anthropic/models/{modelo}:rawPredict` | Token OAuth de una cuenta de servicio (JWT RS256 firmado con Web Crypto) | Sí con `eu` (multirregión) o una región `europe-…`. El adaptador rechaza cualquier otra ubicación |
| `anthropic` | `https://api.anthropic.com/v1/messages` | Cabecera `x-api-key` | **No**: la API directa solo admite `us` o `global`. No se carga salvo aceptación expresa |
| `mistral` | `https://api.mistral.ai/v1/chat/completions` | `Authorization: Bearer` | Empresa europea; **dónde procesa no consta** en las páginas consultadas |
| `anthropic-bedrock` | `https://bedrock-mantle.{región}.api.aws/anthropic/v1/messages` | SigV4 (servicio `bedrock-mantle`) o token de Bedrock en `x-api-key` | Sí si la región es `eu-…` y el modelo no usa el enrutado `global.`; el adaptador rechaza lo demás |

Lo que hacen todos:

- **Salida estructurada** con el mecanismo nativo (`output_config.format` en
  Claude, `response_format: json_schema` con `strict` en Mistral). Al proveedor
  se le envía el esquema sin las restricciones que no admite (`minLength`,
  `maxItems`…); el servicio valida después con el esquema completo. Un rechazo
  o un corte por longitud no cumplen el esquema: se registran con su coste y la
  petición falla con `refused` o `invalid_output`.
- **Caché de prompts**: el material estable (el perfil de marca) va primero. En
  Claude su último bloque lleva `cache_control` (5 minutos); en Mistral se envía
  `prompt_cache_key`. El prefijo guardado es «instrucciones de la tarea +
  perfil», así que la caché es por tarea, marca y modelo. Si el prefijo no llega
  al mínimo del modelo, el proveedor no lo guarda y no avisa.
- **Recuento de tokens**: el consumo real sale de la respuesta, con la caché
  separada. Antes de llamar se reserva una cota superior calculada sin red (un
  token cada 2,5 caracteres más un margen). El adaptador directo de Anthropic
  ofrece además el recuento exacto (`count_tokens`), que el servicio no usa.
- **Coste** = consumo × tabla de precios (configuración). Unidades:
  `input_tokens`, `output_tokens`, `cache_read_input_tokens` y, en Claude,
  `cache_write_input_tokens`. Sin precio completo, el servicio no genera.
- **Errores**: 429 → `rate_limited` (reintentable); 5xx y 529 → reintentable;
  401/403 → `auth`; otros 4xx → `invalid_request`; sin red → `network`; tiempo
  agotado → `timeout`; respuesta ilegible → `bad_response`. Un fallo del
  proveedor no consume cupo. Los mensajes guardados no llevan claves.
- No se envían parámetros de muestreo (`temperature`…): la versión de la API de
  Anthropic `2026-10-21` los rechaza. El razonamiento del modelo se factura como
  salida, dentro de `max_tokens`.

### Pendiente de confirmar con la primera llamada real

- **Vertex**: el ámbito OAuth (`…/auth/cloud-platform`, no figura en las páginas
  consultadas), la forma del cuerpo de los errores y qué modelos hay en la
  multirregión `eu` de la cuenta. Multirregión y regional cuestan un 10 % más
  que el punto global: ajustar la tabla de precios. Google recomienda la
  federación de identidades en vez de guardar una clave de cuenta de servicio;
  no está implementada.
- **Bedrock**: con qué identificador de modelo (o perfil de inferencia EU) se
  sirve dentro de la UE desde el punto `bedrock-mantle`. El token de Bedrock
  caduca a las 12 horas: en un servidor, usar claves de IAM.
- **Mistral**: cuerpo de los errores que no son 422, qué modelos admiten
  `strict`, duración de la caché y dónde se procesan los datos.
- **Todos**: la calidad en español, los límites de uso de cada cuenta y los
  mínimos reales para que la caché se active.

## 3. Configuración (variables de entorno de la función)

Solo nombres en `.env.example`. Son secretos de la función; nunca `VITE_`.

| Variable | Para qué |
|---|---|
| `AI_TEXT_PROVIDER`, `AI_TEXT_MODEL` | Adaptador y modelo de todas las tareas de texto |
| `AI_TEXT_POST_CAPTION_PROVIDER` / `_MODEL` | Solo para redactar publicaciones |
| `AI_TEXT_PROFILE_PROPOSAL_PROVIDER` / `_MODEL` | Solo para proponer el perfil |
| `AI_TEXT_BRAND_CHECK_PROVIDER` / `_MODEL` | Solo para la comprobación de marca |
| `AI_PRICES` | Tabla de precios en JSON |
| `AI_TIMEOUT_MS` | Tiempo máximo de la llamada (por defecto, 60 s) |
| `AI_ALLOW_NON_EU_PROCESSING` | `true` acepta procesar fuera de la UE |
| `AI_ALLOWED_ORIGIN` | Origen permitido para CORS |
| `AI_VERTEX_PROJECT_ID`, `AI_VERTEX_LOCATION`, `AI_VERTEX_SERVICE_ACCOUNT_JSON` | Vertex: proyecto, ubicación (`eu`) y el JSON de la cuenta de servicio |
| `ANTHROPIC_API_KEY` | Anthropic directo (además exige `AI_ALLOW_NON_EU_PROCESSING=true`) |
| `AI_E2E_SIMULATED_PROVIDER` | **Solo pruebas locales.** `true` usa el proveedor simulado de `text/local-test.ts`; exige además que `SUPABASE_URL` sea local (`http` y host `127.0.0.1`, `localhost` o `kong`). En otro entorno la función no arranca. Va en `supabase/functions/e2e.env` |
| `MISTRAL_API_KEY` | Mistral |
| `AI_BEDROCK_REGION` y `AI_BEDROCK_ACCESS_KEY_ID` + `AI_BEDROCK_SECRET_ACCESS_KEY` (+ `AI_BEDROCK_SESSION_TOKEN`), o `AI_BEDROCK_BEARER_TOKEN` | Bedrock |

Formato de `AI_PRICES` (un micro por token = una unidad de moneda por millón de
tokens; los números de este ejemplo son inventados):

```json
{ "anthropic-vertex/<modelo>": { "input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_write_input_tokens": 0 } }
```

Reglas:

- Sin `AI_TEXT_*` no hay IA: no existe modelo por defecto.
- Un adaptador sin sus credenciales no se carga y la tarea falla diciendo qué
  falta. **Nunca se sustituye por otro ni por el simulado**: el simulado no se
  puede elegir con `AI_TEXT_*`. La única vía es `AI_E2E_SIMULATED_PROVIDER`,
  limitada a un Supabase local.
- Los avisos de configuración van al registro del servidor con nombres de
  variables, nunca con valores. Al navegador solo llega «la IA no está
  disponible».

## 4. Tareas

Las instrucciones de cada tarea son texto fijo del producto. Todo lo que escribe
un cliente (perfil, encargo, fuentes, texto a comprobar) viaja como material
delimitado y se trata como dato.

| Tarea (`purpose`) | Entra | Sale |
|---|---|---|
| `post.caption` | Perfil de marca, encargo breve, red con sus límites (dato) y número de variantes (1–5) | Variantes con texto, etiquetas, longitud medida (en unidades UTF-16, ver abajo) y `withinLimits`. No se recortan |
| `profile.proposal` | Texto ya extraído de las fuentes (hasta 20 fuentes y 400.000 caracteres) y, si existe, el perfil actual | Una **propuesta** con la forma del perfil y notas para quien revisa. No guarda nada |
| `brand.check` | Perfil de marca y el texto | Veredicto por criterio (`tone`, `banned_topics`): `pass`, `fail` o `uncertain`, con explicación y citas. Global: `pass`, `fail` o `review` |

**Unidad de los límites de texto.** Todo el producto cuenta en unidades UTF-16:
el contador del editor, la ventana «Redactar con IA», el verificador de marca y
esta tarea. Si una red dice «caracteres» sin precisar, se toma UTF-16 porque es
la cuenta más estricta (un emoji puede contar 2): nunca se da por bueno un texto
que la red pudiera rechazar. La correspondencia está en
`src/features/content/textUnits.ts` y la vigila `textUnits.test.ts`.

En la comprobación de marca el veredicto global lo calcula el producto (fallo >
duda > visto bueno). Un `fail` sin una cita que esté en el texto se rebaja a
duda. `review` significa «que lo revise una persona». La tarea nunca aprueba una
pieza. Las reglas literales (longitud, expresiones exactas) no son de esta
tarea: van en el verificador sin IA.

## 5. Función `ai-generate`

`POST /functions/v1/ai-generate` con la sesión del usuario en `Authorization`.

```json
{ "action": "post.caption", "brandId": "<uuid>",
  "input": { "brief": "…", "network": { "id": "instagram", "name": "Instagram", "maxChars": 2200, "maxHashtags": 30, "notes": ["…"] }, "variants": 3 } }
{ "action": "brand.check", "brandId": "<uuid>", "input": { "text": "…" } }
{ "action": "profile.proposal", "brandId": "<uuid>", "input": { "sources": [{ "title": "Manual.pdf", "text": "…" }] } }
```

El perfil de marca lo lee la función con la identidad del usuario (RLS); el
navegador no lo envía.

Respuesta 200: `{ action, generationId, … }` con el resultado de la tarea
(apartado 4). No incluye proveedor, modelo ni coste: están en `ai_generations`.

Errores: `{ "error": { "code", "message", "retryable", "generationId"? } }`.

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `invalid_request` | Petición mal formada o incompleta |
| 401 | `unauthenticated` | Sin sesión o caducada |
| 402 | `quota_exhausted`, `quota_missing` | Cupo agotado o sin asignar (mensaje del cupo, sin cifras) |
| 403 | `forbidden` | No puede crear contenido en la marca |
| 404 | `brand_not_found` | La marca no existe o no la ve |
| 409 | `brand_profile_missing` | La marca no tiene perfil (salvo en `profile.proposal`) |
| 422 | `refused` | El modelo se negó (coste registrado) |
| 502 | `provider_failed`, `invalid_output` | Falló el proveedor (sin coste) o respondió algo inservible (con coste) |
| 503 | `not_configured` | IA sin configurar |
| 504 | `provider_timeout` | El proveedor no respondió a tiempo |

El permiso de crear contenido lo impone la base de datos al reservar el cupo
(`ai_reserve_generation`), antes de llamar a ningún proveedor. Una petición es
una sola llamada al proveedor: no hay bucles ni reintentos dentro de la función.

## 6. Fuera de este bloque

Pantallas; extracción de texto de PDF y webs; guardar la propuesta de perfil;
reintentos y modelo alternativo; lotes; límite de frecuencia por usuario;
valoración de resultados; búsqueda por vectores; registro de modelos en base de
datos (hoy es configuración de la función).
