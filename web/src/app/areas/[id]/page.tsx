"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { MonthlyBars } from "@/components/charts";
import { GapCardView } from "@/components/gap";
import { PaperList } from "@/components/paper";
import { ReadingPath } from "@/components/reading";
import { Container } from "@/components/shell";
import { Button, Callout, ErrorState, ListSkeleton, SectionTitle, Select, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtInt, topicHref } from "@/lib/format";
import type { AreaDetail, AreaPapers } from "@/lib/types";

export default function AreaPage() {
  const { id } = useParams<{ id: string }>();
  const a = useQuery({ queryKey: ["area", id], queryFn: () => api.get<AreaDetail>(`/areas/${id}`) });
  const [sort, setSort] = useState<"cited" | "newest" | "central">("central");
  const [limit, setLimit] = useState(20);
  const papers = useQuery({
    queryKey: ["area-papers", id, sort, limit],
    queryFn: () => api.get<AreaPapers>(`/areas/${id}/papers`, { sort, limit }),
    placeholderData: (prev) => prev,
  });

  if (a.isError) return <Container><ErrorState error={a.error} title="This area couldn't be opened" /></Container>;
  if (!a.data) return <Container><ListSkeleton rows={4} /></Container>;
  const d = a.data;
  const facets = Object.entries(d.top_facets ?? {}).filter(([, v]) => v.length);

  return (
    <Container>
      <header className="mb-10">
        <p className="text-sm text-muted">
          <Link href="/areas" className="hover:text-ink">Research areas</Link>
        </p>
        <h1 className="serif mt-1 text-[2.5rem] leading-tight text-ink">{d.name}</h1>
        <p className="mt-2 max-w-[70ch] text-[1.0625rem] text-muted">Main terms: {d.keywords.join(", ")}.</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Tag tone="plain">{fmtInt(d.size)} papers</Tag>
          {d.quadrant ? <Tag tone="pen">{d.quadrant}</Tag> : null}
          {Object.entries(d.top_categories).slice(0, 4).map(([c, n]) => (
            <Tag key={c} tone="outline">{c} ({fmtInt(n)})</Tag>
          ))}
        </div>
        {d.advice ? <p className="mt-4 max-w-[70ch] text-ink-2">{d.advice}</p> : null}
        <Link href={topicHref(d.keywords.slice(0, 3).join(" "))} className="mt-3 inline-block font-medium text-pen underline underline-offset-4">
          Map this area as a topic
        </Link>
      </header>

      <section className="mb-12 grid gap-10 md:grid-cols-[1fr_20rem]">
        <MonthlyBars series={d.monthly} height={96} label="Papers per month in this area" partialLast />
        <div>
          <p className="text-sm text-muted">Growth against all of computer science</p>
          <p className="mt-1 text-[0.9375rem] text-ink-2">{d.growth_text}</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-medium">Window</th>
                <th className="py-1 text-right font-medium">Recent</th>
                <th className="py-1 text-right font-medium">Before</th>
                <th className="py-1 text-right font-medium">Relative</th>
              </tr>
            </thead>
            <tbody>
              {d.windows.map((w) => (
                <tr key={w.months} className="border-t border-line">
                  <td className="py-1">{w.months} months</td>
                  <td className="py-1 text-right tabular">{w.recent_count}</td>
                  <td className="py-1 text-right tabular">{w.previous_count}</td>
                  <td className="py-1 text-right tabular">{w.relative_growth != null && w.passes_gate ? `${w.relative_growth.toFixed(2)}×` : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {d.reading_path.length ? (
        <section className="mb-12">
          <SectionTitle>Read first</SectionTitle>
          <ReadingPath items={d.reading_path} />
        </section>
      ) : null}

      {d.gap_cards.length ? (
        <section className="mb-12">
          <SectionTitle meta="Found offline for the whole area">Open problems</SectionTitle>
          <div className="space-y-5">{d.gap_cards.map((c) => <GapCardView key={c.id} card={c} />)}</div>
        </section>
      ) : null}

      <div className="grid gap-12 lg:grid-cols-[1fr_20rem]">
        <section>
          <SectionTitle
            meta={
              <Select value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setLimit(20); }} className="h-8 w-44 text-sm" aria-label="Order papers">
                <option value="central">Most typical</option>
                <option value="cited">Most cited</option>
                <option value="newest">Newest</option>
              </Select>
            }
          >
            Papers
          </SectionTitle>
          {papers.data ? <PaperList hits={papers.data.results} showArea={false} /> : <ListSkeleton rows={4} />}
          {papers.data && papers.data.total > limit ? (
            <div className="mt-6 flex justify-center">
              <Button onClick={() => setLimit((l) => Math.min(100, l + 20))} loading={papers.isFetching} disabled={limit >= 100}>
                {limit >= 100 ? "Use search to see more" : "Show more"}
              </Button>
            </div>
          ) : null}
        </section>
        <aside className="space-y-8">
          {facets.length ? (
            <section>
              <h2 className="text-sm font-semibold text-ink">Common in this area</h2>
              <dl className="mt-2 space-y-3">
                {facets.map(([k, vals]) => (
                  <div key={k}>
                    <dt className="text-sm capitalize text-muted">{k}s</dt>
                    <dd className="text-[0.9375rem] text-ink-2">{vals.map((v) => `${v[0]} (${v[1]})`).join(", ")}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          <Callout tone="info">
            Areas come from clustering paper meanings. Their names are built from frequent terms, so they can read oddly. Papers
            that fit no area well are left unclustered.
          </Callout>
        </aside>
      </div>
    </Container>
  );
}
