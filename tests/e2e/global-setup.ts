import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DIR_ESTADO, ESTADO_JSON, LOCAL, type Estado } from './apoyo';

/**
 * Antes de la tanda: comprueba que el backend es el LOCAL y que responde, y
 * prepara el estado compartido. Cada tanda usa correos con un sufijo propio,
 * así no hace falta vaciar la base de datos entre ejecuciones.
 *
 * Con E2E_CONTINUAR=1 se reutiliza el estado de la tanda anterior (para
 * relanzar un solo archivo mientras se depura).
 */
export default async function globalSetup(): Promise<void> {
  const envLocal = path.resolve('.env.local');
  if (!existsSync(envLocal)) {
    throw new Error(
      'Falta .env.local con la URL y la clave anónima del Supabase local (ver docs/05-puesta-en-marcha.md).',
    );
  }
  const env = readFileSync(envLocal, 'utf8');
  const url = /^VITE_SUPABASE_URL=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
  if (url !== LOCAL.api) {
    throw new Error(`La prueba e2e solo corre contra el Supabase local (${LOCAL.api}); .env.local apunta a «${url}».`);
  }

  const salud = await fetch(`${LOCAL.api}/auth/v1/health`).catch(() => null);
  if (!salud?.ok) throw new Error('El Supabase local no responde. Arráncalo con `supabase start`.');
  const buzon = await fetch(`${LOCAL.buzon}/api/v1/info`).catch(() => null);
  if (!buzon?.ok) throw new Error(`El buzón de correo local no responde en ${LOCAL.buzon}.`);

  if (process.env.E2E_CONTINUAR === '1' && existsSync(ESTADO_JSON)) return;

  rmSync(DIR_ESTADO, { recursive: true, force: true });
  mkdirSync(DIR_ESTADO, { recursive: true });
  const estado: Estado = { tanda: Date.now().toString(36), claves: {} };
  writeFileSync(ESTADO_JSON, JSON.stringify(estado, null, 2));
}
