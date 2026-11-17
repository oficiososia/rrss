# Imagen y vídeo generativos (Fase 2)

Código en `supabase/functions/_shared/ai/media/`. Registro de modelos en la
tabla `ai_media_models` (migración `20261117110000_ai_media_models.sql`).

**Estado, sin adornos:**

| Pieza                                     | Implementado            | Probado                                                     | Pendiente o bloqueado                                                                                   |
| ----------------------------------------- | ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Contrato de medios, servicio, cupo y cola | Sí                      | Sí, contra las migraciones reales con proveedores simulados | No hay todavía ninguna Edge Function que lo exponga ni trabajador que reclame los trabajos              |
| Registro de modelos y precios             | Sí                      | Sí (RLS, privilegios, vuelta atrás)                         | Todas las filas están inactivas: falta que el dueño elija proveedor y que alguien contraste los precios |
| Adaptadores reales (5)                    | Sí                      | **Solo con respuestas HTTP simuladas**                      | **Ninguno se ha probado contra el servicio real**: no hay cuentas ni claves                             |
| Almacenamiento de resultados              | Interfaz que se inyecta | Con un almacenamiento en memoria                            | Falta la implementación sobre Storage                                                                   |
| Pantallas                                 | No                      | —                                                           | Fuera de este bloque, a propósito                                                                       |

No se ha elegido proveedor: están preparados todos detrás del mismo contrato
para decidir después.

## 1. Adaptadores

Todos usan `fetch` puro, sin SDK, y llevan en la cabecera del archivo las
páginas de documentación oficial contra las que se escribieron (consultadas el
17/11/2026) y lo que queda por confirmar con una llamada real.

| Adaptador                            | Archivo                                | Tipo            | Entrega                                                 | Región                             | Notas                                                                                                         |
| ------------------------------------ | -------------------------------------- | --------------- | ------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `google-vertex`                      | `vertex-image.ts` (+ `google-auth.ts`) | Imagen          | Síncrona                                                | UE por defecto (multirregión `eu`) | Sin confirmar: forma de la imagen en la respuesta REST, `imageSize` y qué modelos están en la UE              |
| `bfl`                                | `bfl-image.ts`                         | Imagen (FLUX.2) | Asíncrona, por sondeo                                   | UE por defecto (`api.eu.bfl.ai`)   | Puede entrenar con las entradas salvo contrato enterprise. Sin webhook: su documentación no describe la firma |
| `ideogram`                           | `ideogram-image.ts`                    | Imagen          | Síncrona                                                | No documentada                     | El endpoint v3 figura como heredado; valores admitidos de proporción y velocidad sin listar                   |
| `higgsfield`                         | `higgsfield-video.ts`                  | Vídeo           | Asíncrona: sondeo y webhook firmado (Standard Webhooks) | No documentada                     | Puede entrenar con las entradas. Solo cobra lo completado                                                     |
| `fal`                                | `fal-video.ts`                         | Vídeo           | Asíncrona: sondeo y webhook firmado (ED25519 con JWKS)  | No garantizada                     | Con modelos de terceros el contenido pasa a ese tercero                                                       |
| `simulated-image`, `simulated-video` | `simulated.ts`                         | Ambos           | Síncrona / asíncrona                                    | —                                  | Solo pruebas. La imagen es un PNG determinista; el vídeo, un archivo de prueba no reproducible                |

Fuera de este bloque: Runway (se eligió fal.ai como segundo de vídeo porque su
cola y sus webhooks están documentados con detalle), OpenAI, Recraft,
Stability, Replicate, edición determinista (quitar fondo, reencuadrar) y voz.
Los reels montados con plantillas son del trabajador de medios, no de aquí.

## 2. Contrato (`contract.ts`)

- **Petición**: `ImageRequest` (texto, imágenes de referencia, proporción,
  tamaño) o `VideoRequest` (imagen inicial, texto, duración, proporción). Una
  generación produce un medio; cuatro propuestas son cuatro generaciones.
- **Adaptador** (`MediaProvider`): `estimateUsage` (cota superior, sin llamar a
  nadie), `start` (devuelve el resultado o el trabajo en curso), y opcionales
  `poll`, `cancel` y `parseWebhook` (comprueba la firma antes de creer nada).
- **Servicio** (`MediaService`): `estimate` (coste máximo antes de generar),
  `generate`, `processJob` (avanza un trabajo de la cola) y `handleWebhook`.
- **Almacenamiento** (`MediaStorage.put`) y **lecturas** (`MediaReader`) se
  inyectan: este módulo no escribe en Storage ni abre conexiones.
- Cada resultado dice dónde se procesó (`dataRegion`, `euProcessing`), si el
  proveedor puede entrenar con las entradas (`trainsOnInputs`) y si el
  adaptador sigue sin probar contra el servicio real (`untestedAdapter`).

## 3. Ciclo de una generación

1. Se elige el modelo del registro (ver §5) y se valida la petición.
2. `estimateUsage` × precio del registro = cota superior del coste.
3. `ai_reserve_generation` aparta esa cota. **Si no hay cupo, aquí se acaba: no
   se llama al proveedor.**
4. Se lanza en el proveedor, con tiempo máximo.
   - Falla (error, límite de uso, tiempo agotado): `ai_fail_generation`
     devuelve la reserva.
   - Síncrono: se guarda el archivo y `ai_complete_generation` cambia la
     reserva por el coste real.
   - Asíncrono: se encola un trabajo `ai.media.poll` con clave de idempotencia
     `ai-media:<generación>`. La reserva sigue contando mientras dura.
