import { useContext, useEffect, useState } from 'react';
import { useActiveProfile, useUpdateBrand } from '@/features/brand/api';
import { profileCompleteness } from '@/features/brand/completeness';
import { parseProfile } from '@/features/brand/profile';
import { BrandContext, OrgContext } from '@/features/orgs/context';

// Qué sabe la IA de la marca antes de pedirle nada (prueba de calidad del
// 23/11/2026, fallo 1). La IA ya no se bloquea sin perfil: trabaja con el
// nombre y el sector de la marca. Aquí se avisa en una línea si el perfil está
// incompleto y, si no hay perfil NI sector, se pide el sector en el mismo
// diálogo antes de gastar.

export interface BrandAiReadiness {
  loading: boolean;
  /** La marca no tiene perfil guardado. */
  profileMissing: boolean;
  /** Porcentaje del perfil completado (0 sin perfil). */
  percent: number;
  /** Sin perfil ni sector: hay que decir a qué se dedica antes de redactar. */
  needsSector: boolean;
}

export function useBrandAiReadiness(brandId: string): BrandAiReadiness {
  // Fuera de una marca (pruebas de componentes, vistas sueltas) no se sabe el sector: no se pide.
  const brand = useContext(BrandContext)?.brand ?? null;
  const profile = useActiveProfile(brandId);
  const parsed = profile.data ? parseProfile(profile.data.data) : null;
  const percent = parsed ? profileCompleteness(parsed).percent : 0;
  const profileMissing = !profile.isPending && !profile.data;
  return {
    loading: profile.isPending,
    profileMissing,
    percent,
    needsSector: brand !== null && profileMissing && !(brand.sector ?? '').trim(),
  };
}

/** Guarda el sector en la marca si se puede (quien gestiona la marca); si no, solo vale para esta petición. */
export function useRememberSector() {
  const org = useContext(OrgContext)?.org ?? null;
  const brand = useContext(BrandContext)?.brand ?? null;
  const update = useUpdateBrand(org?.id ?? '', brand?.id ?? '');
  return (sector: string) => {
    if (!org || !brand || !sector.trim() || (brand.sector ?? '').trim()) return;
    update.mutateAsync({ sector: sector.trim() }).catch(() => undefined);
  };
}

/** El valor, cuando lleva `delay` ms sin cambiar (para no calcular el coste a cada tecla). */
export function useSettled<T>(value: T, delay = 500): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

