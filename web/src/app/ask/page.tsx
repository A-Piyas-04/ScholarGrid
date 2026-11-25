"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Copy, Download, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Container } from "@/components/shell";
import { Button, Callout, ErrorState, JobProgress, Tag, Textarea } from "@/components/ui";
import { api, downloadText } from "@/lib/api";
import { fmtInt, paperHref } from "@/lib/format";
import { useBuild, useStatus } from "@/lib/hooks";
import { useProject, useToast } from "@/lib/project";
import type { Brief, BriefPoint, JobStarted } from "@/lib/types";

const STEPS = [
  "Planning the searches…",
  "Searching the analysed collection…",
  "Checking arXiv, OpenAlex and Semantic Scholar for newer papers…",
  "Reading the most relevant papers…",
  "Writing the brief with citations…",
  "Checking the citations…",
];

const TOOL_NAMES: Record<string, string> = {
  plan_searches: "Planned searches",
  search_collection: "Searched the collection",
  search_live: "Searched live sources",
  paper_details: "Read paper details",
};

function Cites({ ids, brief }: { ids: string[]; brief: Brief }) {
  const by = new Map(brief.evidence.map((e) => [e.eid, e]));
  return (
    <>
      {ids.map((id) => (
        <a key={id} href={`#ev-${id}`} title={by.get(id)?.title} className="ml-1 rounded-[4px] bg-pen-soft px-1 text-[0.8125rem] font-semibold text-pen tabular no-underline hover:underline">
          {id}
        </a>
      ))}
    </>
  );
}

function TextWithCites({ text, brief }: { text: string; brief: Brief }) {
  // "[P3, P4]" -> "[P3][P4]"
  const expanded = text.replace(/\[((?:P\d+\s*[,;]\s*)+P\d+)\]/g, (_, g: string) =>
    g.split(/[,;]/).map((x) => `[${x.trim()}]`).join(""),
  );
  const parts = expanded.split(/\[(P\d+)\]/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <Cites key={i} ids={[p]} brief={brief} /> : <span key={i}>{p}</span>))}
    </>
  );
}

function Point({ p, brief }: { p: BriefPoint; brief: Brief }) {
  return (
    <li>
      <TextWithCites text={p.text} brief={brief} />
      <Cites ids={p.cites.filter((c) => !p.text.includes(`[${c}]`))} brief={brief} />
    </li>
  );
}

