import { createContext, useContext } from 'react';
import type { BrandRole, BrandRow } from '@/lib/database.types';
import { can, type Capability } from '@/features/permissions/roles';
import type { MyOrganization } from './api';

export interface OrgContextValue {
  org: MyOrganization;
  isAdmin: boolean;
  brands: BrandRow[];
  brandRoles: Map<string, BrandRole>;
}

export const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg se ha usado fuera de una organización');
  return value;
}

export interface BrandContextValue {
  brand: BrandRow;
  role: BrandRole;
  can: (capability: Capability) => boolean;
}

export const BrandContext = createContext<BrandContextValue | null>(null);

export function useBrand(): BrandContextValue {
  const value = useContext(BrandContext);
  if (!value) throw new Error('useBrand se ha usado fuera de una marca');
  return value;
}

export function makeBrandContext(
  org: MyOrganization,
  brand: BrandRow,
  brandRole: BrandRole | undefined,
): BrandContextValue {
  const isAdmin = org.role === 'owner' || org.role === 'admin';
  return {
    brand,
    role: isAdmin ? 'manager' : (brandRole ?? 'viewer'),
    can: (capability) => can(org.role, brandRole, capability),
  };
}

const LAST_KEY = 'rrss.last';
export function lastSelectionKey(userId: string): string {
  return `${LAST_KEY}.${userId}`;
}
export interface LastSelection {
  orgId?: string;
  brandByOrg?: Record<string, string>;
}
