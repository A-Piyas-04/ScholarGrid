"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { FolderPlus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { MonthlyBars } from "@/components/charts";
import { GapCardView } from "@/components/gap";
import { Highlighted, SavePaperButton } from "@/components/paper";
import { ReadingPath } from "@/components/reading";
import { Container } from "@/components/shell";
import { Button, Callout, EmptyState, ErrorState, JobProgress, ListSkeleton, Select, Tag } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtInt, paperHref, plural } from "@/lib/format";
import { useBuild } from "@/lib/hooks";
import { useProject, useToast } from "@/lib/project";
import type { GapCard, GapsResult, Job, JobStarted, Subtopic, Workspace, WsPaper } from "@/lib/types";

const BUILD_STEPS = [
  "Finding papers…",
  "Grouping into sub-topics…",
  "Writing plain-language summaries…",
  "Summarising the topic…",
  "Building your reading path…",
];
const GAP_STEPS = [
  "Collecting what authors say is still open…",
  "Looking inside each sub-topic…",
  "Writing and checking the cards…",
  "Adding cards from the wider area…",
];

const TABS = [
  { id: "map", label: "Sub-topics" },
  { id: "read", label: "Read first" },
  { id: "problems", label: "Open problems" },
  { id: "papers", label: "All papers" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ---------------------------------------------------------------------------
// Sub-topics
// ---------------------------------------------------------------------------
function SubtopicOutline({ ws, selected, onSelect }: { ws: Workspace; selected: number | null; onSelect: (id: number) => void }) {
  const top = ws.subtopics.filter((s) => s.parent === null);
  const max = Math.max(...top.map((s) => s.size), 1);
  return (
    <nav aria-label="Sub-topics">
      <ul className="space-y-0.5">
        {top.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              aria-current={selected === s.id ? "true" : undefined}
              className={clsx(
                "w-full rounded-[8px] px-3 py-2.5 text-left transition-colors",
                selected === s.id ? "bg-pen-soft" : "hover:bg-surface-2",
              )}
            >
              <span className={clsx("block font-medium leading-snug", selected === s.id ? "text-pen" : "text-ink")}>{s.name}</span>
              <span className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                <span className="h-1 flex-1 rounded-full bg-surface-2">
                  <span className="block h-1 rounded-full bg-pen/50" style={{ width: `${(s.size / max) * 100}%` }} />
                </span>
                <span className="tabular">{s.size} papers</span>
                {s.recently_active ? <span className="text-verd">active</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SubtopicDetail({ ws, sub, topic }: { ws: Workspace; sub: Subtopic; topic: string }) {
  const children = ws.subtopics.filter((s) => s.parent === sub.id);
  const byId = useMemo(() => new Map(ws.papers.map((p) => [p.paper_id, p])), [ws.papers]);
  const reps = sub.representative.map((id) => byId.get(id)).filter(Boolean) as WsPaper[];
  const facets = Object.entries(sub.top_facets ?? {}).filter(([, v]) => v.length);
  return (
    <div className="min-w-0">
      <h2 className="serif text-[1.875rem] leading-tight text-ink">{sub.name}</h2>
      <p className="mt-1 text-sm text-muted">
        {plural(sub.size, "paper")}
        {sub.n_collection < sub.size ? `, ${sub.size - sub.n_collection} found online` : ""}
        {sub.n_open_problems ? `, ${plural(sub.n_open_problems, "open problem")} stated by authors` : ""}
        {sub.name !== sub.keyword_label ? `. Keywords: ${sub.keywords.slice(0, 5).join(", ")}` : ""}
      </p>
      {sub.summary ? <p className="prose-read mt-4">{sub.summary}</p> : null}
      {!sub.summary && sub.keywords.length ? (
        <p className="mt-4 text-[0.9375rem] text-ink-2">Main terms: {sub.keywords.join(", ")}.</p>
      ) : null}
      {sub.beginner_entry ? (
        <div className="mt-5 rounded-[10px] border border-verd/25 bg-verd-soft px-4 py-3">
          <p className="text-sm font-semibold text-verd">Where a beginner could start</p>
          <p className="mt-0.5 text-[0.9375rem] text-ink-2">{sub.beginner_entry}</p>
        </div>
      ) : null}
      {sub.key_concepts.length ? (
        <section className="mt-7">
          <h3 className="text-sm font-semibold text-ink">Terms to know</h3>
          <dl className="mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {sub.key_concepts.map((c) => (
              <div key={c.term}>
                <dt className="font-medium text-ink">{c.term}</dt>
                <dd className="text-[0.9375rem] text-muted">{c.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <section className="mt-7 grid gap-8 md:grid-cols-[1fr_15rem]">
        <MonthlyBars series={sub.monthly} label="Papers per month in this sub-topic" />
        <div className="text-sm">
          <p className="text-muted">Share from the last 12 months</p>
          <p className="serif mt-1 text-[1.75rem] leading-none text-ink tabular">{Math.round(sub.recent_share * 100)}%</p>
          <p className="mt-1 text-muted">{sub.recently_active ? "Active right now." : "Steady or quieter lately."}</p>
        </div>
      </section>
      {facets.length ? (
        <section className="mt-7">
          <h3 className="text-sm font-semibold text-ink">Common in these papers</h3>
          <dl className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {facets.slice(0, 4).map(([k, vals]) => (
              <div key={k}>
                <dt className="text-sm capitalize text-muted">{k}s</dt>
                <dd className="text-[0.9375rem] text-ink-2">{vals.map((v) => `${v[0]} (${v[1]})`).join(", ")}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {children.length ? (
        <section className="mt-7">
          <h3 className="text-sm font-semibold text-ink">Inside this sub-topic</h3>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {children.map((c) => (
              <li key={c.id} className="rounded-[10px] border border-line px-4 py-3">
                <p className="font-medium text-ink">{c.name}</p>
                <p className="mt-0.5 text-sm text-muted">{plural(c.size, "paper")}</p>
                {c.summary ? <p className="mt-1.5 text-[0.9375rem] text-ink-2">{c.summary}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="mt-8">
        <h3 className="text-sm font-semibold text-ink">Most typical papers</h3>
        <ul className="mt-1 divide-y divide-line">
          {reps.map((p) => (
            <WsPaperRow key={p.paper_id} p={p} topic={topic} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function WsPaperRow({ p, topic, terms }: { p: WsPaper; topic: string; terms?: string[] }) {
  const external = !p.in_collection && p.url && !/^\d{4}\./.test(p.paper_id);
  return (
    <li className="grid grid-cols-[1fr_auto] gap-4 py-4">
      <div className="min-w-0">
        {external ? (
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="serif text-[1.0625rem] leading-snug text-ink hover:text-pen">
            {p.title}
          </a>
        ) : (
          <Link href={paperHref(p.paper_id)} className="serif text-[1.0625rem] leading-snug text-ink hover:text-pen">
            {p.title}
          </Link>
        )}
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
          <span>{fmtDate(p.date)}</span>
          {p.cited_by_count ? <span className="tabular">{fmtInt(p.cited_by_count)} citations</span> : null}
          {p.is_new ? <span className="text-amber">found online</span> : null}
        </p>
        {p.abstract ? (
          <p className="mt-1.5 max-w-[78ch] text-[0.9375rem] leading-relaxed text-ink-2">
            <Highlighted text={p.abstract} terms={terms} />
          </p>
        ) : null}
      </div>
      <SavePaperButton
        paperId={p.paper_id}
        topic={topic}
        compact
        source="topic"
        record={p.in_collection ? undefined : { paper_id: p.paper_id, title: p.title, url: p.url, date: p.date, cited_by_count: p.cited_by_count }}
      />
    </li>
  );
}

function SubtopicsTab({ ws, topic }: { ws: Workspace; topic: string }) {
  const top = ws.subtopics.filter((s) => s.parent === null);
  const [sel, setSel] = useState<number | null>(top[0]?.id ?? null);
  const sub = ws.subtopics.find((s) => s.id === sel) ?? top[0];
  if (!top.length)
    return (
      <EmptyState title="Too few papers to group">
        Only {ws.papers.length} papers matched. Try a broader phrase, or search instead.
      </EmptyState>
    );
  return (
    <div className="grid gap-10 lg:grid-cols-[19rem_1fr]">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-2 px-3 text-sm text-muted">
          {top.length} sub-topics, largest first
        </p>
        <SubtopicOutline ws={ws} selected={sub?.id ?? null} onSelect={setSel} />
      </div>
      {sub ? <SubtopicDetail ws={ws} sub={sub} topic={topic} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open problems
// ---------------------------------------------------------------------------
function ProblemsTab({ ws }: { ws: Workspace }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const gaps = useQuery({
    queryKey: ["gaps", ws.key],
    queryFn: async () => {
      try {
        return await api.get<GapsResult>(`/topics/${ws.key}/gaps`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
  const build = useBuild(() => qc.invalidateQueries({ queryKey: ["gaps", ws.key] }));
  const [recheckId, setRecheckId] = useState<string | null>(null);
  const recheck = useBuild<GapCard>((_, card) => {
    setRecheckId(null);
    if (card) {
      qc.setQueryData<GapsResult | null>(["gaps", ws.key], (old) =>
        old
          ? {
              ...old,
              cards: old.cards.map((c) => (c.id === card.id ? card : c)),
              area_cards: old.area_cards.map((c) => (c.id === card.id ? card : c)),
            }
          : old,
      );
      push({ tone: "ok", text: "Novelty check updated." });
    }
  });

  const startGaps = (refresh = false) =>
    build.start(() => api.post<JobStarted>(`/topics/${ws.key}/gaps`, {}, { refresh: refresh || undefined }));

  if (build.state.phase === "running" || build.state.phase === "starting")
    return <JobProgress job={build.state.phase === "running" ? build.state.job : null} steps={GAP_STEPS} />;
  if (gaps.isLoading) return <ListSkeleton rows={3} />;
  if (gaps.isError) return <ErrorState error={gaps.error} onRetry={() => gaps.refetch()} />;
  const data = gaps.data;
  if (!data)
    return (
      <div className="graph-paper rounded-[14px] border border-line px-6 py-10 md:px-10">
        <h2 className="serif max-w-[30ch] text-[1.875rem] leading-tight text-ink">What is still unsolved in “{ws.query}”?</h2>
        <p className="mt-3 max-w-[64ch] text-ink-2">
          ScholarGrid looks for problems that authors themselves call open, method and problem pairs nobody has tried,
          narrow evaluations and conflicting results. Each card quotes its evidence and is checked against recent papers.
        </p>
        <p className="mt-2 max-w-[64ch] text-sm text-muted">
          This takes about a minute and uses roughly 16 requests of the free AI allowance. Without AI the cards are
          written from templates.
        </p>
        {build.state.phase === "error" ? (
          <Callout tone="error" className="mt-4">
            {build.state.message}
          </Callout>
        ) : null}
        <Button variant="primary" size="lg" className="mt-6" onClick={() => startGaps()}>
          Find open problems
        </Button>
      </div>
    );

  const stats = data.stats ?? {};
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="serif text-[1.875rem] leading-tight text-ink">{plural(data.cards.length, "open problem")}</h2>
          <p className="mt-1 max-w-[70ch] text-[0.9375rem] text-muted">
            Ranked by evidence, novelty, feasibility, specificity and recency. Treat each as a lead to discuss with a
            supervisor: quiet areas in this collection do not prove that nobody has worked on something.
          </p>
        </div>
        <Button size="sm" onClick={() => startGaps(true)}>
          <RefreshCw className="size-3.5" aria-hidden /> Regenerate
        </Button>
      </div>
      {stats.quota_stopped ? (
        <Callout tone="warn" title="The free AI allowance ran out part-way">
          Some cards use template wording. Regenerate after the daily reset for full cards.
        </Callout>
      ) : null}
      {data.cards.length ? (
        <div className="space-y-5">
          {data.cards.map((c, i) => (
            <GapCardView
              key={c.id}
              card={c}
              topic={ws.query}
              defaultOpen={i === 0}
              planHref={`/plan?ws=${ws.key}&gap=${c.id}`}
              rechecking={recheckId === c.id}
              onRecheck={() => {
                setRecheckId(c.id);
                recheck.start(() => api.post<Job>("/gaps/recheck", { ws_key: ws.key, card: c }));
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No well-supported open problems here yet">
          The detectors need several papers that state the same problem, or enough extracted facets. Try a broader
          topic, or look at the cards from the wider area below.
        </EmptyState>
      )}
      {data.area_cards.length ? (
        <section>
          <h2 className="serif text-[1.5rem] text-ink">From the wider area</h2>
          <p className="mt-1 text-[0.9375rem] text-muted">Problems found offline for the research areas this topic sits in.</p>
          <div className="mt-4 space-y-5">
            {data.area_cards.map((c) => (
              <GapCardView key={c.id} card={c} topic={ws.query} planHref={`/plan?ws=${ws.key}&gap=${c.id}`} />
            ))}
          </div>
        </section>
      ) : null}
      {data.already_explored.length ? (
        <section>
          <h2 className="serif text-[1.5rem] text-ink">Already explored</h2>
          <p className="mt-1 text-[0.9375rem] text-muted">These looked open, but a recent paper seems to address them.</p>
          <div className="mt-4 space-y-5">
            {data.already_explored.map((c) => (
              <GapCardView key={c.id} card={c} topic={ws.query} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------
function PapersTab({ ws, topic }: { ws: Workspace; topic: string }) {
  const top = ws.subtopics.filter((s) => s.parent === null);
  const [sub, setSub] = useState<string>("all");
  const [order, setOrder] = useState<"relevance" | "newest" | "cited">("relevance");
  const [limit, setLimit] = useState(40);
  const papers = useMemo(() => {
    let ps = ws.papers.filter((p) => sub === "all" || String(p.subtopic) === sub || String(p.micro) === sub);
    if (order === "newest") ps = [...ps].sort((a, b) => b.date.localeCompare(a.date));
    if (order === "cited") ps = [...ps].sort((a, b) => b.cited_by_count - a.cited_by_count);
    return ps;
  }, [ws.papers, sub, order]);
  const terms = ws.query.split(/\s+/).filter((w) => w.length > 3);
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label htmlFor="subf" className="mb-1 block text-sm font-semibold">Sub-topic</label>
          <Select id="subf" value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="all">All sub-topics ({ws.papers.length})</option>
            {top.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name} ({s.size})
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <label htmlFor="ord" className="mb-1 block text-sm font-semibold">Order</label>
          <Select id="ord" value={order} onChange={(e) => setOrder(e.target.value as typeof order)}>
            <option value="relevance">Best match</option>
            <option value="newest">Newest</option>
            <option value="cited">Most cited</option>
          </Select>
        </div>
        <p className="pb-2 text-sm text-muted">{plural(papers.length, "paper")}</p>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {papers.slice(0, limit).map((p) => (
          <WsPaperRow key={p.paper_id} p={p} topic={topic} terms={terms} />
        ))}
      </ul>
      {papers.length > limit ? (
        <div className="mt-6 flex justify-center">
          <Button onClick={() => setLimit((l) => l + 60)}>Show more papers</Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function TopicView({ query }: { query: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (sp.get("tab") as TabId) || "map";
  const qc = useQueryClient();
  const [key, setKey] = useState<string | null>(null);
  const [fullOverview, setFullOverview] = useState(false);
  const { createProject, activeId, active } = useProject();
  const { push } = useToast();

  const build = useBuild((k) => {
    if (k) {
      setKey(k);
      qc.invalidateQueries({ queryKey: ["topic", k] });
      qc.invalidateQueries({ queryKey: ["recent-topics"] });
    }
  });
  const { start } = build;

  useEffect(() => {
    setKey(null);
    start(() => api.post<JobStarted>("/topics", { query }));
  }, [query, start]);

  const ws = useQuery({
    queryKey: ["topic", key],
    queryFn: () => api.get<Workspace>(`/topics/${key}`),
    enabled: !!key,
    staleTime: Infinity,
  });

  const setTab = (t: TabId) => router.replace(`/topic?q=${encodeURIComponent(query)}&tab=${t}`, { scroll: false });

  if (build.state.phase === "error")
    return (
      <ErrorState
        error={build.state.message}
        title="This topic couldn't be mapped"
        onRetry={() => start(() => api.post<JobStarted>("/topics", { query }))}
      />
    );
  if (!ws.data) {
    const job = build.state.phase === "running" ? build.state.job : null;
    return (
      <div className="mx-auto max-w-2xl py-6">
        <p className="text-sm text-muted">Mapping the topic</p>
        <h1 className="serif mb-6 mt-1 text-[2.25rem] leading-tight text-ink">{query}</h1>
        {ws.isError ? <ErrorState error={ws.error} /> : <JobProgress job={job} steps={BUILD_STEPS} label="Checking for a saved map…" />}
        <p className="mt-4 text-sm text-muted">
          The first time takes up to a minute: it searches the collection and live sources, groups the papers and asks the
          AI for plain-language summaries. After that it opens instantly.
        </p>
      </div>
    );
  }

  const w = ws.data;
  const top = w.subtopics.filter((s) => s.parent === null);
  const nLive = Number(w.stats?.n_live ?? 0);
  const saveAsProject = async () => {
    const p = await createProject(query.charAt(0).toUpperCase() + query.slice(1), query);
    push({ tone: "ok", text: `Created “${p.title}”. Saved items go there now.`, href: `/projects/${p.id}`, hrefLabel: "Open" });
  };

  return (
    <>
      <header className="mb-8">
        <p className="text-sm text-muted">
          Topic map: {plural(w.papers.length, "paper")}
          {nLive ? `, ${nLive} found online` : ""}, {top.length} sub-topics
        </p>
        <h1 className="serif mt-1 text-[2.5rem] leading-[1.08] tracking-[-0.015em] text-ink md:text-[3rem]">{w.query}</h1>
        {w.overview.summary ? (
          <div className="mt-4">
            <p className={clsx("prose-read text-[1.125rem]", !fullOverview && "line-clamp-3")}>{w.overview.summary}</p>
            {fullOverview && w.overview.how_they_relate ? <p className="prose-read mt-2 text-muted">{w.overview.how_they_relate}</p> : null}
            <button onClick={() => setFullOverview((v) => !v)} className="mt-1 text-sm font-medium text-pen underline underline-offset-2" aria-expanded={fullOverview}>
              {fullOverview ? "Show less" : "Read the full overview"}
            </button>
          </div>
        ) : null}
        {w.overview.prerequisites.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-sm font-semibold text-ink">Know these first:</span>
            {w.overview.prerequisites.map((p) => (
              <Tag key={p} tone="plain">{p}</Tag>
            ))}
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {!activeId || (active && active.topic_query !== query) ? (
            <Button size="sm" onClick={saveAsProject}>
              <FolderPlus className="size-4" aria-hidden /> Start a project for this topic
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => start(() => api.post<JobStarted>("/topics", { query, refresh: true }))}>
            <RefreshCw className="size-3.5" aria-hidden /> Rebuild
          </Button>
        </div>
        {w.warnings.length ? (
          <div className="mt-4 space-y-2">
            {w.warnings.map((m) => (
              <Callout key={m} tone="warn">{m}</Callout>
            ))}
          </div>
        ) : null}
      </header>

      <div role="tablist" aria-label="Topic sections" className="sticky top-16 z-30 -mx-4 mb-8 flex gap-1 overflow-x-auto border-b border-line bg-paper/95 px-4 backdrop-blur md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-[0.9375rem] font-semibold transition-colors",
              tab === t.id ? "border-pen text-pen" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.id === "read" && w.reading_path.length ? <span className="ml-1.5 font-normal text-faint tabular">{w.reading_path.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === "map" ? <SubtopicsTab ws={w} topic={query} /> : null}
      {tab === "read" ? (
        w.reading_path.length ? (
          <div className="max-w-[860px]">
            <p className="mb-8 max-w-[68ch] text-[1.0625rem] text-ink-2">
              A reading order for “{w.query}”, built from what the papers here cite and how recent and central they are.
              {Number(w.stats?.reference_coverage ?? 0) < 0.3 ? " Reference data is thin for this topic, so foundations may be missing." : ""}
            </p>
            <ReadingPath items={w.reading_path} topic={query} />
          </div>
        ) : (
          <EmptyState title="No reading path yet">There wasn&apos;t enough citation data to build one. Try the sub-topics&apos; typical papers.</EmptyState>
        )
      ) : null}
      {tab === "problems" ? <ProblemsTab ws={w} /> : null}
      {tab === "papers" ? <PapersTab ws={w} topic={query} /> : null}
    </>
  );
}

function TopicPage() {
  const q = (useSearchParams().get("q") ?? "").trim();
  return (
    <Container>
      {q ? (
        <TopicView query={q} />
      ) : (
        <EmptyState title="Which topic?" action={<Link href="/" className="font-medium text-pen underline">Describe a topic</Link>}>
          Open a topic from the start page.
        </EmptyState>
      )}
    </Container>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TopicPage />
    </Suspense>
  );
}
