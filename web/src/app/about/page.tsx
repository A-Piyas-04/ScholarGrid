"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Container } from "@/components/shell";
import { Callout, ErrorState, ListSkeleton, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtInt, pct } from "@/lib/format";
import type { Methodology } from "@/lib/types";

type Gate = { gate: string; value: unknown; threshold: unknown; op: string; passed: boolean; required: boolean };

const GATE_NAMES: Record<string, string> = {
  search_ndcg_at_10: "Search ranking quality (nDCG@10)",
  search_precision_at_10: "Relevant results in the top 10",
  min_span_months: "Months of history",
  max_noise_fraction: "Share of papers left unclustered",
  min_cluster_stability_ari: "Area stability across re-runs (ARI)",
  quality_checks: "Data quality checks",
};

function fmtVal(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? fmtInt(v) : v.toFixed(3);
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  return String(v ?? "");
}

export default function AboutPage() {
  const m = useQuery({ queryKey: ["methodology"], queryFn: () => api.get<Methodology>("/methodology") });
  return (
    <Container>
      <PageHeader
        title="How ScholarGrid works"
        lead="What the collection contains, how each feature is computed, how well it has been checked, and where it can mislead you."
      />
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.refetch()} /> : null}
      {!m.data ? (
        <ListSkeleton rows={5} />
      ) : (
        (() => {
          const d = m.data;
          const r = d.release;
          const val = d.validation as { gates?: { results?: Gate[]; passed?: boolean }; search?: Record<string, number>; clusters?: Record<string, number> };
          const cov = d.coverage as Record<string, unknown>;
          const enr = (cov.enrichment ?? {}) as Record<string, number>;
          const params = d.params as Record<string, Record<string, unknown>>;
          return (
            <div className="space-y-14">
              <section>
                <SectionTitle meta={`Release ${r.id}, built ${fmtDate(r.generated_at.slice(0, 10))}`}>The collection</SectionTitle>
                <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
                  <Stat value={fmtInt(r.n_papers)} label="computer-science papers" />
                  <Stat value={`${r.date_from.slice(0, 4)}–${r.date_to.slice(0, 4)}`} label={`${fmtDate(r.date_from)} to ${fmtDate(r.date_to)}`} />
                  <Stat value={r.n_areas} label="research areas" />
                  <Stat value={fmtInt(r.n_extracted)} label="papers read in full text" />
                </div>
                <div className="prose-read mt-8 space-y-3">
                  <p>
                    Papers come from arXiv ({r.source === "synthetic" ? "here: a synthetic demo corpus" : r.source.replace("_", " ")}),
                    sampled across {r.n_categories} categories and every month of the window so that no single field dominates.
                    Citations and references come from OpenAlex, which matched {pct(enr.match_rate)} of papers.
                  </p>
                  <p>
                    Search, topic maps and the assistant also ask arXiv, OpenAlex and Semantic Scholar live, so you see newer and
                    older papers too. Those papers are marked <em>found online</em>; they have no area, trend or extracted
                    problems.
                  </p>
                  {r.stale ? <p>This release is {r.data_age_days} days old.</p> : null}
                </div>
              </section>

              <section>
                <SectionTitle>How each part is made</SectionTitle>
                <dl className="grid gap-x-10 gap-y-6 md:grid-cols-2">
                  {[
                    ["Search", `Each paper's title and abstract is turned into a vector with ${String(params.embedding?.model_name ?? r.embedding_model)}. A query is matched by meaning (vectors), by keywords (BM25) and by exact phrase, and the rankings are fused. Known acronyms are expanded both ways.`],
                    ["Research areas", `Vectors are reduced with ${String((d.backends as Record<string, unknown>).reduce ?? "UMAP")} and grouped with ${String((d.backends as Record<string, unknown>).cluster ?? "HDBSCAN")}. Names come from the most distinctive terms in each group. Papers that fit no group stay unclustered.`],
                    ["Topic maps", "Your topic's most relevant papers (collection plus live sources) are re-grouped into 4 to 12 sub-topics. An AI writes plain-language names, summaries and key terms from the most typical papers; without AI you see keyword labels."],
                    ["Read first", "Surveys are recognised from titles and abstracts. Foundations are the works most often cited by the topic's papers (from OpenAlex references), including older papers outside the collection. Recent and frontier picks use citation rate and centrality."],
                    ["Open problems", "Built from what authors write in limitations and future-work sections (verified quotes), from method and problem pairs that never co-occur although they plausibly fit, from narrow evaluations, conflicting results and missing citation links. Each card is checked against recent papers before it is shown."],
                    ["Plans and briefs", "An AI drafts them from numbered evidence papers only. Citations to anything else are removed, and plans are checked for grounded baselines and datasets and a realistic timeline."],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-semibold text-ink">{k}</dt>
                      <dd className="mt-1 text-[0.9375rem] text-ink-2">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section>
                <SectionTitle meta={val.gates?.passed ? "all required checks passed" : "some checks did not pass"}>Quality checks for this release</SectionTitle>
                {val.gates?.results?.length ? (
                  <table className="w-full max-w-3xl text-[0.9375rem]">
                    <thead>
                      <tr className="border-b border-line-strong text-left text-sm text-muted">
                        <th className="py-2 font-semibold">Check</th>
                        <th className="py-2 text-right font-semibold">Value</th>
                        <th className="py-2 text-right font-semibold">Target</th>
                        <th className="py-2 pl-4 font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {val.gates.results.map((g) => (
                        <tr key={g.gate} className="border-b border-line">
                          <td className="py-2">{GATE_NAMES[g.gate] ?? g.gate}{g.required ? "" : <span className="text-faint"> (advisory)</span>}</td>
                          <td className="py-2 text-right tabular">{fmtVal(g.value)}</td>
                          <td className="py-2 text-right tabular text-muted">{g.op} {fmtVal(g.threshold)}</td>
                          <td className={`py-2 pl-4 font-medium ${g.passed ? "text-verd" : "text-brick"}`}>{g.passed ? "Passed" : "Did not pass"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-muted">No validation report in this release.</p>
                )}
                <Callout tone={d.judged_queries ? "info" : "warn"} className="mt-5 max-w-3xl" title="How search quality is measured">
                  {d.judged_queries ? (
                    <>Ranking quality uses hand-graded relevance for {d.judged_queries} queries plus heuristic grades for the rest.</>
                  ) : (
                    <>
                      The search score above uses heuristic grades (expected category and keywords), not human judgments, so it is
                      optimistic. Help fix this on the <Link href="/evaluate" className="text-pen underline">judging page</Link>.
                    </>
                  )}
                </Callout>
              </section>

              <section>
                <SectionTitle>Limits to keep in mind</SectionTitle>
                <ul className="prose-read list-disc space-y-2 pl-5">
                  <li>The collection is a sample of arXiv computer science. A topic that looks quiet here may be busy elsewhere, in other fields or outside arXiv.</li>
                  <li>An open-problem card is a lead, not proof. Sparse coverage, embedding similarity or a missing citation never shows that a problem is unsolved.</li>
                  <li>AI summaries can be wrong. Every claim links to its papers; open them before relying on a claim.</li>
                  <li>Citation counts favour older papers and popular fields; growth is only shown where it passes stability checks.</li>
                  <li>Abstracts stay under their own licences. Follow the links to read papers at the source.</li>
                </ul>
              </section>

              <section className="text-sm text-muted">
                <SectionTitle>Technical details</SectionTitle>
                <dl className="grid gap-x-10 gap-y-2 md:grid-cols-2">
                  <div><dt className="inline">Embedding model: </dt><dd className="inline text-ink-2 break-all">{r.embedding_model}</dd></div>
                  <div><dt className="inline">Search index: </dt><dd className="inline text-ink-2">{r.index}</dd></div>
                  <div><dt className="inline">Unclustered papers: </dt><dd className="inline text-ink-2">{fmtInt(Number(cov.noise ?? 0))}</dd></div>
                  <div><dt className="inline">Similarity and citation links: </dt><dd className="inline text-ink-2">{fmtInt(Number(cov.edges ?? 0))}</dd></div>
                  <div><dt className="inline">Stated open problems extracted: </dt><dd className="inline text-ink-2">{fmtInt(Number(cov.stated_problems ?? 0))}</dd></div>
                  <div><dt className="inline">Papers found online and stored: </dt><dd className="inline text-ink-2">{fmtInt(Number(cov.live_store_papers ?? 0))}</dd></div>
                </dl>
                <p className="mt-4">
                  Releases, models and quota live on the <Link href="/settings" className="text-pen underline">settings page</Link>.
                </p>
              </section>
            </div>
          );
        })()
      )}
    </Container>
  );
}
