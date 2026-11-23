import { describe, expect, it } from 'vitest';
import { cleanMessage, translateError, unwrap } from './errors';

describe('translateError', () => {
  it('respeta los mensajes de nuestras funciones de base de datos', () => {
    expect(translateError({ code: 'P0001', message: 'La organización debe conservar al menos un propietario' })).toBe(
      'La organización debe conservar al menos un propietario',
    );
    expect(translateError({ code: '42501', message: 'Esta invitación es para otra dirección de correo' })).toBe(
      'Esta invitación es para otra dirección de correo',
    );
    expect(translateError(new Error('«a.svg» es de un tipo que no se admite (image/svg+xml).'))).toMatch(
      /no se admite/,
    );
  });

  it('traduce los rechazos de permisos sin enseñar detalles técnicos', () => {
    const expected = 'No tienes permiso para hacer esto.';
    expect(translateError({ code: '42501', message: 'permission denied for table brands' })).toBe(expected);
    expect(
      translateError({ code: '42501', message: 'new row violates row-level security policy for table "media_assets"' }),
    ).toBe(expected);
    expect(translateError({ statusCode: '403', message: 'new row violates row-level security policy' })).toBe(expected);
    expect(translateError({ status: 403, message: 'Forbidden' })).toBe(expected);
  });

  it('traduce errores de datos', () => {
    expect(translateError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toMatch(
      /Ya existe/,
    );
    expect(translateError({ code: '23503', message: 'violates foreign key constraint' })).toMatch(
      /depende de un elemento/,
    );
    expect(translateError({ code: '23514', message: 'violates check constraint' })).toMatch(/no es válido/);
    expect(
      translateError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }),
    ).toMatch(/No se ha encontrado/);
  });

  it('traduce errores de sesión', () => {
    expect(translateError({ message: 'Invalid login credentials', status: 400 })).toBe(
      'El correo o la contraseña no son correctos.',
    );
    expect(translateError({ message: 'User already registered' })).toMatch(/Ya existe una cuenta/);
    expect(translateError({ message: 'Email not confirmed' })).toMatch(/confirmado/);
    expect(translateError({ message: 'Password should be at least 6 characters' })).toMatch(/demasiado corta/);
    expect(translateError({ message: 'JWT expired', code: 'PGRST301' })).toMatch(/sesión ha caducado/);
    expect(translateError({ status: 429, message: 'x' })).toMatch(/Demasiados intentos/);
  });

  it('traduce errores de red y de subida', () => {
    expect(translateError(new TypeError('Failed to fetch'))).toMatch(/No hay conexión/);
    expect(translateError({ statusCode: '413', message: 'The object exceeded the maximum allowed size' })).toMatch(
      /tamaño máximo/,
    );
    expect(translateError({ message: 'mime type image/svg+xml is not supported' })).toMatch(/no está permitido/);
  });

  it('nunca devuelve vacío ni texto técnico desconocido', () => {
    const generic = 'Ha ocurrido un error inesperado. Inténtalo de nuevo.';
    expect(translateError(null)).toBe(generic);
    expect(translateError(undefined)).toBe(generic);
    expect(translateError({})).toBe(generic);
    expect(translateError({ message: 'relation "x" does not exist', code: '42P01' })).toBe(generic);
    expect(translateError('')).toBe(generic);
    expect(translateError('Texto directo')).toBe('Texto directo');
  });
});

describe('archivos de la biblioteca: sin rutas ni identificadores', () => {
  const RUTA = '5bcf11b8-1111-4222-8333-444455556666/0c4d7e2a-aaaa-4bbb-8ccc-dddd00001111/media/1b0334e5-f180-4d14-a642-a8ce24fed92e-fondo-nuevo-chuleton.jpg';

  it('traduce la foto o el vídeo borrados a una frase con qué hacer', () => {
    const p = (message: string) => translateError({ message, code: '22023' });
    expect(p('La foto 1 ya no está en la biblioteca')).toBe(
      'La foto 1 del reel ya no está en la biblioteca. Sustitúyela en el editor y vuelve a montarlo.',
    );
    expect(p('El vídeo 3 ya no está en la biblioteca')).toMatch(/^El vídeo 3 del reel .* Sustitúyelo/);
    expect(p('La música ya no está en la biblioteca')).toMatch(/Cámbiala o quítala/);
    expect(p('La foto de la portada ya no está en la biblioteca')).toMatch(/Elige otra portada/);
  });

  it('el mensaje antiguo, con la ruta entera, se traduce sin enseñarla', () => {
    const text = translateError({ message: `Pieza 1: «${RUTA}» no es un recurso de esta marca`, code: '22023' });
    expect(text).toBe(
      'El elemento 1 del reel ya no está en la biblioteca de la marca. Sustitúyelo en el editor y vuelve a montarlo.',
    );
    expect(translateError({ message: 'Pieza 2: el archivo no es un recurso de esta marca', code: '22023' })).toMatch(
      /^El elemento 2 del reel no es de la biblioteca de esta marca/,
    );
  });

  it('de cualquier otro mensaje propio quita rutas e identificadores, y respeta fechas y formatos', () => {
    const text = translateError({ message: `No se ha podido leer «${RUTA}» (trabajo 1b0334e5-f180-4d14-a642-a8ce24fed92e).` });
    expect(text).not.toMatch(/media|5bcf11b8|1b0334e5/);
    expect(text).toMatch(/^No se ha podido leer el archivo/);
    expect(cleanMessage(`Falta ${RUTA}`)).toBe('Falta el archivo');
    expect(cleanMessage('Programada para el 22/11/2026 en JPEG/PNG.')).toBe('Programada para el 22/11/2026 en JPEG/PNG.');
    expect(translateError(new Error(`Archivo ${RUTA} roto`))).toBe('Archivo el archivo roto');
  });
});

describe('unwrap', () => {
  it('devuelve los datos o lanza el error', () => {
    expect(unwrap({ data: [1], error: null })).toEqual([1]);
    const error = { code: '42501', message: 'permission denied' };
    expect(() => unwrap({ data: null, error })).toThrow();
  });
});
