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

// ── Archivos de la biblioteca: nunca se enseñan rutas ni identificadores ──

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/**
 * Una ruta de almacenamiento (`<org>/<marca>/media/x.jpg`): empieza por un identificador o
 * pasa por una de las carpetas del almacén. Fechas («22/11/2026») o «JPEG/PNG» no lo son.
 */
const STORAGE_PATH =
  /(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/|[\w.-]+\/(?:media|reels|drive|thumbs|fonts|exports)\/)[^\s»"',;]*/gi;

const MEDIA_MESSAGES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^La foto (\d+) ya no está en la biblioteca\.?$/,
    (m) => `La foto ${m[1]} del reel ya no está en la biblioteca. Sustitúyela en el editor y vuelve a montarlo.`,
  ],
  [
    /^El vídeo (\d+) ya no está en la biblioteca\.?$/,
    (m) => `El vídeo ${m[1]} del reel ya no está en la biblioteca. Sustitúyelo en el editor y vuelve a montarlo.`,
  ],
  [
    /^La música ya no está en la biblioteca\.?$/,
    () => 'La música del reel ya no está en la biblioteca. Cámbiala o quítala y vuelve a montarlo.',
  ],
  [
    /^La foto de la portada ya no está en la biblioteca\.?$/,
    () => 'La foto de la portada ya no está en la biblioteca. Elige otra portada y vuelve a montarlo.',
  ],
  // Servidores anteriores a 20270107010000: el mensaje traía la ruta y no distinguía si se había borrado.
  [
    /^Pieza (\d+): «[^»]*» no es un recurso de esta marca/,
    (m) =>
      `El elemento ${m[1]} del reel ya no está en la biblioteca de la marca. Sustitúyelo en el editor y vuelve a montarlo.`,
  ],
  [
    /^Pieza (\d+): el archivo no es un recurso de esta marca/,
    (m) => `El elemento ${m[1]} del reel no es de la biblioteca de esta marca. Sustitúyelo por uno de la biblioteca.`,
  ],
  [
    /^Música: (?:«[^»]*»|el archivo) no es un recurso de esta marca/,
    () => 'La música del reel ya no está en la biblioteca de la marca. Cámbiala o quítala y vuelve a montarlo.',
  ],
  [
    /^Portada: (?:«[^»]*»|el archivo) no es un recurso de esta marca/,
    () => 'La foto de la portada ya no está en la biblioteca de la marca. Elige otra portada.',
  ],
  [
    /^Foto: (?:«[^»]*»|el archivo) no es un recurso de esta marca/,
    () => 'Esa foto ya no está en la biblioteca de la marca. Elige otra.',
  ],
];

/**
 * Mensaje que se puede enseñar: los errores conocidos de archivos (borrados de la
 * biblioteca, de otra marca) se traducen a una frase con qué hacer, y de cualquier
 * otro se quitan las rutas de almacenamiento y los identificadores.
 */
export function cleanMessage(message: string): string {
  const trimmed = message.trim();
  for (const [pattern, text] of MEDIA_MESSAGES) {
    const match = trimmed.match(pattern);
    if (match) return text(match);
  }
  return trimmed
    .replace(/«[^»]*(?:\/|[0-9a-f]{8}-[0-9a-f]{4}-)[^»]*»/gi, 'el archivo')
    .replace(STORAGE_PATH, 'el archivo')
    .replace(UUID, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,:;])/g, '$1')
    .trim();
}

export function translateError(error: unknown): string {
  if (typeof error === 'string') return error ? cleanMessage(error) : GENERIC;
  const message = field(error, 'message');
  const code = field(error, 'code');
  const status = field(error, 'status') || field(error, 'statusCode');

  // Archivos borrados o de otra marca (algunos no llevan tildes: se miran antes).
  if (message && MEDIA_MESSAGES.some(([pattern]) => pattern.test(message.trim()))) return cleanMessage(message);
  // Mensajes de nuestras funciones: ya están en español y son los más precisos.
  if (message && isOwnMessage(message)) return cleanMessage(message);
  // Errores que lanza la propia aplicación (validaciones): `Error` a secas, sin
  // código. Los de Supabase y los de red son subclases con otro nombre.
  if (error instanceof Error && error.name === 'Error' && !code && !status && message) return cleanMessage(message);

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
