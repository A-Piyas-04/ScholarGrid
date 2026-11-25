"use client";

import { Copy, Download } from "lucide-react";
import Link from "next/link";
import { api, downloadText } from "@/lib/api";
import { paperHref } from "@/lib/format";
import { useToast } from "@/lib/project";
import type { PlanDocument, TextOut } from "@/lib/types";
import { Button, Callout, Tag } from "./ui";

const CONTRIBUTION: Record<string, string> = {
  new_method: "A new method",
  empirical_study: "An empirical study",
  benchmark_or_dataset: "A benchmark or dataset",
  reproduction: "A reproduction",
  system_or_tool: "A system or tool",
  analysis: "An analysis",
};

type Ref = { rid: string; paper_id: string; title: string; year?: number | null; url?: string; role?: string };

function RefLink({ rid, refs }: { rid: string; refs: Map<string, Ref> }) {
  const r = refs.get(rid.replace(/[[\]]/g, ""));
  if (!r) return <span className="text-faint">[{rid}]</span>;
  return (
    <a href={`#ref-${r.rid}`} className="text-pen tabular no-underline hover:underline" title={r.title}>
      [{r.rid}]
    </a>
  );
}

/** Replace [R3] markers in text with links to the reference list. */
function WithRefs({ text, refs }: { text: string; refs: Map<string, Ref> }) {
  const parts = text.split(/(\[R\d+\])/g);
  return (
    <>
      {parts.map((p, i) => (/^\[R\d+\]$/.test(p) ? <RefLink key={i} rid={p.slice(1, -1)} refs={refs} /> : <span key={i}>{p}</span>))}
    </>
  );
}

function List({ items, refs }: { items: string[]; refs: Map<string, Ref> }) {
  return (
    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-2">
      {items.map((x, i) => (
        <li key={i}>
          <WithRefs text={x} refs={refs} />
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h3 className="serif text-[1.375rem] text-ink">{title}</h3>
      <div className="mt-1 text-[1rem] leading-relaxed">{children}</div>
    </section>
  );
}

export function PlanExports({ doc }: { doc: PlanDocument }) {
  const { push } = useToast();
  const get = async (format: "markdown" | "json" | "bibtex" | "email") => api.post<TextOut>("/plans/export", { doc, format });
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={async () => { const o = await get("markdown"); downloadText(o.filename, o.content, o.media_type); }}>
        <Download className="size-4" aria-hidden /> Markdown
      </Button>
      <Button size="sm" onClick={async () => { const o = await get("bibtex"); downloadText(o.filename, o.content, o.media_type); }}>
        <Download className="size-4" aria-hidden /> BibTeX
      </Button>
      <Button size="sm" onClick={async () => { const o = await get("json"); downloadText(o.filename, o.content, o.media_type); }}>
        <Download className="size-4" aria-hidden /> JSON
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          const o = await get("email");
          try {
            await navigator.clipboard.writeText(o.content);
            push({ tone: "ok", text: "Email to a supervisor copied. Edit it before sending." });
          } catch {
            downloadText(o.filename, o.content, o.media_type);
          }
        }}
      >
        <Copy className="size-4" aria-hidden /> Copy email to a supervisor
      </Button>
    </div>
  );
}