5. El trabajo lo cierra quien llegue antes:
   - **Sondeo** (`processJob`): si sigue en curso, el trabajo vuelve a la cola
     con espera creciente; si terminó, se descarga el resultado a nuestro
     almacenamiento y se registra el coste; si falló, se devuelve la reserva.
   - **Webhook** (`handleWebhook`): firma comprobada, y además el aviso debe
     ser del trabajo de esa generación.
6. **Trabajo que nunca termina**: pasado el tiempo máximo (30 min por defecto) o
   agotados los intentos de consulta, se pide al proveedor que lo cancele y se
   devuelve la reserva.

**Idempotencia.** El estado de la generación es el árbitro: un webhook
repetido, o un sondeo que llega después del webhook, encuentran la generación
cerrada y no hacen nada (ni descargan, ni cobran). `ai_complete_generation` no
apunta dos costes aunque se llame dos veces.

**Vídeo: segundos.** El consumo queda en `ai_generations.usage.seconds`; se
cobra por los segundos que el proveedor dice haber generado y, si no lo dice,
por los pedidos. El cupo sigue siendo solo de coste: un cupo en segundos exige
ampliar `usage_quotas.metric`.

**Si el archivo no se puede guardar.** En síncrono el gasto ya está hecho: se
apunta el coste sin resultado y se devuelve un error. En asíncrono se reintenta
(el proveedor conserva el archivo un tiempo).

## 4. Registro de modelos (`ai_media_models`)

Proveedor, modelo, tipo, unidad de cobro (`image`, `megapixel`, `second`),
precio en millonésimas, matices de tarifa (`price_details`: primera unidad,
recargo por megapíxel de referencia), **fecha y fuente del precio**, si está
verificado, región de datos, si el proveedor puede entrenar con las entradas,
entrega síncrona o asíncrona, ajustes del modelo (`settings`: nombres de los
campos de la petición, duraciones admitidas…), prioridad y estado.

- Lo lee cualquier usuario con sesión; lo escribe solo un superadministrador
  (y el servidor). No es dato de ningún cliente.
- **Un modelo con el precio sin verificar no se puede activar** (restricción de
  la tabla).
- Las filas sembradas nacen inactivas y son las únicas cuyo nombre de modelo
  salió de la documentación oficial:

| Modelo                                               | Precio sembrado                                                         | ¿Verificado?                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `google-vertex` · `gemini-nano-banana-2.1`           | 0,0336 por imagen                                                       | **No**: es el precio de la API de Gemini, no el de Vertex |
| `bfl` · `flux-2-pro`                                 | 0,03 el primer megapíxel, 0,015 los demás y por megapíxel de referencia | Sí (bfl.ai/pricing, 16/11/2026)                           |
| `ideogram` · `ideogram-v3` (Turbo)                   | 0,03 por imagen                                                         | Sí (ideogram.ai/pricing, 16/11/2026)                      |
| `higgsfield` · `kling-video/v3.0/std/image-to-video` | 0,112 por segundo                                                       | **No**: las dos páginas oficiales no coinciden            |

De fal.ai no se siembra nada: no se ha contrastado ningún par modelo–precio.

- Los precios están en la moneda del proveedor (USD). La conversión a la moneda
  de cuenta de la plataforma es una decisión pendiente; hoy se toman uno a uno.

## 5. Configuración del servidor

Variables de las funciones del servidor (nunca `VITE_`); los nombres están en
`.env.example`. Sin su clave un adaptador no se carga, y el error dice qué
variable falta.

| Proveedor         | Variables                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Elección          | `AI_MEDIA_IMAGE_MODEL`, `AI_MEDIA_VIDEO_MODEL` (`proveedor:modelo`), `AI_MEDIA_ALLOW_NON_EU`, `AI_MEDIA_WEBHOOK_BASE_URL`, `AI_MEDIA_SIMULATED` |
| Vertex AI         | `GOOGLE_VERTEX_PROJECT_ID`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON`, `GOOGLE_VERTEX_LOCATION` (opcional, `eu`)                                     |
| Black Forest Labs | `BFL_API_KEY`, `BFL_API_BASE_URL` (opcional, `https://api.eu.bfl.ai`)                                                                           |
| Ideogram          | `IDEOGRAM_API_KEY`                                                                                                                              |
| Higgsfield        | `HIGGSFIELD_API_KEY_ID`, `HIGGSFIELD_API_KEY_SECRET`, `HIGGSFIELD_WEBHOOK_SECRET` (opcional)                                                    |
| fal.ai            | `FAL_KEY`                                                                                                                                       |

**Criterio de datos.** Por defecto solo se eligen solos los modelos que
procesan en la UE. Los demás siguen disponibles, pero hay que fijarlos a
propósito (`AI_MEDIA_*_MODEL`) o permitirlos (`AI_MEDIA_ALLOW_NON_EU=true`), y
su resultado va marcado. La región efectiva es la del adaptador cuando depende
de su configuración: un Vertex apuntando a `global` no cuenta como UE aunque el
registro diga otra cosa.

## 6. Antes de activar un proveedor

1. Cuenta, clave y contrato de tratamiento de datos (DPA, región, no
   entrenamiento).
2. Una llamada real con cada adaptador y corregir lo que la documentación no
   dejaba claro (lista en la cabecera de cada archivo).
3. Contrastar el precio en la página oficial, anotar fecha y fuente y marcarlo
   verificado; después, activar la fila.
4. Implementar `MediaStorage` sobre Storage, la Edge Function que expone el
   servicio, la que recibe los webhooks y quien reclame `ai.media.poll`.
