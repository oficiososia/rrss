# Dónde alojar el trabajador de medios (guía para el dueño)

Guía del 21/11/2026. **Solo documentación:** no se ha tocado código, no se ha
contratado nada ni se ha creado ninguna cuenta. Los precios se consultaron hoy
en las webs oficiales que se citan; lo que no se pudo confirmar va como **NO
CONFIRMADO** y las cifras de cálculo propio como *estimación*. Precios sin IVA.
Para convertir se usa 1 € ≈ 1,10 $ (supuesto redondo, no consultado).

Documentos relacionados: `worker/README.md` (el trabajador por dentro),
`docs/ESTADO.md` («Reels y recortes en staging», decisión 4),
`docs/almacenamiento-r2.md`, `docs/servidor-gpu.md`.

---

## 1. Resumen

1. **Qué hay que alojar:** el trabajador de medios (`worker/`), un programa con FFmpeg que monta los reels, hace los recortes de fotos, extrae el texto de documentos (PDF, Word, webs) y genera el informe mensual en PDF.
2. **Por qué hace falta:** eso no cabe en las funciones de Supabase (límite de unos 2 s de CPU por petición y sin FFmpeg). Sin alojarlo, «Reels» y «Recortes» siguen apagados (`VITE_MEDIA_WORKER_ENABLED`) y la extracción de documentos y el informe PDF se quedan en la cola sin ejecutarse.
3. **Dónde lo recomendamos:** Fly.io, una máquina bajo demanda en Fráncfort (`fra`). Se enciende cuando hay trabajo, vacía la cola y se apaga sola; solo se paga el rato que trabaja.
4. **Coste al mes** con el volumen de arranque (5-10 marcas, unos 100 reels y 100 recortes): **menos de 1 $ al mes** (*estimación*, ver §3). Fly no cobra facturas personales de menos de 5 $ al mes, según su documentación. Hace falta tarjeta.
5. **Trabajo pendiente antes de poder usarlo:** `worker/fly.toml` (no existe), la función de SQL que despierta la máquina (solo hay un boceto en el README) y, para producción, un rol de Postgres limitado en lugar de la clave de servicio. Estimación: ver §6.

---

## 2. Comparativa de opciones

| Opción | Coste al mes (volumen de arranque) | ¿Se apaga sola? | Región UE | Esfuerzo |
| --- | --- | --- | --- | --- |
| **Fly.io, máquina bajo demanda (recomendada)** | < 1 $ (*estimación*; precios confirmados abajo) | Sí: al vaciar la cola el proceso sale y la máquina se para | Sí, Fráncfort (`fra`) | Bajo-medio: `fly.toml` y despertador por `pg_net` |
| Google Cloud Run Jobs | **NO CONFIRMADO** (la página oficial no se pudo leer entera hoy). Sería de céntimos, y el plan gratuito de Cloud Run suele cubrir este volumen | Sí | Sí (Bélgica, Países Bajos, Fráncfort, según región) | Medio-alto: para arrancar un job por API hace falta un token de Google, es decir, una Edge Function intermedia |
| Railway | Plan Hobby: 5 $ al mes con 5 $ de uso incluidos; el uso se cobra a 0,00000772 $ por vCPU-segundo y 0,00000386 $ por GB-segundo. Encendido siempre en modo `continuous`: unos 5 $ (*estimación*) | No por defecto (modo `continuous`) | Sí, Ámsterdam (`europe-west4-drams3a`) | Bajo: no hay que despertar nada |
| Render | Precios de instancias y de trabajadores en segundo plano **NO CONFIRMADOS** (la página no mostró los datos). Un cron job tiene un mínimo de 1 $ al mes por servicio | No (un trabajador siempre encendido se cobra entero) | Fráncfort existe, **NO CONFIRMADO** hoy | Bajo, pero se paga todo el mes |
| VPS en Hetzner | CPX12 (1 vCPU, 2 GB) 11,99 €, o CPX22 (2 vCPU, 4 GB) 19,99 € al mes en Núremberg, 20 TB de tráfico incluido | No: siempre encendido | Sí (Falkenstein, Núremberg, Helsinki) | Alto: hay que mantener el servidor (actualizaciones, vigilar que siga vivo) |

Fuentes (todas consultadas el 21/11/2026): Fly.io <https://docs.fly.io/about/pricing>; Hetzner <https://www.hetzner.com/cloud/regular-performance/>; Railway <https://railway.com/pricing> y <https://docs.railway.com/reference/regions>; Render <https://render.com/docs/cronjobs>; Google Cloud <https://cloud.google.com/run/pricing> (no legible entera).

