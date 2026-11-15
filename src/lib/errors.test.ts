import { describe, expect, it } from 'vitest';
import { translateError, unwrap } from './errors';

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

describe('unwrap', () => {
  it('devuelve los datos o lanza el error', () => {
    expect(unwrap({ data: [1], error: null })).toEqual([1]);
    const error = { code: '42501', message: 'permission denied' };
    expect(() => unwrap({ data: null, error })).toThrow();
  });
});
