"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Minus, Plus, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { CameraCmd } from "@/components/map/MapView";
import type { Payload, Scope } from "@/components/map/types";
import { SavePaperButton } from "@/components/paper";
import { Button, Callout, Input, Skeleton, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtInt, paperHref, shortAuthors } from "@/lib/format";
import type { MapHighlight, PaperDetail } from "@/lib/types";

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-muted">
      <Spinner /> Drawing the map…
    </div>
  ),
});

function Drawer({
  data,
  selected,
  scope,
  onArea,
  onConnections,
  onSelect,
}: {
  data: Payload;
  selected: number | null;
  scope: Scope;
  onArea: (id: number) => void;
  onConnections: () => void;
  onSelect: (i: number) => void;
}) {
  const p = selected !== null ? data.papers[selected] : null;
  const detail = useQuery({
    queryKey: ["paper", p?.id],
    queryFn: () => api.get<PaperDetail>("/papers/detail", { id: p!.id }),
    enabled: !!p,
  });
  const area = p ? data.areas.find((a) => a.id === p.c) : null;
  if (!p)
    return (
      <div className="p-5">
        <h2 className="serif text-[1.375rem] leading-snug text-ink">
          {scope.kind === "overview" ? "Start from an area" : scope.kind === "search" ? "Search results on the map" : "Pick a paper"}
        </h2>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          {scope.kind === "overview"
            ? "Each bubble is a research area, sized by its papers. Select one to see its papers and how they connect."
            : "Select any dot to read the paper here. Lines join papers with similar text; select a paper to follow its connections."}
        </p>
        <h3 className="mt-6 text-sm font-semibold text-ink">How to read the map</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
          <li>Colour marks the research area.</li>
          <li>Dot size shows {data.sizeBy === "citations" ? "citations" : "how many connections a paper has"}.</li>
          <li>A line means two papers are textually similar or share references. It is not a citation.</li>
          <li>Position comes from a 2D projection of meaning: distance is only a rough guide.</li>
        </ul>
      </div>
    );
  const neighbors = (data.neighbors[String(p.i)] ?? []).slice(0, 6);
  return (
    <div className="p-5">
      {area ? (
        <button onClick={() => onArea(area.id)} className="flex items-center gap-2 text-sm text-pen hover:underline">
          <span className="inline-block size-2.5 rounded-[3px]" style={{ background: area.color }} aria-hidden />
          {area.name}
        </button>
      ) : null}
      <h2 className="serif mt-2 text-[1.3125rem] leading-snug text-ink">{p.t}</h2>
      <p className="mt-1 text-sm text-muted">
        {shortAuthors(p.au)}, {fmtDate(p.d)}
        {p.ci ? `, ${fmtInt(p.ci)} citations` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <SavePaperButton paperId={p.id} compact source="map" />
        <Link href={paperHref(p.id)} className="inline-flex h-8 items-center rounded-[7px] border border-line-strong px-2.5 text-sm font-medium text-ink-2 hover:border-pen hover:text-pen">
          Open paper
        </Link>
        {scope.kind !== "paper" ? (
          <Button size="sm" variant="ghost" onClick={onConnections}>Follow connections</Button>
        ) : null}
      </div>
      {detail.data ? (
        <p className="mt-4 line-clamp-[12] text-[0.9375rem] leading-relaxed text-ink-2">{detail.data.abstract}</p>
      ) : (
        <Skeleton className="mt-4 h-40" />
      )}
      {neighbors.length ? (
        <>
          <h3 className="mt-6 text-sm font-semibold text-ink">Closest papers</h3>
          <ul className="mt-1 divide-y divide-line">
            {neighbors.map(([j]) => (
              <li key={j}>
                <button onClick={() => onSelect(j)} className="serif w-full py-2 text-left text-[0.9375rem] leading-snug text-ink-2 hover:text-pen">
                  {data.papers[j]?.t}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export default function MapPage() {
  const payload = useQuery({ queryKey: ["map"], queryFn: () => api.get<Payload>("/map"), staleTime: Infinity });
  const [scope, setScope] = useState<Scope>({ kind: "overview" });
  const history = useRef<Scope[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [cameraCmd, setCameraCmd] = useState<CameraCmd | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [searchNonce, setSearchNonce] = useState(0);
  const [text, setText] = useState("");
  const [hl, setHl] = useState<MapHighlight | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const data = useMemo<Payload | null>(() => {
    if (!payload.data) return null;
    if (!hl?.extra.length) return payload.data;
    return { ...payload.data, papers: [...payload.data.papers, ...(hl.extra as Payload["papers"])] };
  }, [payload.data, hl]);
  const colors = useMemo(() => new Map((data?.areas ?? []).map((a) => [a.id, a.color])), [data]);

  const go = (next: Scope) => {
    history.current.push(scope);
    setScope(next);
  };
  const overview = () => {
    history.current = [];
    setScope({ kind: "overview" });
    setSelected(null);
    setHl(null);
  };
  const runSearch = async () => {
    if (!text.trim()) return;
    setSearching(true);
    setErr(null);
    try {
      const res = await api.get<MapHighlight>("/map/search", { q: text.trim(), k: 60 });
      setHl(res);
      setSelected(null);
      history.current = [];
      setScope({ kind: "search" });
      setSearchNonce((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const crumb = scope.kind === "area" ? data?.areas.find((a) => a.id === scope.areaId)?.name : scope.kind === "search" ? `Search: ${hl?.query}` : scope.kind === "paper" ? "A paper's connections" : null;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-6">
        <h1 className="serif mr-2 text-[1.375rem] text-ink">Research map</h1>
        <form className="flex min-w-[16rem] flex-1 gap-2 md:max-w-md" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
          <label htmlFor="mq" className="sr-only">Find papers on the map</label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input id="mq" value={text} onChange={(e) => setText(e.target.value)} placeholder="Find papers on the map" className="h-9 pl-9" />
          </div>
          <Button type="submit" size="sm" className="h-9" loading={searching}>Find</Button>
        </form>
        <nav aria-label="Map location" className="flex items-center gap-2 text-sm">
          <button onClick={overview} className={clsx("font-medium", scope.kind === "overview" ? "text-ink" : "text-pen hover:underline")}>All areas</button>
          {crumb ? (
            <>
              <span className="text-faint">/</span>
              <span className="max-w-[18rem] truncate text-ink">{crumb}</span>
            </>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {history.current.length ? (
            <Button size="sm" variant="ghost" onClick={() => { const prev = history.current.pop(); if (prev) { setScope(prev); setSelected(null); } }}>Back</Button>
          ) : null}
          {scope.kind === "paper" ? (
            <Button size="sm" variant="ghost" onClick={() => setScope({ ...scope, depth: scope.depth + 1 })}>Show more connections</Button>
          ) : null}
          <button className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-2 hover:bg-surface-2" onClick={() => setCameraCmd({ kind: "zoomIn", n: Date.now() })} aria-label="Zoom in"><Plus className="size-4" /></button>
          <button className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-2 hover:bg-surface-2" onClick={() => setCameraCmd({ kind: "zoomOut", n: Date.now() })} aria-label="Zoom out"><Minus className="size-4" /></button>
          <Button size="sm" variant="ghost" onClick={() => setCameraCmd({ kind: "fit", n: Date.now() })}>Fit</Button>
        </div>
      </div>
      {err ? <Callout tone="error" className="mx-4 mt-3">{err}</Callout> : null}
      {hl && hl.items.length === 0 ? <Callout tone="info" className="mx-4 mt-3">No papers matched “{hl.query}”. Try broader words.</Callout> : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_22rem]">
        <div className="relative min-h-[360px]">
          {payload.isError ? (
            <div className="p-6"><Callout tone="error" title="The map couldn't load">{(payload.error as Error).message}</Callout></div>
          ) : !data ? (
            <div className="flex h-full items-center justify-center gap-2 text-muted"><Spinner /> Loading {fmtInt(20000)} papers for the map…</div>
          ) : (
            <MapView
              data={data}
              colors={colors}
              scope={scope}
              searchNonce={searchNonce}
              searchItems={hl ? hl.items.map(([i]) => i) : []}
              selected={selected}
              focusNonce={focusNonce}
              cameraCmd={cameraCmd}
              reducedMotion={typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches}
              onSelectPaper={(i) => setSelected(i)}
              onFocusArea={(id) => { setSelected(null); go({ kind: "area", areaId: id }); }}
              onClearSelection={() => setSelected(null)}
            />
          )}
          {data && data.renderedTotal < data.corpusTotal ? (
            <p className="pointer-events-none absolute bottom-2 left-3 rounded-[6px] bg-white/85 px-2 py-1 text-xs text-[#56636e]">
              Showing {fmtInt(data.renderedTotal)} of {fmtInt(data.corpusTotal)} papers (most cited per area). Search finds every paper.
            </p>
          ) : null}
        </div>
        <aside className="scroll-thin min-h-0 overflow-y-auto border-l border-line bg-surface">
          {data ? (
            <>
              {selected !== null ? (
                <button onClick={() => setSelected(null)} className="flex items-center gap-1 px-5 pt-4 text-sm text-muted hover:text-ink">
                  <X className="size-4" /> Clear selection
                </button>
              ) : null}
              <Drawer
                data={data}
                selected={selected}
                scope={scope}
                onArea={(id) => { setSelected(null); go({ kind: "area", areaId: id }); }}
                onConnections={() => selected !== null && go({ kind: "paper", root: selected, depth: 1 })}
                onSelect={(j) => { setSelected(j); setFocusNonce((n) => n + 1); }}
              />
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