function BriefView({ brief }: { brief: Brief }) {
  const { push } = useToast();
  const { enabled, activeId, active } = useProject();
  const [trace, setTrace] = useState(false);
  const saveNote = async () => {
    if (!activeId) {
      push({ tone: "error", text: "Open or create a project first (Projects page)." });
      return;
    }
    await api.post(`/projects/${activeId}/notes`, { body: brief.markdown.slice(0, 9900) });
    push({ tone: "ok", text: `Saved as a note in “${active?.title ?? "your project"}”.`, href: `/projects/${activeId}`, hrefLabel: "Open" });
  };
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_21rem]">
      <article className="min-w-0">
        <div className="flex flex-wrap gap-1.5">
          {brief.mode === "llm" ? <Tag tone="outline">Written by AI from {brief.coverage.n_papers} papers</Tag> : <Tag tone="amber">Extractive brief (no AI)</Tag>}
          <Tag tone="outline">{brief.coverage.n_cited} papers cited</Tag>
        </div>
        <h1 className="serif mt-3 text-[2rem] leading-tight text-ink md:text-[2.25rem]">{brief.question}</h1>
        <p className="serif mt-5 text-[1.25rem] leading-relaxed text-ink">
          <TextWithCites text={brief.answer} brief={brief} />
        </p>
        {brief.sections.map((s) => (
          <section key={s.heading} className="mt-9">
            <h2 className="serif text-[1.5rem] text-ink">{s.heading}</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[1rem] leading-relaxed text-ink-2">
              {s.points.map((p, i) => <Point key={i} p={p} brief={brief} />)}
            </ul>
          </section>
        ))}
        {brief.open_questions.length ? (
          <section className="mt-10 rounded-[14px] border border-line bg-surface px-5 py-5">
            <h2 className="serif text-[1.5rem] text-ink">Open questions to check</h2>
            <p className="mt-1 text-sm text-muted">Leads from what the papers say, not proven gaps. Map the topic to test them properly.</p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-2">
              {brief.open_questions.map((p, i) => <Point key={i} p={p} brief={brief} />)}
            </ul>
          </section>
        ) : null}
        <section className="mt-10 border-l-2 border-dashed border-amber pl-4">
          <h2 className="text-sm font-semibold text-ink">How much to trust this</h2>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[0.9375rem] text-ink-2">
            {brief.uncertainty.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </section>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(brief.markdown); push({ tone: "ok", text: "Brief copied as Markdown." }); }}>
            <Copy className="size-4" aria-hidden /> Copy
          </Button>
          <Button size="sm" onClick={() => downloadText("brief.md", brief.markdown, "text/markdown")}>
            <Download className="size-4" aria-hidden /> Markdown
          </Button>
          {enabled ? (
            <Button size="sm" onClick={saveNote}>
              <NotebookPen className="size-4" aria-hidden /> Save as a project note
            </Button>
          ) : null}
        </div>
        <section className="mt-8">
          <button onClick={() => setTrace((t) => !t)} className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink" aria-expanded={trace}>
            How this brief was made <ChevronDown className={`size-4 transition-transform ${trace ? "rotate-180" : ""}`} />
          </button>
          {trace ? (
            <div className="mt-3 text-sm text-ink-2">
              <p>Searches: {brief.queries.map((q) => `“${q}”`).join(", ")}</p>
              <ol className="mt-2 space-y-1">
                {brief.trace.map((t, i) => (
                  <li key={i} className="grid grid-cols-[1.5rem_1fr_auto] gap-2">
                    <span className="text-faint tabular">{i + 1}</span>
                    <span>
                      {TOOL_NAMES[t.tool] ?? t.tool}
                      {t.args.query ? `: “${String(t.args.query)}”` : t.args.paper_id ? `: ${String(t.args.paper_id)}` : ""}
                      {t.note ? <span className="text-amber"> ({t.note})</span> : null}
                    </span>
                    <span className="text-faint tabular">{t.n_results} found, {t.ms} ms</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-faint">Model: {brief.model}</p>
            </div>
          ) : null}
        </section>
      </article>
      <aside>
        <h2 className="text-sm font-semibold text-ink">Evidence</h2>
        <ol className="mt-2 space-y-3">
          {brief.evidence.map((e) => (
            <li key={e.eid} id={`ev-${e.eid}`} className="scroll-mt-28 border-t border-line pt-3">
              <span className="text-sm font-semibold text-pen tabular">{e.eid}</span>{" "}
              {e.in_collection || /^\d{4}\./.test(e.paper_id) ? (
                <Link href={paperHref(e.paper_id)} className="serif leading-snug text-ink hover:text-pen">{e.title}</Link>
              ) : (
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="serif leading-snug text-ink hover:text-pen">{e.title}</a>
              )}
              <p className="mt-0.5 text-xs text-muted">
                {e.year ?? "n.d."}
                {e.cited_by_count ? `, ${fmtInt(e.cited_by_count)} citations` : ""}
                {!e.in_collection ? ", found online" : ""}
              </p>
              {e.problems.length ? (
                <p className="serif mt-1 text-sm text-ink-2">“<span className="mark">{e.problems[0].quote || e.problems[0].statement}</span>”</p>
              ) : null}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function AskPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const q = sp.get("q") ?? "";
  const [text, setText] = useState(q);
  const [live, setLive] = useState(true);
  const [key, setKey] = useState<string | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const status = useStatus();
  const build = useBuild<{ key: string; brief: Brief }>((k, res) => {
    if (res?.brief) setBrief(res.brief);
    else if (k) setKey(k);
  });
  const { start } = build;
  const cached = useQuery({ queryKey: ["brief", key], queryFn: () => api.get<Brief>(`/assistant/brief/${key}`), enabled: !!key && !brief });
  const shown = brief ?? cached.data ?? null;

  useEffect(() => {
    setText(q);
    setBrief(null);
    setKey(null);
    if (q.trim().length >= 5) start(() => api.post<JobStarted>("/assistant/brief", { question: q, use_live: live }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, start]);

  const running = build.state.phase === "running" || build.state.phase === "starting";
  return (
    <Container>
      <form
        className="mb-10 max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 5) router.push(`/ask?q=${encodeURIComponent(text.trim())}`);
        }}
      >
        {!q ? (
          <>
            <h1 className="serif text-[2.5rem] leading-tight text-ink">Ask a research question</h1>
            <p className="mt-2 max-w-[62ch] text-[1.0625rem] text-muted">
              ScholarGrid searches for the most relevant papers, reads them, and writes a short brief. Every point cites its
              paper, and uncited claims are removed.
            </p>
          </>
        ) : null}
        <label htmlFor="question" className="sr-only">Your question</label>
        <Textarea
          id="question"
          rows={q ? 2 : 3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. What are the main ways to evaluate LLM agents, and what do they miss?"
          className="mt-5 text-[1.0625rem]"
          maxLength={500}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" disabled={text.trim().length < 5} loading={running}>
            Write a brief
          </Button>
          {status.data?.live_search ? (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="size-4 accent-[var(--pen)]" />
              Include papers found online
            </label>
          ) : null}
          {status.data && !status.data.llm.available ? (
            <span className="text-sm text-amber">No AI provider is available, so briefs list papers instead of summarising.</span>
          ) : null}
        </div>
      </form>

      {running ? (
        <div className="max-w-3xl">
          <JobProgress job={build.state.phase === "running" ? build.state.job : null} steps={STEPS} />
        </div>
      ) : build.state.phase === "error" ? (
        <div className="max-w-3xl"><ErrorState error={build.state.message} title="The brief couldn't be written" /></div>
      ) : shown ? (
        <BriefView brief={shown} />
      ) : !q ? (
        <Callout tone="info" className="max-w-3xl" title="Good questions are specific">
          Name the problem and the angle you care about: methods, evaluation, datasets, limitations or what is still open.
          For a full map of a field, use <Link href="/" className="text-pen underline">Map a topic</Link> instead.
        </Callout>
      ) : null}
    </Container>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AskPage />
    </Suspense>
  );
}
