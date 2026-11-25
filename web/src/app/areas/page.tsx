"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Sparkline } from "@/components/charts";
import { Container } from "@/components/shell";
import { ErrorState, Input, ListSkeleton, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { Trends } from "@/lib/types";

type Sort = "size" | "recent" | "growth" | "problems";

export default function AreasPage() {
  const t = useQuery({ queryKey: ["trends"], queryFn: () => api.get<Trends>("/trends") });
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("size");
  const areas = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let list = (t.data?.areas ?? []).filter(
      (a) => !f || a.name.toLowerCase().includes(f) || a.keywords.some((k) => k.toLowerCase().includes(f)),
    );
    const key: Record<Sort, (a: (typeof list)[number]) => number> = {
      size: (a) => a.size,
      recent: (a) => a.recent_papers,
      growth: (a) => (a.reliable && a.growth != null ? a.growth : -1),
      problems: (a) => a.stated_per_100 ?? -1,
    };
    list = [...list].sort((a, b) => key[sort](b) - key[sort](a));
    return list;
  }, [t.data, filter, sort]);

  return (
    <Container>
      <PageHeader
        title="Research areas"
        lead="The collection's papers grouped by meaning into areas. They are broad on purpose: map a topic to see the sub-problems inside your own interest."
      />
      {t.isError ? <ErrorState error={t.error} onRetry={() => t.refetch()} /> : null}
      {!t.data ? (
        <ListSkeleton rows={6} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-72">
              <label htmlFor="af" className="mb-1 block text-sm font-semibold">Find an area</label>
              <Input id="af" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. robot, privacy, graph" />
            </div>
            <div className="w-56">
              <label htmlFor="as" className="mb-1 block text-sm font-semibold">Order by</label>
              <Select id="as" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="size">Most papers</option>
                <option value="recent">Most papers this year</option>
                <option value="growth">Fastest reliable growth</option>
                <option value="problems">Most stated open problems</option>
              </Select>
            </div>
            <p className="pb-2 text-sm text-muted">{areas.length} of {t.data.areas.length} areas</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[0.9375rem]">
              <thead>
                <tr className="border-b border-line-strong text-left text-sm text-muted">
                  <th className="py-2 pr-4 font-semibold">Area</th>
                  <th className="py-2 pr-4 text-right font-semibold">Papers</th>
                  <th className="py-2 pr-4 font-semibold">Last 3 years</th>
                  <th className="py-2 pr-4 text-right font-semibold">Growth vs all CS</th>
                  <th className="py-2 pr-4 font-semibold">Situation</th>
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.id} className="border-b border-line align-top hover:bg-surface">
                    <td className="py-3 pr-4">
                      <Link href={`/areas/${a.id}`} className="font-medium text-ink hover:text-pen">
                        <span className="mr-2 inline-block size-2.5 rounded-[3px] align-middle" style={{ background: a.color }} aria-hidden />
                        {a.name}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted">{a.keywords.slice(0, 6).join(", ")}</p>
                    </td>
                    <td className="py-3 pr-4 text-right tabular">{fmtInt(a.size)}</td>
                    <td className="py-3 pr-4">
                      <Sparkline series={t.data!.area_monthly[String(a.id)] ?? {}} />
                    </td>
                    <td className="py-3 pr-4 text-right tabular">
                      {a.reliable && a.growth != null ? (
                        <span className={clsx(a.growth_ci && a.growth_ci[0] > 1 ? "text-verd" : a.growth_ci && a.growth_ci[1] < 1 ? "text-brick" : "text-ink-2")}>
                          {a.growth.toFixed(2)}×
                        </span>
                      ) : (
                        <span className="text-faint" title="Too few papers or too unstable to call a trend">not reliable</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ink-2">{a.quadrant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Container>
  );
}
