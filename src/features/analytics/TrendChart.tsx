import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatNumber } from '../../../supabase/functions/_shared/analytics/analyst';
import { dayLabel, niceTicks } from './summary';

interface Point {
  date: string;
  value: number | null;
}

const MARGIN = { top: 14, right: 12, bottom: 24, left: 40 };

/** Ancho real del contenedor (el gráfico se dibuja a tamaño de pantalla, sin deformar el texto). */
function useWidth(fallback = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Tramos seguidos con cifra: un día sin cifra corta la línea (no se dibuja como cero). */
function segments(points: Point[]): Array<Array<{ i: number; value: number }>> {
  const out: Array<Array<{ i: number; value: number }>> = [];
  let current: Array<{ i: number; value: number }> = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) out.push(current);
      current = [];
    } else {
      current.push({ i, value: p.value });
    }
  });
  if (current.length) out.push(current);
  return out;
}

/**
 * Evolución diaria de una cifra: una línea de 2 px con un velo suave debajo, rejilla
 * recesiva, marcas del eje en números redondos, el máximo señalado y una guía que
 * sigue al puntero (o a las flechas del teclado) con el valor de ese día. Los días sin
 * cifra no se dibujan como cero (lo dice la nota al pie de Resultados). Las cifras día a
 * día, como tabla, están en «Más detalle» (`DailyTable`).
 */
export function TrendChart({
  title,
  points,
  testId,
}: {
  /** Qué cifra se dibuja (también es el nombre accesible). */
  title: string;
  points: Point[];
  testId?: string;
}) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const height = width < 420 ? 170 : 220;
  const innerW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const missing = points.length - values.length;
  const max = Math.max(0, ...values);
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1] ?? 1;
  const x = (i: number) => MARGIN.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => MARGIN.top + innerH - (v / top) * innerH;
  const runs = useMemo(() => segments(points), [points]);
  const maxIndex = values.length ? points.findIndex((p) => p.value === max) : -1;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))));

  const nearest = (clientX: number, rect: DOMRect) => {
    if (!points.length) return null;
    const ratio = (clientX - rect.left - MARGIN.left) / innerW;
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };
  const onMove = (event: PointerEvent<SVGRectElement>) =>
    setActive(nearest(event.clientX, event.currentTarget.ownerSVGElement!.getBoundingClientRect()));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const last = points.length - 1;
    const keys: Record<string, number> = {
      ArrowLeft: Math.max(0, (active ?? last + 1) - 1),
      ArrowRight: Math.min(last, (active ?? -1) + 1),
      Home: 0,
      End: last,
    };
    if (event.key in keys) {
      event.preventDefault();
      setActive(keys[event.key]!);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };

  const shown = active !== null ? points[active] : undefined;
  const readout = shown
    ? `${dayLabel(shown.date)}: ${shown.value === null ? 'sin cifra' : formatNumber(shown.value)}`
    : values.length
      ? `Máximo: ${formatNumber(max)}${maxIndex >= 0 ? ` el ${dayLabel(points[maxIndex]!.date)}` : ''}`
      : 'Sin cifras en estos días';
  const label = `${title}: ${values.length} días con cifra${missing ? `, ${missing} sin cifra` : ''}; máximo ${formatNumber(max)}.`;

  return (
    <figure data-testid={testId} className="w-full min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm tabular-nums text-muted" role="status" aria-live="polite" data-testid="chart-readout">
          {readout}
        </p>
      </div>
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label={`${label} Usa las flechas para recorrer los días.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="relative w-full min-w-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        style={{ height }}
        data-testid="chart-area"
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="absolute left-0 top-0 block">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" className="fill-muted text-[11px]">
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={p.date} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted text-[11px]">
                {dayLabel(p.date)}
              </text>
            ) : null,
          )}
          {runs.map((run) =>
            run.length > 1 ? (
              <g key={run[0]!.i}>
                <path
                  d={`M${x(run[0]!.i)},${y(0)} ${run.map((r) => `L${x(r.i)},${y(r.value)}`).join(' ')} L${x(run[run.length - 1]!.i)},${y(0)} Z`}
                  className="fill-primary/10"
                />
                <path
                  d={run.map((r, k) => `${k ? 'L' : 'M'}${x(r.i)},${y(r.value)}`).join(' ')}
                  className="fill-none stroke-primary"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            ) : (
              <circle key={run[0]!.i} cx={x(run[0]!.i)} cy={y(run[0]!.value)} r={4} className="fill-primary stroke-surface" strokeWidth={2} />
            ),
          )}
          {maxIndex >= 0 && active === null && (
            <g>
              <circle cx={x(maxIndex)} cy={y(max)} r={4} className="fill-primary stroke-surface" strokeWidth={2} />
            </g>
          )}
          {shown && (
            <g>
              <line x1={x(active!)} x2={x(active!)} y1={MARGIN.top} y2={MARGIN.top + innerH} className="stroke-muted" strokeWidth={1} />
              {shown.value !== null && (
                <circle cx={x(active!)} cy={y(shown.value)} r={5} className="fill-primary stroke-surface" strokeWidth={2} />
              )}
            </g>
          )}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setActive(null)}
            data-testid="chart-hit"
          />
        </svg>
      </div>
    </figure>
  );
}

/** Las cifras día a día en una tabla: una columna por cifra. Va en «Más detalle». */
export function DailyTable({ series, testId }: { series: Array<{ title: string; points: Point[] }>; testId?: string }) {
  const id = useId();
  const days = series[0]?.points ?? [];
  if (!days.length) return null;
  return (
    <div className="max-h-64 overflow-auto" data-testid={testId}>
      <table className="w-full text-left text-xs" aria-labelledby={`${id}-t`}>
        <caption id={`${id}-t`} className="sr-only">
          Cifras día a día
        </caption>
        <thead className="text-muted">
          <tr>
            <th className="py-1 font-medium">Día</th>
            {series.map((s) => (
              <th key={s.title} className="py-1 text-right font-medium">
                {s.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((p, i) => (
            <tr key={p.date} className="border-t border-border">
              <td className="py-1">{dayLabel(p.date)}</td>
              {series.map((s) => {
                const value = s.points[i]?.value ?? null;
                return (
                  <td key={s.title} className="py-1 text-right tabular-nums">
                    {value === null ? '—' : formatNumber(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
