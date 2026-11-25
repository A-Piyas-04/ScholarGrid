"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MonthlyBars } from "@/components/charts";
import { Container } from "@/components/shell";
import { Callout, ErrorState, ListSkeleton, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { AreaSummary, Trends } from "@/lib/types";

const ORDER = ["Emerging", "Hot & competitive", "Niche", "Mature"];

function OpportunityChart({ areas, onOpen }: { areas: AreaSummary[]; onOpen: (id: number) => void }) {
  const [hover, setHover] = useState<AreaSummary | null>(null);
  const W = 900;
  const H = 520;
  const pad = { l: 56, r: 20, t: 40, b: 92 };
  const strip = 62; // band for areas without a reliable growth signal
  const reliable = areas.filter((a) => a.reliable && a.growth != null);
  const gs = reliable.map((a) => a.growth as number);
  const lo = Math.min(0.5, ...gs) * 0.95;
  const hi = Math.max(1.6, ...gs) * 1.05;
  const plotB = H - pad.b - strip;
  const x = (c: number) => pad.l + c * (W - pad.l - pad.r);
  const y = (g: number) => pad.t + (1 - (g - lo) / (hi - lo)) * (plotB - pad.t);
  const maxSize = Math.max(...areas.map((a) => a.size), 1);
  const r = (s: number) => 4 + Math.sqrt(s / maxSize) * 14;
  const ticks = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3].filter((t) => t >= lo && t <= hi);

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Areas by crowdedness and growth">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={t === 1 ? 1.5 : 1} strokeDasharray={t === 1 ? "" : "2 4"} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{t}×</text>
          </g>
        ))}
        <line x1={x(0.5)} x2={x(0.5)} y1={pad.t} y2={plotB} stroke="var(--line-strong)" strokeDasharray="3 4" />
        <text x={x(0.25)} y={pad.t - 16} fontSize="13" fill="var(--muted)" textAnchor="middle">Emerging: growing, not crowded</text>
        <text x={x(0.75)} y={pad.t - 16} fontSize="13" fill="var(--muted)" textAnchor="middle">Hot &amp; competitive: growing and crowded</text>
        <text x={x(0.25)} y={plotB + 18} fontSize="13" fill="var(--muted)" textAnchor="middle">Niche</text>
        <text x={x(0.75)} y={plotB + 18} fontSize="13" fill="var(--muted)" textAnchor="middle">Mature</text>
        {[0, 0.5, 1].map((c) => (
          <text key={c} x={x(c)} y={plotB + strip + 26} fontSize="12" fill="var(--muted)" textAnchor={c === 0 ? "start" : c === 1 ? "end" : "middle"}>
            {c === 0 ? "least crowded" : c === 1 ? "most crowded" : "median"}
          </text>
        ))}
        <rect x={pad.l} y={plotB + 28} width={W - pad.l - pad.r} height={strip - 30} rx={6} fill="var(--surface-2)" />
        <text x={pad.l - 8} y={plotB + 28 + (strip - 30) / 2 + 4} fontSize="11.5" fill="var(--muted)" textAnchor="end">n/a</text>
        {areas.map((a) => {
          const ok = a.reliable && a.growth != null;
          const cx = x(a.crowdedness);
          const cy = ok ? y(a.growth as number) : plotB + 28 + (strip - 30) / 2;
          const rad = ok ? r(a.size) : 4;
          return (
            <circle
              key={a.id}
              cx={cx}
              cy={cy}
              r={rad}
              fill={ok ? "var(--pen)" : "var(--line-strong)"}
              fillOpacity={hover && hover.id !== a.id ? 0.25 : ok ? 0.55 : 0.8}
              stroke="var(--surface)"
              strokeWidth={2}
              className="cursor-pointer"
              onMouseEnter={() => setHover(a)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onOpen(a.id)}
            >
              <title>{a.name}</title>
            </circle>
          );
        })}
        <text x={(pad.l + W - pad.r) / 2} y={H - 18} textAnchor="middle" fontSize="13" fill="var(--muted)">
          Crowdedness: share of areas with fewer papers in the last 12 months
        </text>
        <text x={14} y={(pad.t + plotB) / 2} fontSize="13" fill="var(--muted)" transform={`rotate(-90 14 ${(pad.t + plotB) / 2})`} textAnchor="middle">
          Growth relative to all CS
        </text>
      </svg>
      {hover ? (
        <div className="pointer-events-none absolute right-3 top-3 w-72 rounded-[10px] border border-line bg-surface px-4 py-3 text-sm shadow-[0_12px_30px_-14px_rgba(19,32,44,.45)]">
          <p className="font-semibold text-ink">{hover.name}</p>
          <p className="mt-1 text-ink-2">{fmtInt(hover.size)} papers, {fmtInt(hover.recent_papers)} in the last 12 months</p>
          <p className="text-ink-2">
            {hover.reliable && hover.growth != null
              ? `${hover.growth.toFixed(2)}× the CS rate${hover.growth_ci ? ` (${hover.growth_ci[0].toFixed(2)}–${hover.growth_ci[1].toFixed(2)})` : ""}`
              : "No reliable growth signal"}
          </p>
          <p className="mt-1 text-muted">{hover.quadrant}</p>
        </div>
      ) : null}
    </figure>
  );
}

