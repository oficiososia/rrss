# Puesta en marcha

## En local

```bash
npm install
```

```bash
cp .env.example .env.local
```

Rellena `.env.local` con la URL y la clave pública (`anon`) del proyecto de
Supabase de desarrollo y arranca:

```bash
npm run dev
```

Las pruebas no necesitan Supabase:

```bash
npm test
```

```bash
npm run test:db
```

`test:db` aplica las migraciones reales a un Postgres en memoria. Para usar un
Postgres local, define `DATABASE_URL` con un superusuario; crea y borra una base
de datos temporal.

### Supabase local y prueba de extremo a extremo

Hace falta Docker en marcha y la CLI de Supabase. El stack local se llama
`rrss-local` y usa puertos propios (`supabase/config.toml`): API en el 55321,
Postgres en el 55322 y buzón de correo (Mailpit) en el 55324. No se enlaza con
ningún proyecto remoto.

```bash
supabase start
```

Aplica las migraciones de `supabase/migrations/` en una base nueva. Si el
volumen de Docker ya existía (el stack se llama igual en todas las copias del
repositorio), aplica las que falten con `supabase migration up --local`.

```bash
npm run test:e2e
```

No hace falta `.env.local` para la prueba: `playwright.config.ts` lee la URL y
la clave `anon` del stack local con `supabase status -o env` (la clave anónima
local es pública y la misma en todas las máquinas) y se las pasa a Vite por
entorno, junto con `VITE_AI_TEXT_ENABLED=true`. Para `npm run dev` contra el
stack local sí hace falta `.env.local` con esas dos variables.

Playwright (Chromium; la primera vez, `npx playwright install chromium`) arranca
dos procesos: `supabase functions serve --env-file supabase/functions/e2e.env`
(la función `ai-generate` con el proveedor simulado de pruebas locales) y la
aplicación en el puerto 5273. Recorre en un navegador de verdad la Fase 1
(registro con confirmación de correo, dos organizaciones, alta de marcas, perfil
con versiones, biblioteca, invitaciones y roles, aislamiento, recuperación de
contraseña, ajustes, actividad y panel de plataforma) y la aceptación de la
Fase 2 (`09-fase2-ia-editor-y-cupo.spec.ts`): texto generado con IA para dos
marcas, cada uno conforme a su perfil; edición de texto y capa con versiones e
historial; comprobación de marca sin IA y con IA; coste por organización en
«Consumo de IA», y cupo agotado que detiene la generación sin llamar al
proveedor.

El proveedor simulado solo se activa con `AI_E2E_SIMULATED_PROVIDER=true` **y**
un Supabase local (dentro de Docker la función ve `SUPABASE_URL=http://kong:8000`,
que también cuenta como local); en cualquier otro entorno, si la variable está,
la función no arranca. Sus respuestas se construyen a partir del perfil y del
encargo de forma determinista. `supabase/functions/e2e.env` no lleva secretos:
las claves del stack local las pone la CLI. Los archivos de
`tests/e2e/` van en orden y cada tanda usa correos con un sufijo nuevo, así que
no hace falta vaciar la base entre ejecuciones. Para empezar de cero:

```bash
supabase db reset
```

Al terminar, `supabase stop` libera los contenedores (los datos quedan en un
volumen de Docker; `supabase stop --no-backup` los borra).

## Entornos nuevos (lo hace el dueño; nada de esto está hecho todavía)

El producto usa **cuentas nuevas**, sin relación con las de Casa Tomás.

### 1. Supabase

1. Crear la organización y dos proyectos: `rrss-staging` y `rrss-prod` (se
   puede empezar solo con staging). Región de la UE.
2. En *Authentication*:
   - **Confirmar correo: activado.** Es un requisito de seguridad: las
     invitaciones se aceptan por coincidencia de correo.
   - *Site URL* y *Redirect URLs*: el dominio del producto y las vistas previas.
   - Longitud mínima de contraseña y protección contra contraseñas filtradas.
3. Aplicar las migraciones de `supabase/migrations/` en orden (con la CLI:
   `supabase link` y `supabase db push`).
4. Dar de alta al primer superadministrador, una vez registrado en la aplicación:

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'TU_CORREO';
   ```

### 2. Vercel

1. Proyecto nuevo importando este repositorio (framework: Vite).
2. Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`: las de producción
   en *Production*, las de staging en *Preview*.
   `VITE_AI_TEXT_ENABLED=true` solo en el entorno cuya función `ai-generate`
   tenga un proveedor de IA de texto configurado: sin ella no se enseñan
   «Redactar con IA», la comprobación de tono ni la propuesta de perfil (lo que
   no funciona no sale en la interfaz). `VITE_AI_ACCOUNT_CURRENCY` (opcional)
   fija la moneda de los importes de IA.
3. Rama de producción `main`; `staging` como entorno de validación.
4. Dominio propio.

Nunca se pone la clave de servicio de Supabase en variables `VITE_`.

### 3. Comprobación tras desplegar

1. Registrar dos cuentas, crear una organización con cada una y una marca en
   cada organización.
2. Comprobar que ninguna ve la organización, las marcas ni los archivos de la otra.
3. Invitar a una tercera cuenta como cliente de una marca y comprobar que solo
   ve esa marca y no puede editar.

## Circuito de cambios

`feature/*` o `fix/*` → PR a `staging` → validar en staging → PR de versión a
`main`. Las migraciones se aplican en staging antes que en producción. Antes de
cada PR: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:db`,
`npm run build`.
