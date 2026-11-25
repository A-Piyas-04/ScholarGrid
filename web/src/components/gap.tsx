"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bookmark, BookmarkCheck, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { ago, paperHref } from "@/lib/format";
import { useProject } from "@/lib/project";
import type { GapCard, GapTypes } from "@/lib/types";
import { buttonClass, Tag } from "./ui";

const ROLE: Record<string, string> = {
  states_problem: "States the problem",
  related_attempt: "Possibly related later work",
  method_use: "Uses the method",
  task_use: "Works on the problem",
  bridge: "Bridging example",
  narrow_eval: "Evaluation setting",
  conflicting_result: "Reported result",
  side_a: "One side",
  side_b: "Other side",
};

const NOVELTY: Record<string, { label: string; tone: "verd" | "amber" | "brick" | "outline"; help: string }> = {
  novel: { label: "No recent paper solves it", tone: "verd", help: "The novelty check found no recent paper that addresses this." },
  partially_explored: { label: "Partly explored", tone: "amber", help: "Some recent papers touch this; read them before committing." },
  already_addressed: { label: "Possibly already solved", tone: "brick", help: "A recent paper seems to address this." },
  not_checked: { label: "Novelty not checked", tone: "outline", help: "No novelty check has run yet." },
};

const VERDICT: Record<string, string> = {
  addresses: "seems to address it",
  partially: "partly addresses it",
  unrelated: "unrelated",
  unjudged: "not judged",
};

export function useGapTypes() {
  return useQuery({ queryKey: ["gap-types"], queryFn: () => api.get<GapTypes>("/gaps/types"), staleTime: Infinity }).data ?? {};
}

function evidenceHref(e: { paper_id: string; url: string }) {
  return /^\d{4}\.\d{4,5}/.test(e.paper_id) ? paperHref(e.paper_id) : e.url || paperHref(e.paper_id);
}