export function PlanView({ doc }: { doc: PlanDocument }) {
  const p = doc.plan;
  const refs = new Map<string, Ref>((doc.references as Ref[]).map((r) => [r.rid, r]));
  const c = doc.computed as {
    venues?: [string, number][];
    people?: { name: string; papers: number; url: string }[];
    code_links?: { paper_id: string; title: string; code_url: string }[];
    dataset_counts?: [string, number][];
  };
  const template = doc.generated_by?.mode === "template";
  return (
    <article className="max-w-[900px]">
      <div className="flex flex-wrap gap-1.5">
        <Tag tone="pen">{CONTRIBUTION[p.contribution_type] ?? p.contribution_type}</Tag>
        <Tag tone="outline">{String(doc.inputs?.weeks ?? "")} weeks</Tag>
        {doc.inputs?.goal ? <Tag tone="outline">{String(doc.inputs.goal)}</Tag> : null}
        {template ? <Tag tone="amber">Written from a template</Tag> : <Tag tone="outline">Drafted by AI from {refs.size} papers</Tag>}
      </div>
      <h2 className="serif mt-4 text-[2rem] leading-tight text-ink md:text-[2.375rem]">{p.title}</h2>
      <p className="serif mt-4 text-[1.3125rem] leading-snug text-ink">
        <WithRefs text={p.research_question} refs={refs} />
      </p>
      {p.why_it_matters ? (
        <p className="prose-read mt-3">
          <WithRefs text={p.why_it_matters} refs={refs} />
        </p>
      ) : null}
      {doc.warnings?.length ? (
        <Callout tone="info" className="mt-5" title="Checks on this plan">
          <ul className="list-disc pl-4">
            {doc.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {p.sub_questions.length ? <Block title="Sub-questions"><List items={p.sub_questions} refs={refs} /></Block> : null}
      {p.hypotheses.length ? <Block title="Hypotheses"><List items={p.hypotheses} refs={refs} /></Block> : null}
      <Block title="Approach">
        <p className="prose-read"><WithRefs text={p.method_sketch} refs={refs} /></p>
      </Block>
      <div className="grid gap-x-10 md:grid-cols-2">
        {p.baselines.length ? (
          <Block title="Baselines to reproduce">
            <ul className="mt-1.5 space-y-2">
              {p.baselines.map((b, i) => (
                <li key={i}>
                  <span className="font-semibold text-ink">{b.name}</span> <RefLink rid={b.ref} refs={refs} />
                  <span className="block text-[0.9375rem] text-muted">{b.why}</span>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}
        {p.datasets.length ? (
          <Block title="Datasets">
            <ul className="mt-1.5 space-y-2">
              {p.datasets.map((d, i) => (
                <li key={i}>
                  <span className="font-semibold text-ink">{d.name}</span> <RefLink rid={d.ref} refs={refs} />
                  <span className="block text-[0.9375rem] text-muted">{d.why}</span>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}
      </div>
      {p.metrics.length ? <Block title="Metrics"><List items={p.metrics} refs={refs} /></Block> : null}
      {p.experiments.length ? <Block title="Experiments"><List items={p.experiments} refs={refs} /></Block> : null}
      <Block title="The smallest result worth having">
        <p className="text-ink-2"><WithRefs text={p.minimum_viable_result} refs={refs} /></p>
        {p.stretch_goals.length ? (
          <>
            <p className="mt-3 text-sm font-semibold text-ink">If it goes well</p>
            <List items={p.stretch_goals} refs={refs} />
          </>
        ) : null}
      </Block>

      <Block title="Timeline">
        <ol className="mt-3 border-l-2 border-line">
          {p.milestones.map((m, i) => (
            <li key={i} className="relative pb-6 pl-6 last:pb-0">
              <span className="absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-pen bg-surface" aria-hidden />
              <p className="text-sm font-semibold text-pen">Weeks {m.weeks}</p>
              <p className="font-semibold text-ink">{m.goal}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.9375rem] text-ink-2">
                {m.tasks.map((t, j) => (
                  <li key={j}>{t}</li>
                ))}
              </ul>
              {m.deliverable ? <p className="mt-1 text-sm text-muted">Deliverable: {m.deliverable}</p> : null}
            </li>
          ))}
        </ol>
      </Block>

      {p.risks.length ? (
        <Block title="Risks">
          <ul className="mt-1.5 space-y-2">
            {p.risks.map((r, i) => (
              <li key={i}>
                <span className="text-ink">{r.risk}</span>
                <span className="block text-[0.9375rem] text-muted">What to do: {r.mitigation}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      <div className="grid gap-x-10 md:grid-cols-2">
        {p.skills_to_learn.length ? <Block title="Skills to learn"><List items={p.skills_to_learn} refs={refs} /></Block> : null}
        {p.compute_estimate ? (
          <Block title="Compute">
            <p className="text-ink-2">{p.compute_estimate}</p>
          </Block>
        ) : null}
      </div>
      {p.questions_for_supervisor.length ? <Block title="Questions for your supervisor"><List items={p.questions_for_supervisor} refs={refs} /></Block> : null}

      {(c.people?.length || c.venues?.length || c.code_links?.length) ? (
        <Block title="People, venues and code">
          <div className="grid gap-6 md:grid-cols-3">
            {c.people?.length ? (
              <div>
                <p className="text-sm font-semibold text-ink">Active authors</p>
                <ul className="mt-1 space-y-0.5 text-[0.9375rem] text-ink-2">
                  {c.people.map((x) => (
                    <li key={x.name}>
                      {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line-strong">{x.name}</a> : x.name}
                      <span className="text-faint"> ({x.papers})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {c.venues?.length ? (
              <div>
                <p className="text-sm font-semibold text-ink">Where this work appears</p>
                <ul className="mt-1 space-y-0.5 text-[0.9375rem] text-ink-2">
                  {c.venues.map(([v, n]) => (
                    <li key={v}>{v}<span className="text-faint"> ({n})</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {c.code_links?.length ? (
              <div>
                <p className="text-sm font-semibold text-ink">Code you can start from</p>
                <ul className="mt-1 space-y-1 text-[0.9375rem]">
                  {c.code_links.slice(0, 6).map((x) => (
                    <li key={x.code_url}>
                      <a href={x.code_url} target="_blank" rel="noopener noreferrer" className="break-all text-pen underline">
                        {x.code_url.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Block>
      ) : null}

      <Block title="References">
        <ol className="mt-2 space-y-1.5 text-[0.9375rem]">
          {[...refs.values()].map((r) => (
            <li key={r.rid} id={`ref-${r.rid}`} className="grid grid-cols-[2.5rem_1fr] scroll-mt-28">
              <span className="text-faint tabular">[{r.rid}]</span>
              <span>
                {/^\d{4}\./.test(r.paper_id) ? (
                  <Link href={paperHref(r.paper_id)} className="text-ink-2 hover:text-pen">{r.title}</Link>
                ) : (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-ink-2 hover:text-pen">{r.title}</a>
                )}
                {r.year ? <span className="text-faint"> ({r.year})</span> : null}
                {r.role ? <span className="text-faint">, {r.role}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </Block>
    </article>
  );
}
