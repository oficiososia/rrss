// Único sitio donde los errores técnicos (Postgres, API, Auth, Storage, red) se
// convierten en mensajes que una persona entiende.

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

const NO_PERMISSION = 'No tienes permiso para hacer esto.';
const GENERIC = 'Ha ocurrido un error inesperado. Inténtalo de nuevo.';

const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, 'El correo o la contraseña no son correctos.'],
  [/email not confirmed/i, 'Todavía no has confirmado tu correo. Revisa tu bandeja de entrada.'],
  [/user already registered|already been registered/i, 'Ya existe una cuenta con ese correo.'],
  [/password should be at least (\d+)/i, 'La contraseña es demasiado corta.'],
  [/weak password|password is known to be weak/i, 'La contraseña es demasiado débil. Elige una más larga y variada.'],
  [/unable to validate email|invalid email/i, 'El correo no tiene un formato válido.'],
  [/rate limit|too many requests/i, 'Demasiados intentos seguidos. Espera un momento y vuelve a probar.'],
  [/signups? (are )?not allowed|signup is disabled/i, 'El registro de cuentas nuevas está desactivado.'],
  [/jwt expired|session.*(expired|missing)|refresh token/i, 'Tu sesión ha caducado. Vuelve a iniciar sesión.'],
  [/same password|different from the old/i, 'La contraseña nueva debe ser distinta de la anterior.'],
];

const TRANSPORT_MESSAGES: [RegExp, string][] = [
  [
    /failed to fetch|networkerror|load failed|network request failed/i,
    'No hay conexión con el servidor. Comprueba tu red.',
  ],
  [
    /payload too large|exceeded the maximum allowed size|entity too large/i,
    'El archivo supera el tamaño máximo permitido.',
  ],
  [/mime type .* is not supported|invalid mime type/i, 'Ese tipo de archivo no está permitido.'],
  [/resource already exists|duplicate/i, 'Ya existe un elemento igual.'],
];

function field(error: unknown, key: keyof ErrorLike): string {
  if (typeof error === 'object' && error !== null && key in error) {
    const value = (error as ErrorLike)[key];
    return value === undefined || value === null ? '' : String(value);
  }
  return '';
}

/** ¿El texto parece escrito por nosotros (RPC en español) y no por Postgres? */
function isOwnMessage(message: string): boolean {
  return /[áéíóúñ¿¡«»]/i.test(message) || /^(No |Solo |Hace falta|La |Has |Hay |Indica |Esta )/.test(message);
}

export function translateError(error: unknown): string {
  if (typeof error === 'string') return error || GENERIC;
  const message = field(error, 'message');
  const code = field(error, 'code');
  const status = field(error, 'status') || field(error, 'statusCode');

  // Mensajes de nuestras funciones: ya están en español y son los más precisos.
  if (message && isOwnMessage(message)) return message;
  // Errores que lanza la propia aplicación (validaciones): `Error` a secas, sin
  // código. Los de Supabase y los de red son subclases con otro nombre.
  if (error instanceof Error && error.name === 'Error' && !code && !status && message) return message;

  if (code === '42501' || status === '403' || /row-level security|permission denied/i.test(message))
    return NO_PERMISSION;
  if (code === '23505') return 'Ya existe un elemento con esos datos.';
  if (code === '23503')
    return 'No se puede completar: depende de un elemento que no existe o no es de esta organización.';
  if (code === '23514' || code === '22001' || code === '22P02')
    return 'Alguno de los datos no es válido. Revisa lo que has escrito.';
  if (code === '28000' || status === '401') return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
  if (code === 'PGRST116') return 'No se ha encontrado lo que buscabas o no tienes acceso.';
  if (status === '413') return 'El archivo supera el tamaño máximo permitido.';
  if (status === '429') return 'Demasiados intentos seguidos. Espera un momento y vuelve a probar.';

  for (const [pattern, text] of [...AUTH_MESSAGES, ...TRANSPORT_MESSAGES]) {
    if (pattern.test(message)) return text;
  }
  return GENERIC;
}

/** Lanza si la respuesta de Supabase trae error; devuelve los datos si no. */
export function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}
