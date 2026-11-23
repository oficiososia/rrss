import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keys } from './api';
import { lastSelectionKey } from './context';
import { endColdRootEntry, isColdRootEntry, prefetchStartup, startupOrgId } from './startup';

const USER = 'user-1';

function prefetchedKeys(pathname: string): unknown[] {
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'prefetchQuery').mockResolvedValue(undefined);
  prefetchStartup(client, USER, pathname);
  return spy.mock.calls.map(([options]) => options.queryKey);
}

afterEach(() => {
  window.localStorage.clear();
  endColdRootEntry();
});

describe('Arranque: consultas a la vez', () => {
  it('con una dirección directa pide a la vez lo legal, la organización, sus marcas y los permisos', () => {
    const queried = prefetchedKeys('/o/org-9/m/brand-3/inicio');
    expect(queried).toEqual(
      expect.arrayContaining([
        ['legal-acceptances', USER],
        keys.platformAdmin(USER),
        keys.orgs(USER),
        keys.brands('org-9'),
        keys.myBrandRoles('org-9', USER),
      ]),
    );
  });

  it('en «/» usa la última organización visitada, y sin visita previa no adivina', () => {
    expect(prefetchedKeys('/')).not.toContainEqual(keys.brands('org-9'));
    window.localStorage.setItem(lastSelectionKey(USER), JSON.stringify({ orgId: 'org-9' }));
    expect(prefetchedKeys('/')).toContainEqual(keys.brands('org-9'));
    expect(startupOrgId('/plataforma', USER)).toBeUndefined();
  });

  it('marca la entrada en frío por «/» hasta que RootRedirect decide', () => {
    prefetchedKeys('/o/org-9');
    expect(isColdRootEntry()).toBe(false);
    prefetchedKeys('/');
    expect(isColdRootEntry()).toBe(true);
    endColdRootEntry();
    expect(isColdRootEntry()).toBe(false);
  });
});
