import { cn } from '@/lib/utils';
import type { DistinctName } from './assetNames';

/**
 * El nombre de un archivo en una tarjeta pequeña: la parte que lo distingue (ver `distinctNames`)
 * y, si hace falta, la carpeta. Con `revealed`, el nombre entero, sin cortar.
 */
export function AssetName({
  name,
  revealed = false,
  className,
}: {
  name: DistinctName;
  revealed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('block min-w-0', className)} data-testid="asset-card-name">
      {revealed ? (
        <span className="block break-words text-xs font-medium" data-testid="asset-card-name-full">
          {name.full}
        </span>
      ) : (
        <span className="block truncate text-xs font-medium" data-testid="asset-card-name-label">
          {name.label}
        </span>
      )}
      {name.folder && !revealed && (
        <span className="block truncate text-[11px] text-muted" data-testid="asset-card-name-folder">
          {name.folder}
        </span>
      )}
    </span>
  );
}
