// Sustituto mínimo de `vitest` para el banco de pruebas de maquetación: el
// Supabase simulado de src/test usa `vi.fn()`, y aquí corre en un navegador real.
type Impl = (...args: never[]) => unknown;
function fn() {
  let impl: Impl | undefined;
  const mock = ((...args: never[]) => impl?.(...args)) as unknown as Record<string, unknown> & Impl;
  mock.mockReset = () => {
    impl = undefined;
    return mock;
  };
  mock.mockImplementation = (next: Impl) => {
    impl = next;
    return mock;
  };
  mock.mockResolvedValue = (value: unknown) => {
    impl = () => Promise.resolve(value);
    return mock;
  };
  return mock;
}
export const vi = { fn };
