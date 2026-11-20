# Almacenamiento de medios en Cloudflare R2

Fotos, vídeos y exportaciones de la biblioteca en un cubo de Cloudflare R2 (API S3),
con Supabase Storage como respaldo y para las pruebas. Los metadatos siguen en
Postgres (`media_assets`) y la autorización la sigue dando la RLS.

Estado a 20/11/2026 (rama `f5/almacenamiento-r2`):

| Qué                                                                                                                                                                            | Estado                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Valoración (este documento, §1)                                                                                                                                                | Hecha: **sí, con condiciones**                                                                                                      |
| Base de datos: integración `r2`, `media_assets.storage_backend`, `private.media_object_locations`, cola de limpieza con almacén (migración `20261124010000`, con vuelta atrás) | Implementado y probado (PGlite, migraciones reales; casos en `tests/db/aislamiento.test.ts` y `tests/db/almacenamiento-r2.test.ts`) |
| Adaptador S3 (firma SigV4 propia, sin SDK) y adaptador de Supabase Storage detrás de la misma interfaz (`_shared/storage/`)                                                    | Implementado; probado contra un S3 simulado en memoria y, en la e2e, contra **MinIO**                                               |
| Edge Function `media-storage` (firmar lectura, firmar subida, borrar)                                                                                                          | Probada con S3 simulado y MinIO                                                                                                     |
| Plataforma → Integraciones → Cloudflare R2, con «Probar conexión» (HeadBucket)                                                                                                 | Implementado; probado con MinIO                                                                                                     |
| Navegador (biblioteca, editor, exportación), trabajador de medios, imágenes con IA, publicación en Instagram, borrado de organización                                          | Leen y escriben según el almacén de cada recurso                                                                                    |
| Script de migración `scripts/migrar-a-r2.ts`                                                                                                                                   | Escrito; **ejecutado solo en seco** (recuento en §4)                                                                                |
| Prueba e2e `tests/e2e/21-almacenamiento-r2.spec.ts` (configura y prueba R2, sube, ve, exporta y borra con MinIO)                                                               | Ver `docs/ESTADO.md`                                                                                                                |
| Contra Cloudflare R2 real                                                                                                                                                      | **Sin probar**: falta la cuenta (pasos del dueño en §5)                                                                             |

## 1. Valoración

### 1.1 Volúmenes

| Origen                                                         | Archivos | Tamaño                                       |
| -------------------------------------------------------------- | -------- | -------------------------------------------- |
| `brand-media` de staging (leído el 20/11/2026)                 | 34       | 13,5 MB                                      |
| Drive, inventario: fotos «incluidas»                           | 501      | 980 MB (muchas en HEIC; se copiaría su JPEG) |
| Drive, inventario: vídeos «incluidos»                          | 46       | 2,1 GB                                       |
| JPEG convertidos de HEIC (126 ya en Drive + 245 solo en local) | 371      | ≈ 0,87 GB                                    |
| **Total a llevar a R2** (sin duplicar HEIC y su JPEG)          | ≈ 920    | **≈ 3,1 GB**                                 |

Lo excluido del inventario (facturas, libreta de reservas, recetas internas,
duplicados, «personal, pedir permiso») **no se copia** por defecto.

### 1.2 Costes (precios oficiales consultados el 20/11/2026)

|                               | Almacenamiento                                                                                               | Salida (lo que se descarga)                                                                                                        | Con ≈ 3,1 GB | Con 50 GB                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------- |
| **Cloudflare R2** (estándar)  | 10 GB/mes gratis; después 0,015 $/GB-mes                                                                     | **Gratis siempre**                                                                                                                 | **0 $**      | ≈ 0,60 $/mes                                          |
| R2: operaciones               | Clase A (subir, listar) 1 M/mes gratis, luego 4,50 $/M; Clase B (leer, HEAD) 10 M/mes gratis, luego 0,36 $/M | —                                                                                                                                  | 0 $          | 0 $ (muy por debajo)                                  |
| **Supabase Free** (staging)   | 1 GB                                                                                                         | 5 GB/mes (y 50 MB por archivo)                                                                                                     | **No cabe**  | No cabe                                               |
| **Supabase Pro**              | 25 $/mes con 100 GB; luego 0,0213 $/GB                                                                       | 250 GB incluidos; luego 0,09 $/GB                                                                                                  | 25 $/mes     | 25 $/mes (+ 0,09 $/GB de salida por encima de 250 GB) |
| **Google Drive** (Google One) | 15 GB gratis por cuenta; 100 GB a 1,99 €/mes                                                                 | Drive no es un CDN: en rrss las imágenes de Drive **pasan por la Edge Function `drive-media`**, que cuenta como salida de Supabase | 0 €          | 1,99 €/mes, pero la salida sigue siendo de Supabase   |

