"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search as SearchIcon, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PaperRow } from "@/components/paper";
import { Container } from "@/components/shell";
import { Button, Callout, EmptyState, ErrorState, Input, Label, ListSkeleton, Select, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtInt, topicHref } from "@/lib/format";
import { useStatus } from "@/lib/hooks";
import type { SearchResult } from "@/lib/types";

const SORTS = [
  { id: "relevance", label: "Best match" },
  { id: "newest", label: "Newest" },
  { id: "most_cited", label: "Most cited" },
  { id: "citation_velocity", label: "Gaining citations" },
];

const SOURCE_NAMES: Record<string, string> = { arxiv: "arXiv", openalex: "OpenAlex", semantic_scholar: "Semantic Scholar" };
const SOURCE_STATUS: Record<string, string> = {
  rate_limited: "busy right now",
  slow: "too slow to answer",
  error: "returned an error",
  cooldown: "paused after being busy",
  skipped: "skipped",
};

function SearchPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const q = sp.get("q") ?? "";
  const sort = sp.get("sort") ?? "relevance";
  const live = sp.get("live") !== "0";
  const dateFrom = sp.get("from") ?? "";
  const dateTo = sp.get("to") ?? "";
  const cat = sp.get("cat") ?? "";
  const minc = Number(sp.get("minc") ?? 0) || 0;
  const [pages, setPages] = useState(1);
  const [text, setText] = useState(q);
  const [showFilters, setShowFilters] = useState(Boolean(dateFrom || dateTo || cat || minc));
  const [area, setArea] = useState<number | null>(null);
  const [showExact, setShowExact] = useState(25);
  const [showRelated, setShowRelated] = useState(25);
  const status = useStatus();
  const liveAvailable = status.data?.live_search ?? false;

  useEffect(() => {
    setText(q);
    setPages(1);
    setArea(null);
    setShowExact(25);
    setShowRelated(25);
  }, [q, sort, live, dateFrom, dateTo, cat, minc]);

  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.get<[string, number][]>("/categories"), staleTime: Infinity });

  const res = useQuery({
    queryKey: ["search", q, sort, live, dateFrom, dateTo, cat, minc, pages],
    queryFn: ({ signal }) =>
      api.get<SearchResult>(
        "/search",
        {
          q,
          sort,
          live: live && liveAvailable,
          date_from: dateFrom,
          date_to: dateTo,
          categories: cat ? [cat] : undefined,
          min_citations: minc || undefined,
          pages,
        },
        signal,
      ),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`/search?${next.toString()}`);
  };

  const data = res.data;
  const shown = useMemo(
    () => (data?.results ?? []).filter((r) => area === null || r.area_id === area),
    [data, area],
  );
  const exact = shown.filter((r) => r.match === "exact");
  const related = shown.filter((r) => r.match !== "exact");
  const terms = data ? [...(data.expansion ?? []), ...q.split(/\s+/).filter((w) => w.length > 3)] : [];
  const sourceProblems = Object.entries(data?.source_status ?? {}).filter(([, v]) => v !== "done" && v !== "ok");

  return (
    <Container>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) setParam({ q: text.trim() });
        }}
      >
        <label htmlFor="q" className="sr-only">
          Search papers
        </label>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <Input
            id="q"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search by topic, method, dataset or exact phrase"
            className="h-12 pl-11 text-[1.0625rem]"
            maxLength={300}
            autoFocus={!q}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={!text.trim()}>
          Search
        </Button>
        <Button type="button" size="lg" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <SlidersHorizontal className="size-4" aria-hidden /> Filters
        </Button>
      </form>

      {showFilters ? (
        <div className="mt-3 grid gap-4 rounded-[10px] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label htmlFor="sort">Order</Label>
            <Select id="sort" value={sort} onChange={(e) => setParam({ sort: e.target.value === "relevance" ? null : e.target.value })}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="from">Published from</Label>
            <Input id="from" type="date" value={dateFrom} onChange={(e) => setParam({ from: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="to">Published until</Label>
            <Input id="to" type="date" value={dateTo} onChange={(e) => setParam({ to: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="cat">arXiv category</Label>
            <Select id="cat" value={cat} onChange={(e) => setParam({ cat: e.target.value })}>
              <option value="">Any</option>
              {(cats.data ?? []).slice(0, 60).map(([c, n]) => (
                <option key={c} value={c}>
                  {c} ({fmtInt(n)})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="minc">At least … citations</Label>
            <Input id="minc" type="number" min={0} value={minc || ""} placeholder="0" onChange={(e) => setParam({ minc: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2 lg:col-span-5">
            <input
              type="checkbox"
              checked={live && liveAvailable}
              disabled={!liveAvailable}
              onChange={(e) => setParam({ live: e.target.checked ? null : "0" })}
              className="size-4 accent-[var(--pen)]"
            />
            Also search arXiv, OpenAlex and Semantic Scholar live (slower, finds papers outside the collection)
            {!liveAvailable ? <span className="text-faint">(turned off in the configuration)</span> : null}
          </label>
        </div>
      ) : null}

      {!q ? (
        <EmptyState className="mt-10" title="Search the literature">
          Type a topic, a method or an exact phrase. Results show exact matches first, then papers that are close in
          meaning.
        </EmptyState>
      ) : res.isError ? (
        <div className="mt-8">
          <ErrorState error={res.error} onRetry={() => res.refetch()} />
        </div>
      ) : !data ? (
        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_17rem]">
          <div>
            <p className="mb-6 text-muted">{live && liveAvailable ? "Searching the collection and live sources…" : "Searching…"}</p>
            <ListSkeleton rows={4} />
          </div>
        </div>
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_17rem]">
          <div className={clsx("min-w-0", res.isFetching && "opacity-60 transition-opacity")}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h1 className="serif text-[1.75rem] leading-tight text-ink">
                {fmtInt(data.results.length)} papers for “{data.query}”
              </h1>
              <Link href={topicHref(data.query)} className="text-[0.9375rem] font-medium text-pen underline underline-offset-4">
                Map this as a topic instead
              </Link>
            </div>
            <p className="mt-1 text-sm text-muted">
              {data.about_total > data.results.length ? <>About {fmtInt(data.about_total)} matches exist across sources. </> : null}
              {data.live ? <>Found {fmtInt(data.n_found_online)} papers online in {data.live_seconds}s. </> : null}
              {data.expansion.length ? <>Also searched for {data.expansion.map((e) => `“${e}”`).join(", ")}. </> : null}
              {data.degraded ? "Search by meaning is unavailable, so these are keyword matches. " : null}
            </p>
            {sourceProblems.length ? (
              <Callout tone="warn" className="mt-4">
                Some live sources didn&apos;t answer ({sourceProblems.map(([k, v]) => `${SOURCE_NAMES[k] ?? k} ${SOURCE_STATUS[v] ?? v}`).join(", ")}). Results
                from the collection are complete.
              </Callout>
            ) : null}
            {area !== null ? (
              <p className="mt-4 text-sm">
                Showing one area only.{" "}
                <button className="font-medium text-pen underline" onClick={() => setArea(null)}>
                  Show all areas
                </button>
              </p>
            ) : null}

            {!data.results.length ? (
              <EmptyState className="mt-8" title="No papers matched">
                Try fewer or broader words, remove filters, or switch on live sources.
              </EmptyState>
            ) : null}

            {exact.length ? (
              <section className="mt-6" aria-labelledby="exact">
                <h2 id="exact" className="border-b border-line pb-2 text-lg font-semibold text-ink">
                  Exact matches <span className="ml-1 font-normal text-muted tabular">{fmtInt(exact.length)}</span>
                </h2>
                <p className="mt-1 text-sm text-muted">Papers that contain your words or a known synonym.</p>
                <div className="divide-y divide-line">
                  {exact.slice(0, showExact).map((h) => (
                    <PaperRow key={h.paper_id} hit={h} terms={terms} />
                  ))}
                </div>
                {exact.length > showExact ? (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowExact((n) => n + 50)}>
                    Show {Math.min(50, exact.length - showExact)} more exact matches
                  </Button>
                ) : null}
              </section>
            ) : null}
            {related.length ? (
              <section className="mt-8" aria-labelledby="related">
                <h2 id="related" className="border-b border-line pb-2 text-lg font-semibold text-ink">
                  Related by meaning <span className="ml-1 font-normal text-muted tabular">{fmtInt(related.length)}</span>
                </h2>
                <p className="mt-1 text-sm text-muted">Papers about the same idea in different words.</p>
                <div className="divide-y divide-line">
                  {related.slice(0, showRelated).map((h) => (
                    <PaperRow key={h.paper_id} hit={h} terms={terms} />
                  ))}
                </div>
                {related.length > showRelated ? (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowRelated((n) => n + 50)}>
                    Show {Math.min(50, related.length - showRelated)} more related papers
                  </Button>
                ) : null}
              </section>
            ) : null}
            {data.has_more && pages < 6 && showExact >= exact.length && showRelated >= related.length ? (
              <div className="mt-8 flex justify-center">
                <Button onClick={() => setPages((p) => p + 1)} loading={res.isFetching}>
                  Load more papers
                </Button>
              </div>
            ) : null}
          </div>

          <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
            {data.areas.length ? (
              <section>
                <h2 className="text-sm font-semibold text-ink">Where these papers sit</h2>
                {data.ambiguous ? (
                  <p className="mt-1 text-sm text-muted">Your words span several research areas. Pick one to narrow down.</p>
                ) : null}
                <ul className="mt-3 space-y-1">
                  {data.areas.slice(0, 10).map((a) => {
                    const max = data.areas[0].count;
                    return (
                      <li key={String(a.area_id)}>
                        <button
                          onClick={() => setArea(area === a.area_id ? null : (a.area_id ?? null))}
                          className={clsx(
                            "w-full rounded-[7px] px-2 py-1.5 text-left text-sm hover:bg-surface-2",
                            area === a.area_id && "bg-pen-soft",
                          )}
                        >
                          <span className="flex justify-between gap-2">
                            <span className={clsx("truncate", area === a.area_id ? "text-pen" : "text-ink-2")}>{a.name}</span>
                            <span className="text-faint tabular">{a.count}</span>
                          </span>
                          <span className="mt-1 block h-1 rounded-full bg-surface-2">
                            <span className="block h-1 rounded-full bg-pen/50" style={{ width: `${(a.count / max) * 100}%` }} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            <section className="text-sm text-muted">
              <h2 className="font-semibold text-ink">About these results</h2>
              <p className="mt-1">
                {data.mode.includes("hybrid") ? "Ranked by meaning and keywords together." : data.mode === "lexical" ? "Ranked by keywords." : "Ranked by meaning."}{" "}
                Papers marked <Tag tone="amber">Found online</Tag> come from live sources and are not part of the analysed
                collection.
              </p>
              {status.data?.release?.stale ? (
                <p className="mt-2">The analysed collection was built {status.data.release.data_age_days} days ago.</p>
              ) : null}
            </section>
          </aside>
        </div>
      )}
    </Container>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SearchPage />
    </Suspense>
  );
}
