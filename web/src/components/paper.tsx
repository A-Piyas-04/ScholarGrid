"use client";

import clsx from "clsx";
import { Bookmark, BookmarkCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { fmtDate, fmtInt, highlightParts, paperHref, shortAuthors } from "@/lib/format";
import { useProject } from "@/lib/project";
import type { PaperHit } from "@/lib/types";
import { Tag } from "./ui";

export function Highlighted({ text, terms }: { text: string; terms?: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
    </>
  );
}

export function SavePaperButton({
  paperId,
  topic,
  record,
  source,
  compact,
}: {
  paperId: string;
  topic?: string;
  record?: Record<string, unknown>;
  source?: string;
  compact?: boolean;
}) {
  const { enabled, savedPaperIds, togglePaper, busy } = useProject();
  if (!enabled) return null;
  const saved = savedPaperIds.has(paperId);
  return (
    <button
      type="button"
      onClick={() => togglePaper(paperId, { topic, record, source })}
      disabled={busy}
      aria-pressed={saved}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-[7px] border text-sm font-medium transition-colors disabled:opacity-60",
        compact ? "h-8 px-2.5" : "h-9 px-3",
        saved ? "border-pen bg-pen-soft text-pen" : "border-line-strong bg-surface text-ink-2 hover:border-pen hover:text-pen",
      )}
      title={saved ? "Remove from the project" : "Save to the project"}
    >
      {saved ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}
      {saved ? "Saved" : "Save"}
    </button>
  );
}

function hitRecord(h: PaperHit): Record<string, unknown> {
  return {
    paper_id: h.paper_id, arxiv_id: h.arxiv_id, doi: h.doi, url: h.url, title: h.title, authors: h.authors,
    venue: h.venue, date: h.date, primary_category: h.primary_category, cited_by_count: h.cited_by_count, sources: h.sources,
  };
}

const SOURCE_NAMES: Record<string, string> = {
  arxiv: "arXiv",
  openalex: "OpenAlex",
  semantic_scholar: "Semantic Scholar",
  collection: "collection",
};

/** One paper in a list: serif title, plain metadata line, abstract excerpt with the matched words highlighted. */
export function PaperRow({
  hit,
  terms,
  topic,
  showArea = true,
  rank,
  extra,
}: {
  hit: PaperHit;
  terms?: string[];
  topic?: string;
  showArea?: boolean;
  rank?: number;
  extra?: React.ReactNode;
}) {
  const authors = shortAuthors(hit.authors);
  const external = hit.url || (hit.arxiv_id ? `https://arxiv.org/abs/${hit.arxiv_id}` : "");
  return (
    <article className="group relative grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-5">
      <div className="min-w-0">
        <h3 className="serif text-[1.1875rem] leading-snug text-ink">
          {rank ? <span className="mr-2 text-base text-faint tabular">{rank}.</span> : null}
          <Link href={paperHref(hit.paper_id)} className="hover:text-pen hover:underline decoration-1 underline-offset-[3px]">
            <Highlighted text={hit.title} terms={terms} />
          </Link>
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {authors ? <span className="text-ink-2">{authors}</span> : null}
          {hit.date ? <span>{fmtDate(hit.date)}</span> : null}
          {hit.venue ? <span className="italic">{hit.venue}</span> : null}
          {hit.cited_by_count > 0 ? <span className="tabular">{fmtInt(hit.cited_by_count)} citations</span> : null}
        </p>
        {hit.abstract ? (
          <p className="mt-2 max-w-[78ch] text-[0.9375rem] leading-relaxed text-ink-2">
            <Highlighted text={hit.abstract} terms={terms} />
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {showArea && hit.area_name && hit.area_id !== -1 ? (
            <Link href={`/areas/${hit.area_id}`}>
              <Tag tone="pen" className="hover:underline">{hit.area_name}</Tag>
            </Link>
          ) : null}
          {hit.primary_category ? <Tag tone="outline">{hit.primary_category}</Tag> : null}
          {!hit.in_collection ? (
            <Tag tone="amber" title="Found by live search; not part of the analysed collection, so it has no area or trend data">
              Found online{hit.sources.length ? ` via ${hit.sources.map((s) => SOURCE_NAMES[s] ?? s).join(", ")}` : ""}
            </Tag>
          ) : null}
          {extra}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <SavePaperButton paperId={hit.paper_id} topic={topic} record={hit.in_collection ? undefined : hitRecord(hit)} compact />
        {external ? (
          <a
            href={external}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-[7px] px-2 text-sm text-muted hover:text-pen"
            title="Open at the source"
          >
            <ExternalLink className="size-3.5" aria-hidden /> Source
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function PaperList({
  hits,
  terms,
  topic,
  numbered,
  showArea,
}: {
  hits: PaperHit[];
  terms?: string[];
  topic?: string;
  numbered?: boolean;
  showArea?: boolean;
}) {
  return (
    <div className="divide-y divide-line">
      {hits.map((h, i) => (
        <PaperRow key={h.paper_id} hit={h} terms={terms} topic={topic} rank={numbered ? i + 1 : undefined} showArea={showArea} />
      ))}
    </div>
  );
}
