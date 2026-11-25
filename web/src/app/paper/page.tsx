"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SavePaperButton } from "@/components/paper";
import { Container } from "@/components/shell";
import { Button, Callout, ErrorState, ListSkeleton, Skeleton, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtInt, paperHref, shortAuthors, topicHref } from "@/lib/format";
import { useToast } from "@/lib/project";
import type { PaperDetail, SimilarResult, TextOut } from "@/lib/types";

const FACET_NAMES: Record<string, string> = {
  task: "Problems studied",
  method: "Methods",
  dataset: "Datasets",
  metric: "Metrics",
  domain: "Application domains",
  language: "Languages",
  modality: "Data types",
  contribution: "Type of contribution",
};

const EVAL_NAMES: Record<string, string> = {
  real_world: "real-world setting",
  human_eval: "human evaluation",
  robustness: "robustness",
  efficiency_reported: "efficiency",
  low_resource: "low-resource setting",
  multilingual: "several languages",
};

function PaperView({ id }: { id: string }) {
  const { push } = useToast();
  const paper = useQuery({ queryKey: ["paper", id], queryFn: () => api.get<PaperDetail>("/papers/detail", { id }) });
  const similar = useQuery({
    queryKey: ["similar", id],
    queryFn: () => api.get<SimilarResult>("/papers/similar", { id, k: 10 }),
    enabled: paper.isSuccess,
  });

  if (paper.isError) return <ErrorState error={paper.error} title="This paper couldn't be opened" onRetry={() => paper.refetch()} />;
  if (!paper.data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        <ListSkeleton rows={2} />
      </div>
    );
  const p = paper.data;
  const links = p.links;
  const facets = Object.entries(p.facets ?? {}).filter(([, v]) => v.length);
  const evals = Object.entries(p.profile?.evaluation ?? {}).filter(([, v]) => v === true);

  const copyBib = async () => {
    const out = await api.post<TextOut>("/papers/bibtex", { paper_ids: [p.paper_id] });
    try {
      await navigator.clipboard.writeText(out.content);
      push({ tone: "ok", text: "BibTeX copied." });
    } catch {
      push({ tone: "error", text: "Couldn't copy; your browser blocked the clipboard." });
    }
  };

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_20rem]">
      <article className="min-w-0">
        <div className="flex flex-wrap gap-1.5">
          {p.area ? (
            <Link href={`/areas/${p.area.id}`}>
              <Tag tone="pen" className="hover:underline">{p.area.name}</Tag>
            </Link>
          ) : null}
          {p.primary_category ? <Tag tone="outline">{p.primary_category}</Tag> : null}
          {p.is_survey ? <Tag tone="verd">Survey</Tag> : null}
          {!p.in_collection ? (
            <Tag tone="amber" title="Found by live search; areas, trends and extracted problems are not available for it">
              Found online
            </Tag>
          ) : null}
        </div>
        <h1 className="serif mt-4 text-[2rem] leading-[1.15] tracking-[-0.01em] text-ink md:text-[2.5rem]">{p.title}</h1>
        <p className="mt-3 text-[1.0625rem] text-ink-2">{shortAuthors(p.authors, 8)}</p>
        <p className="mt-1 flex flex-wrap gap-x-4 text-[0.9375rem] text-muted">
          {p.date ? <span>{fmtDate(p.date)}</span> : null}
          {p.venue ? <span className="italic">{p.venue}</span> : null}
          {p.cited_by_count ? <span className="tabular">{fmtInt(p.cited_by_count)} citations</span> : null}
          {p.reference_count ? <span className="tabular">{fmtInt(p.reference_count)} references</span> : null}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <SavePaperButton paperId={p.paper_id} record={p.in_collection ? undefined : { ...p, authors: p.authors.join("; "), url: links.abs }} />
          {links.abs ? (
            <a href={links.abs} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface px-3 text-sm font-medium text-ink-2 hover:border-pen hover:text-pen">
              <ExternalLink className="size-4" aria-hidden /> {p.arxiv_id ? "arXiv page" : "Source"}
            </a>
          ) : null}
          {links.html ? (
            <a href={links.html} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface px-3 text-sm font-medium text-ink-2 hover:border-pen hover:text-pen">
              <FileText className="size-4" aria-hidden /> Read full text
            </a>
          ) : null}
          {links.pdf ? (
            <a href={links.pdf} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-[7px] px-3 text-sm font-medium text-muted hover:text-pen">
              PDF
            </a>
          ) : null}
          {links.doi ? (
            <a href={links.doi} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-[7px] px-3 text-sm font-medium text-muted hover:text-pen">
              DOI
            </a>
          ) : null}
          {links.semantic_scholar ? (
            <a href={links.semantic_scholar} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-[7px] px-3 text-sm font-medium text-muted hover:text-pen">
              Semantic Scholar
            </a>
          ) : null}
          <Button size="sm" variant="ghost" className="h-9" onClick={copyBib}>
            <Copy className="size-4" aria-hidden /> Copy BibTeX
          </Button>
        </div>

        {p.profile?.summary ? (
          <section className="mt-9">
            <h2 className="text-sm font-semibold text-ink">In one sentence</h2>
            <p className="serif mt-1 text-[1.25rem] leading-snug text-ink">{p.profile.summary}</p>
            <p className="mt-1 text-xs text-faint">Summarised by AI from the paper. Check the abstract for the authors&apos; own words.</p>
          </section>
        ) : null}

        <section className="mt-9">
          <h2 className="serif text-[1.375rem] text-ink">Abstract</h2>
          <p className="prose-read mt-2 whitespace-pre-line">{p.abstract || "No abstract is available for this paper."}</p>
        </section>

        {p.problems.length ? (
          <section className="mt-10" aria-labelledby="open">
            <h2 id="open" className="serif text-[1.375rem] text-ink">
              What the authors say is still open
            </h2>
            <p className="mt-1 text-sm text-muted">
              Read from the paper&apos;s limitations and future-work sections. Highlighted text is quoted word for word.
            </p>
            <ul className="mt-4 space-y-5">
              {p.problems.map((pr) => (
                <li key={pr.problem_id} className="border-l-2 border-mark pl-4">
                  <p className="text-ink">{pr.statement}</p>
                  {pr.quote ? (
                    <blockquote className="serif mt-2 text-[1.0625rem] leading-relaxed text-ink-2">
                      “<span className="mark">{pr.quote}</span>”
                    </blockquote>
                  ) : null}
                  <p className="mt-1.5 text-sm text-muted">
                    {pr.section_kind ? <>From the {pr.section_kind.replace(/_/g, " ")} section. </> : null}
                    {pr.anchor_url ? (
                      <a href={pr.anchor_url} target="_blank" rel="noopener noreferrer" className="text-pen underline underline-offset-2">
                        Open at this passage
                      </a>
                    ) : null}
                    {!pr.verified ? <span className="ml-2 text-amber">Quote not verified against the text.</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {p.findings.length ? (
          <section className="mt-10">
            <h2 className="serif text-[1.375rem] text-ink">Reported results</h2>
            <ul className="mt-3 space-y-3">
              {p.findings.map((f, i) => (
                <li key={i} className="text-[0.9375rem] text-ink-2">
                  {f.claim}
                  <span className="mt-0.5 block text-sm text-muted">
                    {[f.task, f.dataset, f.metric].filter(Boolean).join(", ")}
                    {f.compared_to ? `; compared with ${f.compared_to}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>

      <aside className="space-y-9">
        {facets.length || p.profile ? (
          <section>
            <h2 className="text-sm font-semibold text-ink">What this paper works with</h2>
            <dl className="mt-3 space-y-3 text-[0.9375rem]">
              {facets.map(([k, vals]) => (
                <div key={k}>
                  <dt className="text-sm text-muted">{FACET_NAMES[k] ?? k}</dt>
                  <dd className="mt-0.5 text-ink-2">{vals.join(", ")}</dd>
                </div>
              ))}
              {p.profile?.code_url ? (
                <div>
                  <dt className="text-sm text-muted">Code</dt>
                  <dd className="mt-0.5 break-all">
                    <a href={p.profile.code_url} target="_blank" rel="noopener noreferrer" className="text-pen underline">
                      {p.profile.code_url.replace(/^https?:\/\//, "")}
                    </a>
                  </dd>
                </div>
              ) : null}
              {p.profile && p.profile.compute !== "unknown" ? (
                <div>
                  <dt className="text-sm text-muted">Compute used</dt>
                  <dd className="mt-0.5 text-ink-2">{p.profile.compute}</dd>
                </div>
              ) : null}
              {evals.length ? (
                <div>
                  <dt className="text-sm text-muted">Evaluated on</dt>
                  <dd className="mt-0.5 text-ink-2">{evals.map(([k]) => EVAL_NAMES[k] ?? k).join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        <section>
          <h2 className="text-sm font-semibold text-ink">Papers like this one</h2>
          {similar.isLoading ? <Skeleton className="mt-3 h-40" /> : null}
          {similar.data?.results.length ? (
            <ul className="mt-2 divide-y divide-line">
              {similar.data.results.map((s) => (
                <li key={s.paper_id} className="py-2.5">
                  <Link href={paperHref(s.paper_id)} className="serif block leading-snug text-ink-2 hover:text-pen">
                    {s.title}
                  </Link>
                  <span className="text-xs text-faint">
                    {s.date.slice(0, 4)}
                    {s.cited_by_count ? `, ${fmtInt(s.cited_by_count)} citations` : ""}
                    {!s.in_collection ? ", found online" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : similar.isSuccess ? (
            <p className="mt-2 text-sm text-muted">No similar papers found.</p>
          ) : null}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Go deeper</h2>
          <p className="mt-1 text-sm text-muted">Map this paper&apos;s topic to see its sub-problems and open questions.</p>
          <Link href={topicHref(p.title.slice(0, 120))} className="mt-2 inline-block text-[0.9375rem] font-medium text-pen underline underline-offset-4">
            Map this paper&apos;s topic
          </Link>
        </section>
        {!p.in_collection ? (
          <Callout tone="info">This paper came from a live source. Its abstract and metadata are as the source reported them.</Callout>
        ) : null}
      </aside>
    </div>
  );
}

function PaperPage() {
  const id = useSearchParams().get("id") ?? "";
  return <Container>{id ? <PaperView id={id} /> : <ErrorState error="No paper id in the link." title="Missing paper" />}</Container>;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaperPage />
    </Suspense>
  );
}
