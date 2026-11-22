import { contentPaths } from '@/features/content/labels';
import type { HoldFix } from '@/features/social/holdAdvice';
import { connectedAccountsPath, exportPath, planPath } from '@/features/social/links';

/** Dónde se arregla cada cosa que tiene parada una publicación. */
export function fixTarget(
  fix: HoldFix,
  where: { orgId: string; brandId: string; contentId: string },
): { to: string; label?: string } | null {
  const { orgId, brandId, contentId } = where;
  const base = `/o/${orgId}/m/${brandId}`;
  switch (fix) {
    case 'connect':
      return { to: connectedAccountsPath(orgId, brandId) };
    case 'export':
      return { to: exportPath(orgId, brandId, contentId) };
    case 'open_editor':
      return { to: contentPaths(orgId, brandId).item(contentId) };
    case 'change_plan':
      return { to: planPath(orgId) };
    case 'use_account':
    case 'use_approved':
      return { to: `${base}/calendario`, label: 'Arreglar en el calendario' };
    case 'none':
      return null;
  }
}

