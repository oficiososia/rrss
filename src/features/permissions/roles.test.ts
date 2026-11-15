import { describe, expect, it } from 'vitest';
import type { BrandRole } from '@/lib/database.types';
import {
  assignableOrgRoles,
  brandRoleGrants,
  can,
  canRemoveMember,
  effectiveBrandRole,
  type Capability,
} from './roles';

// Debe coincidir con private.brand_role_grants() de la migración.
const MATRIX: Record<BrandRole, Capability[]> = {
  manager: ['view', 'comment', 'approve', 'edit', 'manage'],
  editor: ['view', 'comment', 'edit'],
  reviewer: ['view', 'comment', 'approve'],
  client: ['view', 'comment', 'approve'],
  viewer: ['view'],
};
const ALL: Capability[] = ['view', 'comment', 'approve', 'edit', 'manage'];

describe('permisos por rol de marca', () => {
  for (const role of Object.keys(MATRIX) as BrandRole[]) {
    it(`${role} puede exactamente: ${MATRIX[role].join(', ')}`, () => {
      expect(ALL.filter((capability) => brandRoleGrants(role, capability))).toEqual(MATRIX[role]);
    });
  }

  it('owner y admin de la organización son gestores de todas las marcas', () => {
    expect(effectiveBrandRole('owner', undefined)).toBe('manager');
    expect(effectiveBrandRole('admin', 'viewer')).toBe('manager');
    expect(can('admin', undefined, 'manage')).toBe(true);
  });

  it('un miembro depende de su rol en la marca; sin rol no puede nada', () => {
    expect(effectiveBrandRole('member', 'editor')).toBe('editor');
    expect(can('member', 'editor', 'edit')).toBe(true);
    expect(can('member', 'editor', 'manage')).toBe(false);
    expect(can('member', undefined, 'view')).toBe(false);
    expect(can(null, 'manager', 'view')).toBe(true);
    expect(can(undefined, undefined, 'view')).toBe(false);
  });
});

describe('roles de organización', () => {
  it('solo un propietario toca a los propietarios o nombra otros', () => {
    expect(assignableOrgRoles('owner', 'member')).toEqual(['owner', 'admin', 'member']);
    expect(assignableOrgRoles('admin', 'member')).toEqual(['admin', 'member']);
    expect(assignableOrgRoles('admin', 'owner')).toEqual([]);
    expect(assignableOrgRoles('member', 'member')).toEqual([]);
    expect(assignableOrgRoles(null, 'member')).toEqual([]);
  });

  it('quién puede quitar a quién', () => {
    expect(canRemoveMember('member', 'member', true)).toBe(true); // marcharse uno mismo
    expect(canRemoveMember('member', 'member', false)).toBe(false);
    expect(canRemoveMember('admin', 'member', false)).toBe(true);
    expect(canRemoveMember('admin', 'owner', false)).toBe(false);
    expect(canRemoveMember('owner', 'owner', false)).toBe(true);
  });
});
