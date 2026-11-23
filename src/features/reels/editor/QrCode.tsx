// Código QR dibujado como SVG (sin HTML incrustado), con `qrcode-generator`.
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** Los cuadros oscuros como un único trazado: «M x y h1 v1 h-1 z» por cuadro. */
export function qrPath(value: string): { size: number; d: string } | null {
  try {
    const qr = qrcode(0, 'L');
    qr.addData(value, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
    return { size, d };
  } catch {
    // Demasiado largo para un QR.
    return null;
  }
}

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const qr = useMemo(() => qrPath(value), [value]);
  if (!qr) return <p className="text-sm text-danger">El enlace es demasiado largo para un código QR.</p>;
  const margin = 4;
  const box = qr.size + margin * 2;
  return (
    <svg
      viewBox={`${-margin} ${-margin} ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
      data-testid="reel-instagram-qr"
    >
      <rect x={-margin} y={-margin} width={box} height={box} fill="#ffffff" />
      <path d={qr.d} fill="#000000" />
    </svg>
  );
}