export default function TrendsPage() {
  const router = useRouter();
  const t = useQuery({ queryKey: ["trends"], queryFn: () => api.get<Trends>("/trends") });
  const grouped = useMemo(() => {
    const g: Record<string, AreaSummary[]> = {};
    for (const a of t.data?.areas ?? []) (g[a.quadrant] ??= []).push(a);
    Object.values(g).forEach((l) => l.sort((a, b) => b.recent_papers - a.recent_papers));
    return g;
  }, [t.data]);

  return (
    <Container>
      <PageHeader
        title="Trends"
        lead="Where is research growing, and how crowded is it? Fast growth often means strong competition; quiet areas can be good entry points if their problems matter."
      />
      {t.isError ? <ErrorState error={t.error} onRetry={() => t.refetch()} /> : null}
      {!t.data ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          {!t.data.sufficient_history ? (
            <Callout tone="warn" className="mb-6" title="Not enough history for growth">
              The collection spans too little time to compare periods reliably, so growth is shown as unavailable.
            </Callout>
          ) : null}
          <section className="rounded-[14px] border border-line bg-surface p-4 md:p-6">
            <OpportunityChart areas={t.data.areas} onOpen={(id) => router.push(`/areas/${id}`)} />
            <p className="mt-3 text-sm text-muted">
              Growth compares the last {t.data.default_window} months with the {t.data.default_window} before, against all of
              computer science. Only areas that pass the stability checks ({Math.round(t.data.ci_level * 100)}% interval, enough
              papers) get a height; the rest sit in the grey band. Dot size shows the number of papers. Select a dot to open the area.
            </p>
          </section>

          <section className="mt-12 grid gap-10 md:grid-cols-2">
            {ORDER.filter((q) => grouped[q]?.length).map((q) => (
              <div key={q}>
                <SectionTitle meta={`${grouped[q].length} areas`}>{q}</SectionTitle>
                <p className="text-[0.9375rem] text-muted">{t.data!.quadrants[q]}</p>
                <ul className="mt-3 space-y-1.5">
                  {grouped[q].slice(0, 8).map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3 text-[0.9375rem]">
                      <Link href={`/areas/${a.id}`} className="text-ink-2 hover:text-pen">{a.name}</Link>
                      <span className="shrink-0 text-sm text-faint tabular">
                        {fmtInt(a.recent_papers)} this year{a.reliable && a.growth != null ? `, ${a.growth.toFixed(2)}×` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="mt-12">
            <SectionTitle>The whole collection</SectionTitle>
            <MonthlyBars series={t.data.corpus_monthly} height={110} label="Papers per month in the collection" partialLast />
            <p className="mt-3 text-sm text-muted">
              The collection is a sample of arXiv computer science, stratified by category and month, so these counts show the
              sample&apos;s shape rather than arXiv&apos;s total volume.
            </p>
          </section>
        </>
      )}
    </Container>
  );
}