Fuentes: [R2 pricing](https://developers.cloudflare.com/r2/pricing/) (página
modificada el 30/10/2026), [Supabase pricing](https://supabase.com/pricing) y
[Google One](https://one.google.com/about/plans), consultadas el 20/11/2026.

Lo que importa no es el espacio sino la **salida**: un reel de 50 MB visto 100
veces en el editor ya son 5 GB, todo el cupo mensual del plan gratuito. Con R2 los
bytes van del cubo al navegador (o a Instagram, o al trabajador) **sin pasar por
Supabase** y la salida no se cobra. Drive no lo resuelve: su contenido se sirve a
través de una Edge Function.

### 1.3 Región UE y RGPD

- El cubo se crea con **jurisdicción UE** (`eu`): los objetos se guardan y procesan
  en la UE y solo se llega a ellos por `https://<cuenta>.eu.r2.cloudflarestorage.com`.
  La jurisdicción **no se puede cambiar** después ([Data location](https://developers.cloudflare.com/r2/reference/data-location/)).
  La aplicación rechaza otra cosa que `eu` o `default` y la pantalla avisa si no es `eu`.
- Cloudflare, Inc. es una empresa de EE. UU.: hace falta su **acuerdo de encargo
  (DPA)**, que incluye cláusulas contractuales tipo; comprobar antes de firmar que
  sigue en la lista del EU‑U.S. Data Privacy Framework. Hay que añadir a Cloudflare
  como **encargado** en `docs/rgpd.md` (registro de tratamientos) y en la política
  de privacidad: las fotos pueden tener personas.
- No se activa ningún dominio público ni `r2.dev`: el cubo es **privado**.

### 1.4 Archivos privados por organización

Igual que hoy: la ruta es `<organización>/<marca>/…` y **la RLS decide**. La Edge
Function `media-storage` lee los recursos **con la sesión de la persona** (si la RLS
no le deja ver la fila, no hay dirección) y solo entonces firma una URL de lectura
de **1 hora** (las de Supabase también valían 1 h). Las subidas se firman tras
comprobar en la base de datos que la persona **edita** la marca de la ruta
(`media_storage_register_upload`), con el tipo y el tamaño exactos firmados (otro
archivo da 403) y 15 minutos de validez. Las credenciales de R2 nunca salen del
servidor (Vault). Una URL firmada es un «portador»: quien la tenga lee ese archivo
hasta que caduque, como con Supabase.

### 1.5 Encaje

| Parte                                               | Cómo encaja                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Editor (Konva)                                      | Las imágenes se cargan con `crossOrigin="anonymous"` desde la URL firmada; la **regla CORS** del cubo (§5) permite `GET` desde la aplicación, así que el lienzo no queda «manchado» y exportar funciona.                                                                                                                             |
| Exportación                                         | El editor exporta en el navegador y sube el JPEG/PNG con una URL de subida firmada (`PUT`).                                                                                                                                                                                                                                          |
| Trabajador de medios (reels, recortes, informe PDF) | Pide a `media-storage` (con la clave de servicio) la URL de lectura de cada entrada y la de subida de cada resultado. **No necesita credenciales de R2.** Tope por archivo: 2 GiB en R2 (frente a 50 MB del cubo gratuito). Si la función no está desplegada, sigue con Supabase Storage; `WORKER_MEDIA_STORAGE=supabase` lo fuerza. |
| Publicación en Instagram                            | `social-publish` firma una URL de lectura de 1 hora del JPEG o del vídeo, como hasta ahora (R2 admite hasta 7 días); Instagram la descarga sin cabeceras, igual que hoy la de Supabase. Las URL prefirmadas de R2 **no** funcionan con dominios propios, solo con el de la API S3: es lo que se usa.                                 |
| Imágenes con IA                                     | Se guardan en el almacén activo y se registran igual.                                                                                                                                                                                                                                                                                |
| Drive                                               | Sigue igual: los recursos de Drive son referencias y los sirve `drive-media`. El script de migración puede copiar las fotos a R2 para no depender de Drive (§4).                                                                                                                                                                     |
| Supabase Storage                                    | Respaldo: lo ya subido sigue allí y se sigue leyendo; las tipografías, fuentes de marca (PDF/Word) y exportaciones RGPD se quedan en Supabase (pesan poco). Con `MEDIA_UPLOAD_BACKEND=supabase` se vuelve a subir todo a Supabase sin tocar nada más.                                                                                |

### 1.6 Conclusión: **sí, con condiciones**

Sí: ahorra el límite de espacio y, sobre todo, la salida de Supabase, cuesta 0 $
con el volumen actual y encaja con todo lo que hay. Condiciones:

1. Cubo con jurisdicción **UE**, privado, sin dominio público, con la regla CORS de §5.
2. Firmar el **DPA de Cloudflare** y añadirlo al registro de tratamientos y a la
   política de privacidad **antes** de subir fotos de clientes.
3. Token de API **solo para ese cubo** y con «Object Read & Write».
4. Supabase Storage se queda como respaldo: la migración **copia**, no borra; se
   borra del origen solo cuando se haya comprobado R2 durante un tiempo.

## 2. Cómo funciona

- `media_assets.storage_backend` (`supabase` o `r2`) dice dónde está cada archivo.
  **No lo escribe el navegador**: un disparador lo toma de
  `private.media_object_locations`, donde el servidor apunta cada objeto que firma
  para subir a R2. Así vale para las altas del navegador, del trabajador, de la IA y
  de los informes sin cambiar ninguna de ellas.
- Edge Function `media-storage` (`supabase/functions/media-storage/`):
  - `POST /sign {paths}` — con sesión: URL de lectura de los recursos en R2 que ve
    (RLS); el resto lo firma el navegador con Supabase como siempre. Con la clave de
    servicio (trabajador, publicación): URL de cualquier ruta, en el almacén que sea.
  - `POST /upload {path, contentType, bytes}` — decide el almacén (`MEDIA_UPLOAD_BACKEND`),
    comprueba en la base de datos que se edita la marca, lo apunta y devuelve la URL
    de subida (o `{backend: 'supabase'}` para subir como siempre).
  - `POST /delete {paths}` — borra los archivos de la cola de limpieza que la persona
    ve (RLS), en el almacén de cada uno.
- Adaptadores (`supabase/functions/_shared/storage/`): `ObjectStorage` con
  `signGet`, `signPut`, `head`, `put`, `remove`, `list`. `s3.ts` (R2 y MinIO) y
  `supabase.ts` (Supabase Storage).
- Interfaz: el módulo solo se activa si el servidor dice que R2 está configurado
  (`useFeature('mediaStorage')`, acción `availability`). No tiene variable `VITE_`:
  si el servidor guarda algo en R2, el navegador tiene que saber leerlo.
- Borrar una organización borra también su carpeta en R2.

## 3. Variables y secretos

En **Plataforma → Integraciones → Cloudflare R2** (secretos cifrados en Vault):

| Ajuste                                     | Qué es                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `R2_ACCOUNT_ID`                            | ID de la cuenta de Cloudflare (32 caracteres hexadecimales)                          |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Del token de API de R2 (secreto)                                                     |
| `R2_BUCKET`                                | Nombre del cubo                                                                      |
| `R2_JURISDICTION`                          | `eu` (recomendado) o `default`                                                       |
| `MEDIA_UPLOAD_BACKEND`                     | Dónde van las subidas nuevas: `r2` (por defecto si R2 está configurado) o `supabase` |

`MEDIA_STORAGE_ALLOWED_ORIGIN` (opcional): CORS de `media-storage` (por defecto `*`;
la sesión va en cabecera).

Solo para pruebas locales (variables de la función, nunca en la interfaz):
`MEDIA_STORAGE_E2E_SIMULATED=true` con `MEDIA_STORAGE_S3_ENDPOINT` (lo que usa la
función, p. ej. `http://host.docker.internal:9000`) y
`MEDIA_STORAGE_S3_PUBLIC_ENDPOINT` (lo que reciben navegador y trabajador, p. ej.
`http://127.0.0.1:59000`). La función no arranca así si `SUPABASE_URL` no es local.
La prueba e2e arranca MinIO con la imagen `bitnamilegacy/minio:2025.7.23` (MinIO ya
no publica imágenes en Docker Hub) en la red del stack local y lo quita al acabar.
Esa imagen arranca MinIO, se configura, lo para y lo vuelve a arrancar: la prueba
espera a «MinIO setup finished» en su registro antes de usarlo (si no, las primeras
subidas del navegador se cortan con `ERR_EMPTY_RESPONSE`).

Script de migración (en el entorno de quien lo ejecuta, nunca en el repositorio):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_JURISDICTION` y, para leer de Drive,
`DRIVE_ACCESS_TOKEN` (token OAuth con `drive.readonly`).

## 4. Migración (`scripts/migrar-a-r2.ts`)

```
node scripts/migrar-a-r2.ts --dry-run --org <id> --brand <id> \
  --brand-media-list <lista.json> \
  --drive-csv <inventario.csv> \
  --jpeg-dir <carpeta salida> --jpeg-jsonl <subidas-pendientes.jsonl>
```

- **En seco** (`--dry-run`, por defecto): no escribe nada; cuenta archivos y bytes
  por origen y avisa de lo que falta.
- Copia sin borrar nada en el origen, **reanudable**: anota cada objeto copiado
  (ruta, bytes y SHA-256) en `--state` (JSON por líneas) y se salta lo ya copiado
  si el objeto en R2 tiene el mismo tamaño.
- Orígenes: `brand-media` (misma ruta en R2); del inventario de Drive, solo filas
  con estado `incluida`; las HEIC se sustituyen por su JPEG (el subido a Drive,
  `jpeg_id`, o el local, `jpeg_local` / `<jpeg-dir>/<id>.jpg`). Las fotos de Drive
  van a `<org>/<marca>/import/drive/<id>-<nombre>`.
- `--limit <n>`: copia como mucho n archivos en la pasada (para probar).
- `--switch` (opcional, tras copiar): pasa a `storage_backend = 'r2'` las filas de
  `media_assets` cuyo objeto ya está copiado y comprobado. Sin él, la biblioteca
  sigue leyendo de Supabase.
- Las fotos de Drive se copian como objetos; **darlas de alta en la biblioteca**
  (o pasar las referencias de Drive a R2) es un paso aparte, pendiente.

Recuento en seco del 20/11/2026 (brand-media leído de staging con SQL de solo
lectura; inventario y JPEG locales):

| Origen                                                            | Archivos | Tamaño                    |
| ----------------------------------------------------------------- | -------- | ------------------------- |
| `brand-media` (Supabase)                                          | 34       | 12,8 MB                   |
| Drive: fotos JPEG/PNG incluidas                                   | 109      | 105,9 MB                  |
| Drive: vídeos incluidos                                           | 46       | 2.020,1 MB                |
| JPEG convertidos de HEIC (locales; 126 de ellos también en Drive) | 371      | 871,6 MB                  |
| **Total**                                                         | **560**  | **3.010,4 MB (≈ 3,2 GB)** |

No se copian: 323 excluidas (268 de facturas, 53 de la libreta de reservas, 2
recetas internas), 343 «no útil» (duplicados y descartes), 3 «personal, pedir
permiso» y 21 HEIC cuyo JPEG original ya está en el inventario.

La copia (`--apply`) se ha probado contra MinIO en local (6 JPEG en dos pasadas:
la segunda se salta lo ya copiado). **Sin probar contra R2 real ni bajando de Drive**
(hace falta `DRIVE_ACCESS_TOKEN`).

## 5. Lo que hace el dueño en Cloudflare

1. **Cuenta**: https://dash.cloudflare.com/sign-up con el correo de Oficiosos;
   verificar el correo y activar la autenticación en dos pasos.
2. **Activar R2**: menú «R2 Object Storage» → «Purchase R2 Plan» (plan gratuito;
   pide una tarjeta, no cobra mientras no se pase de 10 GB y de las operaciones
   gratuitas). Apuntar el **Account ID** (columna derecha de «R2 Object Storage →
   Overview»).
3. **Cubo**: «Create bucket» → nombre `rrss-media-staging` (y otro
   `rrss-media-prod` para producción) → **Location: «Specify jurisdiction» → «European
   Union (EU)»** → clase **Standard** → «Create bucket». No activar «Public access»,
   ni `r2.dev`, ni dominio propio.
4. **Regla CORS**: en el cubo, «Settings» → «CORS Policy» → «Add CORS policy» y pegar:

   ```json
   [
     {
       "AllowedOrigins": ["https://rrss-omega.vercel.app", "http://localhost:5173"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["etag", "content-length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   (cuando haya dominio propio, añadirlo a `AllowedOrigins`).

5. **Token de API con permisos mínimos**: «R2 Object Storage → Overview → Manage API
   Tokens» → «Create Account API token» → nombre `rrss-staging` → permiso
   **«Object Read & Write»** → «Apply to specific buckets only» → elegir
   `rrss-media-staging` → TTL a gusto (o sin caducidad) → «Create». Copiar en ese
   momento el **Access Key ID** y el **Secret Access Key** (no se vuelven a ver).
   «Object Read & Write» limitado a un cubo permite HeadBucket, leer, escribir,
   listar y borrar objetos de ese cubo y nada más.
6. **Meterlo en rrss**: https://rrss-omega.vercel.app → Plataforma → Integraciones →
   Cloudflare R2: Account ID, Access Key ID, Secret Access Key, cubo
   `rrss-media-staging`, jurisdicción `eu` → Guardar → «Probar conexión» (debe decir
   que el cubo responde).
7. **DPA**: Cloudflare Dashboard → «Manage Account» → «Configurations» → «Data
   Processing Addendum»; firmarlo para la cuenta.

Hasta el paso 6 las subidas siguen yendo a Supabase y nada cambia.

## 6. Pendiente

- Probar contra R2 real (falta la cuenta) y ejecutar la migración de verdad, tras el
  «sí» con el recuento.
- Añadir a Cloudflare como encargado en `docs/rgpd.md` y en la política de privacidad.
- Si el alta de un recurso falla después de subir a R2, el objeto queda en R2 sin
  recurso (en Supabase se borra en el momento).
- Dar de alta en la biblioteca las fotos de Drive copiadas a R2.
- Tipografías, fuentes de marca y exportaciones RGPD siguen en Supabase Storage.
- La exportación RGPD de la organización no incluye los archivos de R2 (tampoco los
  de Drive).
- Borrar de Supabase lo ya copiado cuando R2 se haya comprobado.

## Archivos huérfanos (migración `20261129010000`)

Si el navegador sube a R2 con la URL firmada y después falla el alta del recurso
(o se cierra la pestaña), el objeto queda sin recurso. Dos defensas:

- **Borrado compensatorio:** al fallar el alta, `uploadAsset` llama a
  `media-storage/discard`; el servidor borra de R2 lo que esa persona subió y no
  tiene recurso (`media_storage_orphans`).
- **Tarea programada** `rrss-media-orphans` (cada hora, `media-storage/purge-orphans`,
  solo clave de servicio): borra lo apuntado en `private.media_object_locations`
  sin recurso pasadas 24 h. Necesita los secretos de Vault `rrss_project_url` y
  `rrss_service_role_key`, como el resto de tareas.

Los provisionales caducados los borra `purge_provisional_assets`, que anota el
archivo en la cola de limpieza; no se solapa con esto.
