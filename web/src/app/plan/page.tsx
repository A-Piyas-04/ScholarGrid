"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PlanExports, PlanView } from "@/components/plan";
import { Container } from "@/components/shell";
import { Button, Callout, EmptyState, ErrorState, JobProgress, Label, ListSkeleton, Select, Tag, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { topicHref } from "@/lib/format";
import { useBuild } from "@/lib/hooks";
import { useProject } from "@/lib/project";
import type { GapCard, GapsResult, Job, PlanDocument, PlanOptions, ProjectDetail, Workspace } from "@/lib/types";

function useCard(ws: string | null, project: string | null, gap: string | null) {
  return useQuery({
    queryKey: ["plan-card", ws, project, gap],
    enabled: !!gap && (!!ws || !!project),
    queryFn: async (): Promise<{ card: GapCard; topic: string }> => {
      if (ws) {
        const [g, w] = await Promise.all([api.get<GapsResult>(`/topics/${ws}/gaps`), api.get<Workspace>(`/topics/${ws}`)]);
        const card = [...g.cards, ...g.area_cards, ...g.already_explored].find((c) => c.id === gap);
        if (!card) throw new Error("This open problem is no longer in the topic's list. Open the topic again.");
        return { card, topic: w.query };
      }
      const p = await api.get<ProjectDetail>(`/projects/${project}`);
      const saved = p.gaps.find((g) => g.gap_id === gap);
      if (!saved) throw new Error("This open problem isn't saved in the project.");
      return { card: saved.payload as unknown as GapCard, topic: p.topic_query };
    },
  });
}

function PlanBuilder() {
  const sp = useSearchParams();
  const ws = sp.get("ws");
  const project = sp.get("project");
  const gap = sp.get("gap");
  const card = useCard(ws, project, gap);
  const opts = useQuery({ queryKey: ["plan-options"], queryFn: () => api.get<PlanOptions>("/plans/options"), staleTime: Infinity });
  const { savePlan, enabled } = useProject();
  const [weeks, setWeeks] = useState<number | null>(null);
  const [goal, setGoal] = useState("Bachelor/master thesis");
  const [compute, setCompute] = useState("Laptop only");
  const [background, setBackground] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  const build = useBuild<PlanDocument>((_, result) => result && setDoc(result));

  useEffect(() => {
    if (opts.data && weeks === null) setWeeks(opts.data.default_weeks);
  }, [opts.data, weeks]);

  if (!gap || (!ws && !project))
    return (
      <EmptyState title="Pick an open problem first" action={<Link href="/" className="font-medium text-pen underline">Map a topic</Link>}>
        Plans start from an open problem. Map a topic, open its open problems and choose “Make a plan for this”.
      </EmptyState>
    );
  if (card.isError) return <ErrorState error={card.error} title="The open problem couldn't be loaded" />;
  if (!card.data || !opts.data) return <ListSkeleton rows={2} />;
  const c = card.data.card;
  const topic = card.data.topic;
  const o = opts.data;

  const generate = (next = attempt) =>
    build.start(() =>
      api.post<Job>("/plans", {
        card: c,
        ws_key: ws,
        weeks: weeks ?? o.default_weeks,
        goal,
        compute_access: compute,
        background: background.slice(0, o.max_background_chars),
        attempt: next,
      }),
    );

  const running = build.state.phase === "running" || build.state.phase === "starting";
  return (
    <div className="grid gap-12 lg:grid-cols-[22rem_1fr]">
      <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <div>
          <p className="text-sm text-muted">
            Plan for an open problem in{" "}
            <Link href={topicHref(topic, "problems")} className="text-pen underline underline-offset-2">
              {topic || "your topic"}
            </Link>
          </p>
          <h1 className="serif mt-1 text-[1.5rem] leading-snug text-ink">{c.title}</h1>
          <p className="mt-2 text-[0.9375rem] text-ink-2">{c.statement}</p>
        </div>
        <form
          className="space-y-5 rounded-[10px] border border-line bg-surface p-5"
          onSubmit={(e) => {
            e.preventDefault();
            generate();
          }}
        >
          <div>
            <Label>Weeks you have</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Weeks you have">
              {o.weeks_options.map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={weeks === w}
                  onClick={() => setWeeks(w)}
                  className={clsx(
                    "h-9 min-w-12 rounded-[7px] border px-3 text-sm font-semibold tabular",
                    weeks === w ? "border-pen bg-pen text-on-pen" : "border-line-strong text-ink-2 hover:border-pen",
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="goal">What it is for</Label>
            <Select id="goal" value={goal} onChange={(e) => setGoal(e.target.value)}>
              {o.goals.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="compute">Compute you can use</Label>
            <Select id="compute" value={compute} onChange={(e) => setCompute(e.target.value)}>
              {o.compute.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="bg" hint="optional">Your background</Label>
            <Textarea
              id="bg"
              rows={3}
              maxLength={o.max_background_chars}
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              placeholder="e.g. comfortable with PyTorch, new to NLP"
            />
            <p className="mt-1 text-xs text-muted">
              Sent to the AI provider with the request. Free tiers may use it to improve their models, so leave out personal
              details.
            </p>
          </div>
          <Button type="submit" variant="primary" className="w-full" loading={running}>
            {doc ? "Write a new plan" : "Write my plan"}
          </Button>
        </form>
      </aside>

      <div className="min-w-0">
        {running ? (
          <JobProgress job={build.state.phase === "running" ? build.state.job : null} label="Starting…" />
        ) : build.state.phase === "error" ? (
          <ErrorState error={build.state.message} title="The plan couldn't be written" onRetry={() => generate()} />
        ) : doc ? (
          <>
            <div className="mb-8 flex flex-wrap items-center gap-2 border-b border-line pb-5">
              {enabled ? (
                <Button variant="primary" size="sm" onClick={() => savePlan(doc, { topic })}>
                  Save plan to project
                </Button>
              ) : null}
              <PlanExports doc={doc} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAttempt(attempt + 1);
                  generate(attempt + 1);
                }}
              >
                Try a different plan
              </Button>
            </div>
            <PlanView doc={doc} />
          </>
        ) : (
          <div className="graph-paper rounded-[14px] border border-line px-6 py-12 md:px-10">
            <h2 className="serif text-[1.875rem] leading-tight text-ink">A plan you can show a supervisor</h2>
            <p className="mt-3 max-w-[60ch] text-ink-2">
              It turns this open problem into a research question, hypotheses, baselines and datasets from the closest
              papers, a week-by-week timeline, risks and questions to ask. Every choice cites the paper it comes from.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Tag tone="outline">{c.evidence.length} evidence papers</Tag>
              <Tag tone="outline">{c.feasibility} feasibility</Tag>
            </div>
            <Callout tone="info" className="mt-6 max-w-[60ch]">
              Set your weeks, goal and compute on the left, then choose <b>Write my plan</b>. It uses one AI request; without
              AI the plan is filled in from a template.
            </Callout>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Container>
      <Suspense fallback={null}>
        <PlanBuilder />
      </Suspense>
    </Container>
  );
}
