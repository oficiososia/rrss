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