**Por qué Fly.io.** Es la única opción de las cinco que a la vez (a) se apaga sola, (b) está confirmada en la UE y (c) se puede despertar con una llamada HTTP que la propia base de datos puede hacer sin un intermediario. Las alternativas que se quedan siempre encendidas (Railway, Render, VPS) cuestan entre 5 y 20 € al mes por una tarea que trabaja unas pocas horas al mes. Cloud Run Jobs sería la segunda opción, pero obliga a escribir una Edge Function para obtener el token de Google.

---

## 3. Cuánto cuesta Fly.io con el volumen de arranque

Precios de Fly (<https://docs.fly.io/about/pricing>, 21/11/2026), facturados en dólares:

| Concepto | Precio |
| --- | --- |
| shared-cpu-1x 1 GB, Fráncfort, 30 días encendida | 7,73 $ (en Ashburn: 6,70 $) |
| shared-cpu-2x 2 GB, Ashburn, 30 días encendida | 13,39 $ |
| Máquina parada: solo se cobra el disco raíz | 0,15 $ por GB al mes |
| Tráfico de salida (UE y Norteamérica) | 0,02 $ por GB |
| Cuota de plataforma | Ninguna; sin nivel gratuito |
| Facturas personales de menos de 5 $ al mes | Se perdonan (según la documentación; confirmarlo al crear la cuenta) |

Fly no publica el precio de `shared-cpu-2x` en Fráncfort. Si se aplica la misma subida que en la de 1 GB (7,73 / 6,70 = +15 %), saldría a unos 15,45 $ al mes encendida todo el mes, es decir, **unos 0,02 $ por hora** (*estimación*).

Cálculo (*estimación*): en el contenedor, con 2 CPU, un reel de 10 s tardó 8,4 s en total (`worker/README.md`, «Tiempos medidos»). Con vídeos reales de móvil, más largos, se supone **30 s por trabajo más 10 s de arranque**:

- 200 trabajos al mes × 40 s = 8.000 s, unas 2,2 h de máquina → **~0,05 $**.
- Disco raíz de la imagen parada, unos 0,35 GB × 0,15 $ → **~0,05 $**.
- Texto de documentos, informes PDF y despertares de respaldo del cron: de céntimos.

Aunque se multiplicara por diez, quedaría por debajo de 1 $ al mes. Lo único que no se puede estimar bien hoy es la duración de los vídeos de móvil reales (4K, HEVC, varios minutos): el README lo marca como «falta medir».

---

## 4. Paso a paso con Fly.io

Pone «**Dueño**» lo que solo puede hacer él y «**Claude**» lo que hace Claude en esta misma sesión. Nada de esto está hecho ni contratado.

### 4.1 Lo que hace el dueño

1. **Crear la cuenta** en <https://fly.io> (con el correo de Oficiosos) y entrar en el panel.
2. **Añadir el método de pago** (tarjeta) en *Billing*. Sin tarjeta, Fly solo da 1 $ de prueba durante 7 días. Esto lo introduce el dueño; Claude no escribe datos de tarjeta.
3. **Crear el token de despliegue.** Claude se lo da hecho como comando para copiar, y el dueño lo ejecuta en su terminal, después de `fly auth login` (se abre el navegador y se inicia sesión ahí):

   ```bash
   fly auth login
   fly apps create rrss-worker --org personal
   fly tokens create deploy -a rrss-worker --name claude-despliegue --expiry 720h
   ```

   El último comando imprime un texto que empieza por `FlyV1`. **El dueño no lo pega en el chat.** Lo guarda en el gestor de contraseñas y lo deja en una variable de entorno de su ordenador, o en un archivo fuera del repositorio, para que Claude lo use sin verlo, por ejemplo `~/.fly-rrss/token` (mismo patrón que `~/.supabase-rrss/token`). Caduca a los 30 días (por defecto serían 20 años: mejor corto).
4. **Decir «sí»** a cada paso que cambie algo en la cuenta de Fly, de Vercel o de Supabase. Los pasos de Claude de abajo no se ejecutan sin ese «sí», y primero van contra **staging** (`zzkdrfhqmjfvrdsoguio`); producción, solo cuando el dueño lo pida.

> Dudas que se confirman al ejecutar: la documentación de Fly no aclara si el token de despliegue sirve también para arrancar máquinas por la API. Si no sirviera, el dueño crea un token de máquinas del mismo alcance (`fly tokens create machine-exec`/`org`, según lo que ofrezca la CLI ese día) y se guarda igual.

### 4.2 Lo que hace Claude (con el «sí» del dueño)

**Paso 1. Escribir `worker/fly.toml`.** *No existe.* Claude lo crea con esto (esfuerzo: media hora):

```toml
app = "rrss-worker"
primary_region = "fra"
kill_timeout = 30          # segundos para apagarse ordenado (SIGTERM → release_job)

[build]
  dockerfile = "Dockerfile"

[env]
  WORKER_MODE = "drain"              # vacía la cola y sale
  WORKER_IDLE_EXIT_MS = "10000"      # espera 10 s con la cola vacía por si llega otro
  WORKER_SHUTDOWN_GRACE_MS = "20000"
  WORKER_MEDIA_STORAGE = "auto"      # R2 o Supabase, lo decide la función media-storage

[[vm]]
  size = "shared-cpu-2x"
  memory = "2gb"

# Sin [http_service] ni [[services]]: el trabajador no abre ningún puerto.
# Al terminar el proceso, la máquina se queda parada y no vuelve a arrancar sola.
[[restart]]
  policy = "no"
```

Se confirma al desplegar que Fly acepta ese `restart` y deja la máquina parada al salir el proceso; si no, se ajusta (`on-failure` con pocos reintentos).

**Paso 2. Construir la imagen y desplegarla.** El `worker/Dockerfile` ya existe y es válido tal cual (Node 22 Alpine con FFmpeg, usuario sin privilegios, arranca `node src/main.ts`). El constructor remoto de Fly lo construye, no hace falta Docker en el ordenador:

```bash
cd worker
fly deploy --remote-only --ha=false -a rrss-worker
```

`--ha=false` crea una sola máquina. Claude anota su identificador (`fly machine list -a rrss-worker`), que hace falta en el paso 4.

**Paso 3. Secretos, sin mostrarlos.** Solo hacen falta dos, y **ninguno es de R2**: con `WORKER_MEDIA_STORAGE=auto` el trabajador pregunta a la función `media-storage` de Supabase dónde está cada archivo y recibe direcciones firmadas, así que las claves de Cloudflare R2 se quedan únicamente en los secretos de Supabase (`docs/almacenamiento-r2.md`) y no viajan a Fly.

| Secreto en Fly | Valor |
| --- | --- |
| `SUPABASE_URL` | `https://zzkdrfhqmjfvrdsoguio.supabase.co` (staging) |
| `SUPABASE_SERVICE_ROLE_KEY` | clave de servicio de staging (provisional, hasta tener el rol limitado, §5) |

La clave se pide a la API de gestión de Supabase con el mismo token que ya usa `npm run start:staging`, se guarda en una variable de la sesión (sin imprimirla) y se pasa por la entrada estándar a Fly:

```bash
# Claude lo ejecuta; la clave nunca se escribe en pantalla, en un archivo ni en el repositorio
KEY=$(curl -s -H "Authorization: Bearer $(cat ~/.supabase-rrss/token)" \
  https://api.supabase.com/v1/projects/zzkdrfhqmjfvrdsoguio/api-keys \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(k=>k.name==="service_role").api_key))')
printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "https://zzkdrfhqmjfvrdsoguio.supabase.co" "$KEY" \
  | fly secrets import -a rrss-worker
unset KEY
```

Aviso: el README dice que pedir la clave `service_role` por esa API **no está probado** (la `anon` sí funciona). Si falla, el dueño la copia desde *Supabase → Project Settings → API* a un archivo temporal fuera del repositorio y Claude lo lee con `fly secrets import < archivo`, que se borra después. Para comprobar que están puestos sin verlos: `fly secrets list -a rrss-worker` (solo muestra nombres).

**Paso 4. Cómo se despierta.** *No está creado.* Hay un boceto en `worker/README.md` («Cómo se despertaría desde la base») que llama a una URL desde un disparador de `jobs` con `pg_net` y de respaldo cada minuto con `pg_cron`. Con Fly, esa URL es la API de máquinas, así que **no hace falta una Edge Function intermedia**:

- URL (en Vault, `media_worker_wake_url`): `https://api.machines.dev/v1/apps/rrss-worker/machines/<ID_DE_LA_MÁQUINA>/start` (método `POST`).
- Token (en Vault, `media_worker_wake_token`): el token de Fly, enviado como `Authorization: Bearer …`.

Esto exige una migración nueva con su vuelta atrás (`supabase/rollbacks/`), con la función `private.wake_media_worker()`, el disparador `AFTER INSERT` sobre `public.jobs` y la tarea `media-worker-wake` de `pg_cron` cada minuto, además de pruebas. Particularidades que hay que resolver al escribirla:

- Arrancar una máquina que **ya está en marcha** devuelve un error de Fly; no pasa nada (despertar dos veces es inocuo), pero la función no debe considerarlo un fallo.
- Los reintentos con espera (`run_after` futuro) no generan `INSERT`: los cubre el cron de respaldo.
- Los secretos de Vault los pone el dueño en Supabase (Plataforma o SQL) o los pone Claude con el «sí» del dueño, sin imprimirlos, igual que se hizo con `rrss_service_role_key` para `ai-media-poll`.
- Si la máquina se destruyera y se recreara al redesplegar, cambia el identificador: se vuelve a poner el secreto.

Esfuerzo: **medio día**, contando migración, rollback, pruebas en PGlite y aplicarla en staging.

**Paso 5. Encender la opción en la aplicación.** En Vercel, proyecto `rrss` (equipo `casa-tomas`), entorno de staging, y un despliegue nuevo, porque las variables `VITE_` se fijan al construir:

```bash
vercel env add VITE_MEDIA_WORKER_ENABLED preview staging   # valor: true
vercel deploy                                              # o el despliegue de la rama staging
```

Hasta que el trabajador no esté probado (paso 6), la variable sigue apagada. Si algún día se quiere en producción, se repite lo mismo allí con el «sí» del dueño. Claude toca únicamente el proyecto `rrss`, nunca los de Casa Tomás.

### 4.3 Cómo comprobar que funciona con un reel de prueba

Orden recomendado, de lo más sencillo a lo completo:

1. **Arranque a mano, sin despertador.** Con la cola vacía:

   ```bash
   fly machine start <ID> -a rrss-worker
   fly logs -a rrss-worker          # debe verse un registro JSON de arranque y la salida con código 0
   fly machine list -a rrss-worker  # el estado vuelve a «stopped»
   ```

   Si arranca y se vuelve a parar solo, la parte de Fly está bien.
2. **Un reel real de extremo a extremo.** El dueño, con `VITE_MEDIA_WORKER_ENABLED` encendido en staging, abre **Biblioteca → Reels** con una marca de prueba, elige 2 o 3 fotos, una plantilla (`fundido-suave`), un texto corto, y pulsa «Montar reel».
   - Sin el despertador (paso 4): Claude arranca la máquina a mano con el comando de arriba.
   - Con el despertador: debe empezar solo, en segundos (el cron de respaldo, como mucho en un minuto).
3. **Qué se debe ver:** el reel pasa de «en cola» a «montándose» y a «listo» en la pantalla de Reels (se actualiza cada 4 s); aparece en la carpeta «Reels» de la biblioteca y se reproduce en vertical, con su texto. En `fly logs`, una línea `job.attempt` con resultado `succeeded` y la duración.
4. **Qué mirar si falla:** `fly logs -a rrss-worker`. Una carga inválida falla sin reintentos y con el motivo en la propia pantalla; un fallo de red reintenta con espera creciente.
5. **Recorte de foto, extracción de PDF e informe:** el recorte de la pantalla de Recortes (el README dice que la aplicación aún no tiene dónde pedirlos: `CropPanel` solo aparece con la variable encendida), la extracción al añadir una fuente en formato PDF a una marca, y el informe PDF de analítica. Cada uno debería quedar listo sin más.

Sigue sin estar probado contra Supabase de staging (README, tabla «Estado»), así que el primer intento puede sacar a la luz algún fallo; es lo esperado en una primera prueba.

---

## 5. Seguridad: la clave de servicio del trabajador

Hoy el trabajador arranca con `SUPABASE_SERVICE_ROLE_KEY`, que se salta la seguridad por filas (RLS) de **toda** la base de datos. Si alguien robara el secreto de Fly, o un fallo en el procesamiento de un PDF o un vídeo malicioso diera control del proceso, podría leer o borrar datos de cualquier marca. Está apuntado en `docs/ESTADO.md`, «Pendientes conocidos». Hoy lo atenúa que cada ruta de entrada y salida se comprueba contra la organización y la marca del trabajo (`assertJobPath`), pero eso defiende al propio trabajador, no al secreto si se filtra.

**Propuesta: un rol de Postgres limitado (`rrss_worker`).** El trabajador no necesita más que:

- las funciones de la cola: `claim_jobs`, `complete_job`, `fail_job`, `release_job` y `extend_job_lease`;
- leer y escribir en el cubo `brand-media` de Storage, y llamar a la función `media-storage` cuando hay R2 (esa llamada también hoy lleva la clave de servicio);
- nada más: ninguna tabla directa. Los efectos laterales (crear el recurso en la biblioteca, mover el texto extraído a la fuente) ya los hacen disparadores `SECURITY DEFINER` en la misma transacción que `complete_job`, justo para que el trabajador no necesite más permisos.

Cómo hacerlo:

1. Migración nueva (con vuelta atrás y pruebas en `tests/db/aislamiento.test.ts`): rol `rrss_worker` sin `BYPASSRLS`, `GRANT EXECUTE` solo en esas cinco funciones (hoy solo `service_role` las tiene) y políticas de Storage mínimas para el cubo.
2. Que el trabajador use una clave de ese rol en lugar de la de servicio: un token firmado con el rol `rrss_worker`. **Hay que comprobar antes** que el proyecto de Supabase admite tokens con un rol propio (depende de si usa claves antiguas con secreto JWT o claves nuevas asimétricas, y Supabase las está cambiando).
3. **Alternativa si no se puede (B):** una Edge Function `worker-gateway` que pida un token propio del trabajador (guardado como secreto, comparado con tiempo constante), exponga solo esas cinco operaciones y firme direcciones de Storage restringidas a las rutas del trabajo. Así el trabajador no recibiría ninguna clave de Supabase. Es más trabajo, pero no depende de cómo evolucione el sistema de claves.

Esfuerzo: opción del rol, **1 día** (migración, rollback, pruebas, cambio en `worker/src/supabase.ts` y rotar la clave); opción del intermediario, **2-3 días**.

Recomendación: para staging, arrancar ya con la clave de servicio (es una demo con datos de prueba y se rota al terminar); **para producción, no sin el rol limitado**. Mientras tanto: el token de Fly con caducidad corta, el secreto solo en Fly, rotar la clave de servicio de staging cuando se termine de probar, y no abrir ningún puerto en la máquina (el diseño ya no abre ninguno).

---

## 6. Trabajo de código pendiente (resumen)

| Qué | Estado | Esfuerzo (estimación) |
| --- | --- | --- |
| `worker/fly.toml` | **No existe** | 0,5 h |
| Función de SQL que despierta la máquina (`pg_net` a la API de Fly, disparador, cron de respaldo, Vault, rollback, pruebas) | **No existe** (solo boceto en el README) | 0,5 día |
| Rol de Postgres limitado (o intermediario) en lugar de la clave de servicio | **No existe** | 1 día (rol) o 2-3 días (intermediario) |
| Probar el trabajador contra staging real | **Sin probar** (README) | 0,5 día con el dueño delante |
| Pantalla de Recortes en la aplicación | Falta en la aplicación (la base de datos ya acepta el encargo) | No incluido aquí |
| `media.document.export` (documento por capas a imagen) | Sin implementar | No incluido aquí |
| Variables nuevas en `.env.example` | Pendiente (ESTADO.md) | 0,5 h |

Total para dejar **staging funcionando:** unos 1-1,5 días de Claude más el rato del dueño para la cuenta, la tarjeta y el token. **Producción:** más 1 día del rol limitado.

---

## 7. Opcional: si en el futuro hace falta GPU

Hoy **no hace falta**: `docs/servidor-gpu.md` recomienda todo por API (40-50 $ al mes) y solo propone GPU propia al pasar de unos 100 $ al mes de imagen o cuando se quiera ampliar fotos. El trabajador de FFmpeg y la GPU son piezas **independientes**:

- El trabajador de medios sigue en Fly sin GPU (FFmpeg monta bien los reels en CPU; el reel de 10 s tardó menos de 10 s).
- La GPU sería **otro** servicio (ComfyUI en RunPod u OVH AI Deploy en la UE, sin servidor fijo, según §4 del estudio de GPU), al que la aplicación ya habla por la Edge Function `ai-media` y su adaptador, sin pasar por el trabajador.
- Si algún día un trabajo de vídeo necesitara GPU (por ejemplo, subir de escala con IA), se añadiría como otro tipo de trabajo en la cola, con su propio alojamiento, sin tocar el despertador del trabajador de CPU.
- Un servidor Hetzner encendido (el estudio calcula 214 € al mes como mínimo para GPU) solo compensa con mucha carga continua; no se mezcla con esta decisión.
