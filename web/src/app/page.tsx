"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Container } from "@/components/shell";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, fmtDate, fmtInt, topicHref } from "@/lib/format";
import { useStatus } from "@/lib/hooks";
import { useProject } from "@/lib/project";
import type { RecentTopic } from "@/lib/types";

type Mode = "topic" | "search" | "ask";

const MODES: { id: Mode; label: string; placeholder: string; button: string; help: string }[] = [
  {
    id: "topic",
    label: "Map a topic",
    placeholder: "e.g. hallucination in retrieval-augmented generation",
    button: "Map this topic",
    help: "Groups the papers into sub-topics, suggests what to read first and finds open problems.",
  },
  {
    id: "search",
    label: "Search papers",
    placeholder: "e.g. speculative decoding on mobile devices",
    button: "Search",
    help: "Finds papers by meaning and by exact phrase, in the collection and live on arXiv, OpenAlex and Semantic Scholar.",
  },
  {
    id: "ask",
    label: "Ask a question",
    placeholder: "e.g. How do people reduce hallucination in RAG systems, and what is still open?",
    button: "Write a brief",
    help: "Reads the most relevant papers and writes a short answer where every point cites its paper.",
  },
];

const EXAMPLES: Record<Mode, string[]> = {
  topic: [
    "hallucination in retrieval-augmented generation",
    "graph neural networks for drug discovery",
    "privacy attacks on federated learning",
    "efficient transformer inference on edge devices",
  ],
  search: ["low-resource machine translation", "diffusion models for video generation", "LLM agents for software engineering"],
  ask: [
    "What are the main ways to evaluate LLM agents, and what do they miss?",
    "How is federated learning attacked, and which defences work?",
  ],
};

const STEPS = [
  { title: "Map the topic", body: "See the sub-problems inside your interest, each explained in plain language." },
  { title: "Read first", body: "An ordered path: surveys, the foundations everyone cites, then the newest work." },
  { title: "Find open problems", body: "Problems authors say are unsolved, each with quoted evidence and a novelty check." },
  { title: "Plan the first project", body: "A starter plan with baselines, datasets, milestones and risks, ready to show a supervisor." },
];

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("topic");
  const [text, setText] = useState("");
  const status = useStatus();
  const { projects } = useProject();
  const recent = useQuery({ queryKey: ["recent-topics"], queryFn: () => api.get<RecentTopic[]>("/topics", { limit: 6 }) });
  const r = status.data?.release;
  const m = MODES.find((x) => x.id === mode)!;

  const go = (value: string, as: Mode = mode) => {
    const v = value.trim();
    if (v.length < 2) return;
    if (as === "topic") router.push(topicHref(v));
    else if (as === "search") router.push(`/search?q=${encodeURIComponent(v)}`);
    else router.push(`/ask?q=${encodeURIComponent(v)}`);
  };

  return (
    <>
      <section className="graph-paper -mt-8 border-b border-line md:-mt-10">
        <Container className="py-16 md:py-24">
          <div className="max-w-[860px]">
            <h1 className="serif text-[2.75rem] leading-[1.04] tracking-[-0.02em] text-ink md:text-[4.25rem]">
              What do you want to research?
            </h1>
            <p className="mt-4 max-w-[58ch] text-[1.125rem] text-muted">
              Start from a vague interest. ScholarGrid shows you the field&apos;s sub-problems, what to read first, and
              which problems are still open, with the papers behind every claim.
            </p>

            <form
              className="mt-9 rounded-[14px] border border-line-strong bg-surface p-2 shadow-[0_18px_40px_-24px_rgba(19,32,44,.45)]"
              onSubmit={(e) => {
                e.preventDefault();
                go(text);
              }}
            >
              <div role="tablist" aria-label="What to do" className="flex flex-wrap gap-1 px-1 pt-1">
                {MODES.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === x.id}
                    onClick={() => setMode(x.id)}
                    className={clsx(
                      "rounded-[7px] px-3 py-1.5 text-sm font-semibold transition-colors",
                      mode === x.id ? "bg-ink text-paper" : "text-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <label htmlFor="start-input" className="sr-only">
                  {m.label}
                </label>
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
                  <input
                    id="start-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={m.placeholder}
                    maxLength={mode === "ask" ? 500 : 300}
                    autoFocus
                    className="h-14 w-full rounded-[10px] bg-transparent pl-12 pr-4 text-[1.125rem] text-ink placeholder:text-faint focus:outline-none"
                  />
                </div>
                <Button type="submit" variant="primary" size="lg" className="h-14 px-6" disabled={text.trim().length < 2}>
                  {m.button}
                </Button>
              </div>
              <p className="px-3 pb-2 pt-1 text-sm text-muted">{m.help}</p>
            </form>

            <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-2 text-[0.9375rem]">
              <span className="text-muted">Try</span>
              {EXAMPLES[mode].map((ex) => (
                <button key={ex} onClick={() => go(ex)} className="text-left text-pen underline decoration-pen/30 underline-offset-4 hover:decoration-pen">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <Container className="mt-14 grid gap-14 lg:grid-cols-[1.35fr_1fr]">
        <section aria-labelledby="journey">
          <h2 id="journey" className="serif text-[1.75rem] text-ink">
            From interest to a first project
          </h2>
          <ol className="mt-6 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2.25rem_1fr] gap-3">
                <span className="serif flex size-9 items-center justify-center rounded-full border border-ink text-lg text-ink tabular">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-ink">{s.title}</h3>
                  <p className="mt-1 text-[0.9375rem] text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          {r ? (
            <p className="mt-10 max-w-[62ch] border-t border-line pt-5 text-[0.9375rem] text-muted">
              The collection holds <span className="text-ink">{fmtInt(r.n_papers)}</span> computer-science papers from arXiv,{" "}
              {fmtDate(r.date_from)} to {fmtDate(r.date_to)}, grouped into {r.n_areas} research areas
              {r.n_extracted ? (
                <>
                  , with open problems read from the full text of {fmtInt(r.n_extracted)} papers
                </>
              ) : null}
              . {status.data?.live_search ? "Search also asks arXiv, OpenAlex and Semantic Scholar live, so newer and older papers show up too." : null}{" "}
              <Link href="/about" className="text-pen underline underline-offset-2">
                How it works
              </Link>
            </p>
          ) : null}
        </section>

        <aside className="space-y-10">
          <section aria-labelledby="recent">
            <h2 id="recent" className="text-lg font-semibold text-ink">
              Recent topics
            </h2>
            {recent.data && recent.data.length ? (
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {recent.data.map((t) => (
                  <li key={t.key}>
                    <Link href={topicHref(t.query)} className="flex items-baseline justify-between gap-4 py-3 hover:text-pen">
                      <span className="serif text-[1.0625rem] text-ink-2">{t.query}</span>
                      <span className="shrink-0 text-sm text-faint">{ago(t.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[0.9375rem] text-muted">Topics you map appear here, so you can come back to them.</p>
            )}
          </section>
          {projects.length ? (
            <section aria-labelledby="your-projects">
              <h2 id="your-projects" className="text-lg font-semibold text-ink">
                Your projects
              </h2>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {projects.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="flex items-baseline justify-between gap-4 py-3 hover:text-pen">
                      <span className="text-ink-2">{p.title}</span>
                      <span className="shrink-0 text-sm text-faint tabular">
                        {p.counts.papers} papers, {p.counts.gaps} problems
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </Container>
    </>
  );
}
