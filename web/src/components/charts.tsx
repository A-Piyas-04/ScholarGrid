"use client";

import { useMemo, useState } from "react";
import { fmtInt, fmtMonth } from "@/lib/format";

/** Fill missing months between the first and last key so gaps read as zero, not as adjacency. */
export function fillMonths(series: Record<string, number>, maxMonths = 0): [string, number][] {
  const keys = Object.keys(series).filter((k) => /^\d{4}-\d{2}/.test(k)).sort();
  if (!keys.length) return [];
  const out: [string, number][] = [];
  let [y, m] = keys[0].split("-").map(Number);
  const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push([k, series[k] ?? 0]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return maxMonths > 0 ? out.slice(-maxMonths) : out;
}

/**
 * Papers per month: one series, thin bars in the ink-blue, a hover readout, and the first/last month as the only
 * axis labels. ``partialLast`` greys the last bar when the month is not complete.
 */
export function MonthlyBars({
  series,
  height = 72,
  label = "Papers per month",
  partialLast = false,
  maxMonths = 48,
}: {
  series: Record<string, number>;
  height?: number;
  label?: string;
  partialLast?: boolean;
  maxMonths?: number;
}) {
  const data = useMemo(() => fillMonths(series, maxMonths), [series, maxMonths]);
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="text-sm text-muted">No dated papers.</p>;
  const max = Math.max(...data.map((d) => d[1]), 1);
  const n = data.length;
  const W = 600;
  const gap = 2;
  const bw = Math.max(1, (W - gap * (n - 1)) / n);
  const active = hover ?? n - 1;
  return (
    <figure className="w-full">
      <div className="flex items-baseline justify-between text-sm">
        <figcaption className="text-muted">{label}</figcaption>
        <span className="text-ink-2 tabular">
          {fmtMonth(data[active][0])}: <span className="font-semibold text-ink">{fmtInt(data[active][1])}</span>
          {partialLast && active === n - 1 ? <span className="text-faint"> (month not over)</span> : null}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="mt-1.5 block h-[var(--h)] w-full"
        style={{ ["--h" as string]: `${height}px` }}
        role="img"
        aria-label={`${label}, ${fmtMonth(data[0][0])} to ${fmtMonth(data[n - 1][0])}, peak ${fmtInt(max)}`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={height - 0.5} y2={height - 0.5} stroke="var(--line)" strokeWidth={1} />
        {data.map(([k, v], i) => {
          const h = v > 0 ? Math.max(2, (v / max) * (height - 4)) : 0;
          const x = i * (bw + gap);
          const partial = partialLast && i === n - 1;
          return (
            <g key={k} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={0} width={bw + gap} height={height} fill="transparent" />
              {h > 0 ? (
                <rect
                  x={x}
                  y={height - h}
                  width={bw}
                  height={h}
                  rx={Math.min(2, bw / 2)}
                  fill={partial ? "var(--line-strong)" : "var(--pen)"}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-faint tabular">
        <span>{fmtMonth(data[0][0])}</span>
        <span>{fmtMonth(data[n - 1][0])}</span>
      </div>
    </figure>
  );
}

/** A tiny trend line for lists (no axes; the row's text carries the numbers). */
export function Sparkline({ series, width = 96, height = 24 }: { series: Record<string, number>; width?: number; height?: number }) {
  const data = useMemo(() => fillMonths(series, 36), [series]);
  if (data.length < 2) return null;
  const max = Math.max(...data.map((d) => d[1]), 1);
  const pts = data.map(([, v], i) => `${((i / (data.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--pen)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Horizontal bar for a share (0..1) with its number beside it. */
export function ShareBar({ value, label }: { value: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span className="h-1.5 w-16 rounded-full bg-surface-2">
        <span className="block h-1.5 rounded-full bg-pen/70" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
      </span>
      <span className="text-xs text-muted tabular">{Math.round(value * 100)}%</span>
    </span>
  );
}
