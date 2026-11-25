"use client";

import Link from "next/link";
import { fmtInt, paperHref } from "@/lib/format";
import type { ReadingItem } from "@/lib/types";
import { SavePaperButton } from "./paper";
import { Tag } from "./ui";

const STEPS: { id: string; title: string; note: string }[] = [
  { id: "survey", title: "Start with a survey", note: "Overviews that map the whole topic and its vocabulary." },
  { id: "foundation", title: "Read the foundations", note: "Older papers that many papers here build on. Read them oldest first." },
  { id: "recent", title: "Catch up on key recent work", note: "The most-cited papers of the last two years." },
  { id: "frontier", title: "Look at the frontier", note: "The newest central papers, often listing open problems." },
];

const LEVEL: Record<string, string> = { intro: "Introductory", intermediate: "Intermediate", advanced: "Advanced" };

function href(it: ReadingItem): { href: string; external: boolean } {
  if (it.in_corpus || /^\d{4}\.\d{4,5}/.test(it.paper_id)) return { href: paperHref(it.paper_id), external: false };
  return { href: it.url || paperHref(it.paper_id), external: Boolean(it.url) };
}

export function ReadingPath({ items, topic }: { items: ReadingItem[]; topic?: string }) {
  let n = 0;
  const groups = STEPS.map((s) => ({ ...s, items: items.filter((i) => i.step === s.id) })).filter((g) => g.items.length);
  return (
    <div className="space-y-12">
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`step-${g.id}`}>
          <h3 id={`step-${g.id}`} className="serif text-[1.5rem] text-ink">
            {g.title}
          </h3>
          <p className="mt-0.5 text-[0.9375rem] text-muted">{g.note}</p>
          <ol className="mt-4 space-y-6">
            {g.items.map((it) => {
              n += 1;
              const h = href(it);
              const record = it.in_corpus
                ? undefined
                : { paper_id: it.paper_id, title: it.title, url: it.url, date: it.year ? `${it.year}` : "", cited_by_count: it.cited_by_count };
              return (
                <li key={`${g.id}-${it.paper_id}`} className="grid grid-cols-[2.5rem_1fr_auto] gap-x-3">
                  <span className="serif pt-0.5 text-[1.25rem] text-faint tabular">{n}</span>
                  <div className="min-w-0">
                    {h.external ? (
                      <a href={h.href} target="_blank" rel="noopener noreferrer" className="serif text-[1.1875rem] leading-snug text-ink hover:text-pen">
                        {it.title}
                      </a>
                    ) : (
                      <Link href={h.href} className="serif text-[1.1875rem] leading-snug text-ink hover:text-pen">
                        {it.title}
                      </Link>
                    )}
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
                      {it.year ? <span>{it.year}</span> : null}
                      {it.cited_by_count ? <span className="tabular">{fmtInt(it.cited_by_count)} citations</span> : null}
                      {!it.in_corpus ? <span>outside the collection</span> : null}
                    </p>
                    {it.why_read ? (
                      <p className="mt-1.5 max-w-[70ch] text-[0.9375rem] text-ink-2">
                        <span className="font-semibold">Why read it: </span>
                        {it.why_read}
                      </p>
                    ) : null}
                    {it.what_you_learn ? (
                      <p className="mt-0.5 max-w-[70ch] text-[0.9375rem] text-ink-2">
                        <span className="font-semibold">You&apos;ll learn: </span>
                        {it.what_you_learn}
                      </p>
                    ) : null}
                    <p className="mt-1 max-w-[70ch] text-sm text-muted">{it.reason}</p>
                    {it.level ? (
                      <Tag tone="outline" className="mt-1.5">
                        {LEVEL[it.level] ?? it.level}
                      </Tag>
                    ) : null}
                  </div>
                  <SavePaperButton paperId={it.paper_id} topic={topic} record={record} source="reading_path" compact />
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