export function GapCardView({
  card,
  topic,
  planHref,
  onRecheck,
  rechecking,
  defaultOpen = false,
}: {
  card: GapCard;
  topic?: string;
  planHref?: string;
  onRecheck?: () => void;
  rechecking?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const types = useGapTypes();
  const { enabled, savedGapIds, toggleGap, busy } = useProject();
  const saved = savedGapIds.has(card.id);
  const nov = NOVELTY[card.novelty?.status ?? "not_checked"] ?? NOVELTY.not_checked;
  const quotes = card.evidence.filter((e) => e.quote);
  const preview = (quotes.length ? quotes : card.evidence).slice(0, 2);
  const typeInfo = types[card.type];
  const scores = card.scores;

  return (
    <article className="rounded-[14px] border border-line bg-surface">
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone="pen" title={typeInfo?.help}>{typeInfo?.label ?? card.type.replace(/_/g, " ")}</Tag>
          <Tag tone={nov.tone} title={nov.help}>{nov.label}</Tag>
          <Tag tone="outline" title="How many independent papers support it">
            {card.confidence} confidence
          </Tag>
          <Tag tone="outline">{card.feasibility} feasibility</Tag>
          {card.beginner_friendly ? <Tag tone="verd">Good first project</Tag> : null}
        </div>
        <h3 className="serif mt-3 text-[1.375rem] leading-snug text-ink">{card.title}</h3>
        <p className="mt-2 max-w-[72ch] text-[1rem] leading-relaxed text-ink-2">{card.statement}</p>
        {card.why_it_matters ? (
          <p className="mt-2 max-w-[72ch] text-[0.9375rem] text-muted">
            <span className="font-semibold text-ink-2">Why it matters: </span>
            {card.why_it_matters}
          </p>
        ) : null}

        <ul className="mt-4 space-y-3">
          {preview.map((e) => (
            <li key={e.eid} className="text-[0.9375rem]">
              {e.quote ? (
                <blockquote className="serif text-[1.0625rem] leading-relaxed text-ink-2">
                  “<span className="mark">{e.quote}</span>”
                </blockquote>
              ) : e.note ? (
                <p className="text-ink-2">{e.note}</p>
              ) : null}
              <p className="mt-0.5 text-sm text-muted">
                {ROLE[e.role] ?? e.role}:{" "}
                <Link href={evidenceHref(e)} className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-pen">
                  {e.title}
                </Link>
                {e.year ? ` (${e.year})` : ""}
                {e.section ? `, ${e.section}` : ""}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {planHref ? (
            <Link href={planHref} className={buttonClass("primary", "sm")}>
              Make a plan for this
            </Link>
          ) : null}
          {enabled ? (
            <button
              onClick={() => toggleGap(card, { topic })}
              disabled={busy}
              aria-pressed={saved}
              className={clsx(buttonClass("secondary", "sm"), saved && "border-pen bg-pen-soft text-pen")}
            >
              {saved ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}
              {saved ? "Saved" : "Save"}
            </button>
          ) : null}
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={buttonClass("ghost", "sm")}>
            {open ? "Hide" : "Show"} evidence and checks
            <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
        </div>
      </div>

      {open ? (
        <div className="grid gap-8 border-t border-line px-5 py-6 md:grid-cols-[1.4fr_1fr] md:px-6">
          <div className="min-w-0 space-y-7">
            <section>
              <h4 className="text-sm font-semibold text-ink">All evidence ({card.evidence.length} papers)</h4>
              <ol className="mt-2 space-y-3">
                {card.evidence.map((e) => (
                  <li key={e.eid} className="grid grid-cols-[2rem_1fr] gap-2 text-[0.9375rem]">
                    <span className="text-sm text-faint tabular">{e.eid}</span>
                    <div className="min-w-0">
                      <Link href={evidenceHref(e)} className="serif text-ink hover:text-pen">
                        {e.title}
                      </Link>
                      <span className="text-sm text-muted">
                        {e.year ? ` (${e.year})` : ""}, {(ROLE[e.role] ?? e.role).toLowerCase()}
                      </span>
                      {e.quote ? (
                        <p className="serif mt-1 text-ink-2">
                          “<span className="mark">{e.quote}</span>”
                          {e.anchor_url ? (
                            <a href={e.anchor_url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex align-middle text-pen" aria-label="Open the passage">
                              <ExternalLink className="size-3.5" />
                            </a>
                          ) : null}
                        </p>
                      ) : null}
                      {e.note ? <p className="mt-0.5 text-sm text-muted">{e.note}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h4 className="text-sm font-semibold text-ink">Novelty check</h4>
              <p className="mt-1 text-[0.9375rem] text-ink-2">
                {nov.help}
                {card.novelty?.checked_at ? ` Checked ${ago(card.novelty.checked_at)}` : ""}
                {card.novelty?.scope && card.novelty.scope !== "none"
                  ? card.novelty.scope === "collection+live"
                    ? " against the collection and live sources."
                    : " against the analysed collection."
                  : ""}
              </p>
              {card.novelty?.hits?.length ? (
                <ul className="mt-2 space-y-2">
                  {card.novelty.hits.map((h) => (
                    <li key={h.paper_id} className="text-[0.9375rem]">
                      <a href={h.url || paperHref(h.paper_id)} target="_blank" rel="noopener noreferrer" className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-pen">
                        {h.title}
                      </a>
                      <span className="text-sm text-muted">
                        {h.date ? ` (${h.date.slice(0, 4)})` : ""} {VERDICT[h.verdict] ?? h.verdict}
                        {h.reason ? `: ${h.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {onRecheck ? (
                <button onClick={onRecheck} disabled={rechecking} className={clsx(buttonClass("secondary", "sm"), "mt-3")}>
                  <RefreshCw className={clsx("size-3.5", rechecking && "animate-spin")} aria-hidden />
                  {rechecking ? "Checking recent papers…" : "Check novelty again"}
                </button>
              ) : null}
            </section>
          </div>

          <div className="space-y-7">
            <section className="border-l-2 border-dashed border-brick/60 pl-4">
              <h4 className="text-sm font-semibold text-ink">Why this might not be a real gap</h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[0.9375rem] text-ink-2">
                {card.why_it_might_not_be_a_gap.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
            {card.first_steps?.length ? (
              <section>
                <h4 className="text-sm font-semibold text-ink">First steps</h4>
                <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[0.9375rem] text-ink-2">
                  {card.first_steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </section>
            ) : null}
            <section>
              <h4 className="text-sm font-semibold text-ink">What you would need</h4>
              <dl className="mt-1.5 space-y-1.5 text-[0.9375rem]">
                {card.skills?.length ? (
                  <div>
                    <dt className="inline text-muted">Skills: </dt>
                    <dd className="inline text-ink-2">{card.skills.join(", ")}</dd>
                  </div>
                ) : null}
                {card.data_needs ? (
                  <div>
                    <dt className="inline text-muted">Data: </dt>
                    <dd className="inline text-ink-2">{card.data_needs}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="inline text-muted">Compute: </dt>
                  <dd className="inline text-ink-2">{card.compute.replace(/_/g, " ")}</dd>
                </div>
              </dl>
            </section>
            {scores ? (
              <section>
                <h4 className="text-sm font-semibold text-ink">How it was ranked</h4>
                <dl className="mt-2 space-y-1.5">
                  {(["evidence", "novelty", "feasibility", "specificity", "recency"] as const).map((k) => (
                    <div key={k} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-sm" title={scores.explain?.[k]}>
                      <dt className="capitalize text-muted">{k}</dt>
                      <dd className="h-1.5 rounded-full bg-surface-2">
                        <span className="block h-1.5 rounded-full bg-pen/70" style={{ width: `${Math.round((scores[k] ?? 0) * 100)}%` }} />
                      </dd>
                      <span className="text-right text-faint tabular">{Math.round((scores[k] ?? 0) * 100)}</span>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {card.generated_by?.synthesized === false ? (
              <p className="text-xs text-faint">Worded from a template (no AI was available).</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
