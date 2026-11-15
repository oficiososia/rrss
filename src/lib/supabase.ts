import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** Falso si faltan las variables de entorno: la app muestra entonces una pantalla de configuración. */
export const supabaseConfigured = Boolean(url && anonKey);

// Con valores de relleno el cliente se puede construir sin lanzar errores; App
// no monta nada que lo use mientras `supabaseConfigured` sea falso.
export const supabase = createClient<Database>(url || 'http://localhost:54321', anonKey || 'sin-configurar');
