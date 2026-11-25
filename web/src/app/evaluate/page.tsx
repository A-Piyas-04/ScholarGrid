"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { Container } from "@/components/shell";
import { Button, Callout, ErrorState, Input, ListSkeleton, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { JudgePool, JudgeQuery } from "@/lib/types";

const GRADES = [
  { g: 2, label: "Relevant", key: "2", cls: "border-verd bg-verd text-surface" },
  { g: 1, label: "Partly", key: "1", cls: "border-amber bg-amber text-surface" },
  { g: 0, label: "Not relevant", key: "0", cls: "border-brick bg-brick text-surface" },
];

export default function EvaluatePage() {
  const qc = useQueryClient();
  const queries = useQuery({ queryKey: ["judge-queries"], queryFn: () => api.get<JudgeQuery[]>("/judgments/queries") });
  const [query, setQuery] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const pool = useQuery({
    queryKey: ["judge-pool", query],
    queryFn: () => api.get<JudgePool>("/judgments/pool", { query: query! }),
    enabled: !!query,
  });

  const grade = async (paperId: string, g: number | null) => {
    qc.setQueryData<JudgePool>(["judge-pool", query], (old) =>
      old ? { ...old, candidates: old.candidates.map((c) => (c.paper_id === paperId ? { ...c, grade: g } : c)) } : old,
    );
    await api.post("/judgments", { query, paper_id: paperId, grade: g });
    qc.invalidateQueries({ queryKey: ["judge-queries"] });
  };

  const done = pool.data ? pool.data.candidates.filter((c) => c.grade != null).length : 0;

  return (
    <Container>
      <PageHeader
        title="Judge search results"
        lead="Real relevance labels make the search quality score honest, and they are what the model experiments (Kaggle notebooks) are measured against."
      />
      <div className="grid gap-10 lg:grid-cols-[19rem_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) setQuery(custom.trim());
            }}
          >
            <label htmlFor="cq" className="sr-only">Your own query</label>
            <Input id="cq" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add your own query" />
            <Button type="submit" size="md">Add</Button>
          </form>
          {queries.data ? (
            <ul className="scroll-thin max-h-[65vh] space-y-0.5 overflow-y-auto pr-1">
              {queries.data.map((q) => (
                <li key={q.query}>
                  <button
                    onClick={() => setQuery(q.query)}
                    className={clsx("flex w-full items-baseline justify-between gap-2 rounded-[7px] px-3 py-2 text-left text-sm", query === q.query ? "bg-pen-soft text-pen" : "text-ink-2 hover:bg-surface-2")}
                  >
                    <span>{q.query}</span>
                    <span className={clsx("shrink-0 tabular", q.n_judged ? "text-verd" : "text-faint")}>{q.n_judged || ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ListSkeleton rows={3} />
          )}
        </aside>
        <div className="min-w-0">
          {!query ? (
            <Callout tone="info" title="How to judge">
              Pick a query. You see the top results of several search methods mixed together, without scores or sources, so you
              judge each paper on its own. Mark whether it answers the query: relevant, partly, or not. Grades save as you go to{" "}
              <code>configs/search_judgments.json</code>.
            </Callout>
          ) : pool.isError ? (
            <ErrorState error={pool.error} onRetry={() => pool.refetch()} />
          ) : !pool.data ? (
            <ListSkeleton rows={4} />
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="serif text-[1.75rem] text-ink">“{pool.data.query}”</h2>
                <p className="text-sm text-muted tabular">{done} of {pool.data.candidates.length} judged</p>
              </div>
              <div className="mb-6 h-1.5 rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-verd transition-[width]" style={{ width: `${(done / Math.max(1, pool.data.candidates.length)) * 100}%` }} />
              </div>
              <ol className="divide-y divide-line">
                {pool.data.candidates.map((c) => (
                  <li key={c.paper_id} className="py-5">
                    <p className="serif text-[1.125rem] leading-snug text-ink">{c.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{fmtDate(c.date)}, {c.primary_category}</p>
                    <p className="mt-2 max-w-[78ch] text-[0.9375rem] leading-relaxed text-ink-2">{c.abstract}</p>
                    <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={`Relevance of ${c.title}`}>
                      {GRADES.map((g) => (
                        <button
                          key={g.g}
                          role="radio"
                          aria-checked={c.grade === g.g}
                          onClick={() => grade(c.paper_id, c.grade === g.g ? null : g.g)}
                          className={clsx("h-8 rounded-[7px] border px-3 text-sm font-semibold", c.grade === g.g ? g.cls : "border-line-strong text-ink-2 hover:border-ink")}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </Container>
  );
}
