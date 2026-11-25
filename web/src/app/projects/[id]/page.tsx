"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Download, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { GapCardView } from "@/components/gap";
import { PlanExports, PlanView } from "@/components/plan";
import { Container } from "@/components/shell";
import { Button, EmptyState, ErrorState, Input, ListSkeleton, Select, Tag, Textarea } from "@/components/ui";
import { api, ApiError, downloadText } from "@/lib/api";
import { ago, fmtDate, fmtInt, paperHref, topicHref } from "@/lib/format";
import { useProject, useToast } from "@/lib/project";
import type { GapCard, PlanDocument, ProjectDetail, ProjectGap, ProjectPaper, TextOut } from "@/lib/types";

const PAPER_STATUS: Record<string, string> = { to_read: "To read", reading: "Reading", read: "Read", key: "Key paper" };
const GAP_STATUS: Record<string, string> = {
  considering: "Considering",
  shortlisted: "Shortlisted",
  chosen: "Chosen",
  rejected: "Rejected",
};

function usePatch(pid: string) {
  const qc = useQueryClient();
  const { push } = useToast();
  return async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) push({ tone: "ok", text: ok });
    } catch (err) {
      push({ tone: "error", text: err instanceof ApiError ? err.message : "That didn't save." });
    } finally {
      qc.invalidateQueries({ queryKey: ["project", pid] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    }
  };
}

function PaperItem({ pid, p }: { pid: string; p: ProjectPaper }) {
  const patch = usePatch(pid);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(p.note);
  const [tags, setTags] = useState(p.tags.join(", "));
  const payload = p.payload as { authors?: string; date?: string; cited_by_count?: number; url?: string };
  const internal = /^\d{4}\.\d{4,5}/.test(p.paper_id) || !payload.url;
  return (
    <li className="py-5">
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div className="min-w-0">
          {internal ? (
            <Link href={paperHref(p.paper_id)} className="serif text-[1.125rem] leading-snug text-ink hover:text-pen">{p.title || p.paper_id}</Link>
          ) : (
            <a href={payload.url} target="_blank" rel="noopener noreferrer" className="serif text-[1.125rem] leading-snug text-ink hover:text-pen">{p.title || p.paper_id}</a>
          )}
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
            {payload.date ? <span>{fmtDate(payload.date)}</span> : p.year ? <span>{p.year}</span> : null}
            {payload.cited_by_count ? <span className="tabular">{fmtInt(payload.cited_by_count)} citations</span> : null}
            <span>saved {ago(p.added_at)}</span>
          </p>
          {p.tags.length && !editing ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {p.tags.map((t) => <Tag key={t} tone="plain">{t}</Tag>)}
            </div>
          ) : null}
          {p.note && !editing ? <p className="mt-2 max-w-[70ch] whitespace-pre-line border-l-2 border-line-strong pl-3 text-[0.9375rem] text-ink-2">{p.note}</p> : null}
          {editing ? (
            <div className="mt-3 max-w-xl space-y-2">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" aria-label="Tags" />
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Your note on this paper" aria-label="Note" />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    await patch(() => api.patch(`/projects/${pid}/papers`, { paper_id: p.paper_id, note, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }), "Saved.");
                    setEditing(false);
                  }}
                >
                  Save note
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <label className="sr-only" htmlFor={`st-${p.paper_id}`}>Reading status</label>
          <Select
            id={`st-${p.paper_id}`}
            value={p.status}
            className="h-8 w-36 text-sm"
            onChange={(e) => patch(() => api.patch(`/projects/${pid}/papers`, { paper_id: p.paper_id, status: e.target.value }))}
          >
            {Object.entries(PAPER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <div className="flex gap-1">
            <button onClick={() => setEditing((x) => !x)} className="inline-flex size-8 items-center justify-center rounded-[7px] text-muted hover:bg-surface-2 hover:text-ink" aria-label="Edit note and tags" title="Note and tags">
              <Pencil className="size-4" />
            </button>
            <button
              onClick={() => patch(() => api.del(`/projects/${pid}/papers`, { paper_id: p.paper_id }), "Removed.")}
              className="inline-flex size-8 items-center justify-center rounded-[7px] text-muted hover:bg-brick-soft hover:text-brick"
              aria-label="Remove from project"
              title="Remove"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function GapItem({ pid, g, topic }: { pid: string; g: ProjectGap; topic: string }) {
  const patch = usePatch(pid);
  const [note, setNote] = useState(g.note);
  const [editing, setEditing] = useState(false);
  return (
    <li className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-ink" htmlFor={`gs-${g.gap_id}`}>Your decision</label>
        <Select id={`gs-${g.gap_id}`} value={g.status} className="h-8 w-40 text-sm" onChange={(e) => patch(() => api.patch(`/projects/${pid}/gaps/${encodeURIComponent(g.gap_id)}`, { status: e.target.value }))}>
          {Object.entries(GAP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Button size="sm" variant="ghost" onClick={() => setEditing((x) => !x)}>
          <Pencil className="size-3.5" aria-hidden /> {g.note ? "Edit note" : "Add a note"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => patch(() => api.del(`/projects/${pid}/gaps/${encodeURIComponent(g.gap_id)}`), "Removed.")}>
          <Trash2 className="size-3.5" aria-hidden /> Remove
        </Button>
      </div>
      {g.note && !editing ? <p className="whitespace-pre-line border-l-2 border-line-strong pl-3 text-[0.9375rem] text-ink-2">{g.note}</p> : null}
      {editing ? (
        <div className="max-w-xl space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} aria-label="Note" />
          <Button size="sm" variant="primary" onClick={async () => { await patch(() => api.patch(`/projects/${pid}/gaps/${encodeURIComponent(g.gap_id)}`, { note }), "Saved."); setEditing(false); }}>
            Save note
          </Button>
        </div>
      ) : null}
      <div className={clsx(g.status === "rejected" && "opacity-60")}>
        <GapCardView card={g.payload as unknown as GapCard} topic={topic} planHref={`/plan?project=${pid}&gap=${encodeURIComponent(g.gap_id)}`} />
      </div>
    </li>
  );
}

function NotesTab({ pid, notes }: { pid: string; notes: ProjectDetail["notes"] }) {
  const patch = usePatch(pid);
  const [body, setBody] = useState("");
  return (
    <div className="max-w-3xl">
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          await patch(() => api.post(`/projects/${pid}/notes`, { body }), "Note added.");
          setBody("");
        }}
      >
        <label htmlFor="newnote" className="sr-only">New note</label>
        <Textarea id="newnote" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ideas, questions for your supervisor, things to try…" maxLength={10000} />
        <Button type="submit" variant="primary" size="sm" disabled={!body.trim()}>Add note</Button>
      </form>
      <ul className="mt-8 space-y-4">
        {notes.map((n) => (
          <li key={n.id} className="rounded-[10px] border border-line bg-surface px-4 py-3">
            <p className="whitespace-pre-line text-ink-2">{n.body}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-faint">
              <span>{ago(n.updated_at || n.created_at)}</span>
              <button onClick={() => patch(() => api.del(`/projects/${pid}/notes/${n.id}`), "Note deleted.")} className="text-muted hover:text-brick">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { push } = useToast();
  const { activeId, setActive } = useProject();
  const [tab, setTab] = useState<"papers" | "gaps" | "plans" | "notes">("papers");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [openPlan, setOpenPlan] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");
  const patch = usePatch(id);
  const q = useQuery({ queryKey: ["project", id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) });

  if (q.isError) return <Container><ErrorState error={q.error} title="This project couldn't be opened" /></Container>;
  if (!q.data) return <Container><ListSkeleton rows={4} /></Container>;
  const p = q.data;
  const papers = p.papers.filter((x) => filter === "all" || x.status === filter);

  const exportJson = async () => {
    const data = await api.get<Record<string, unknown>>(`/projects/${id}/export`);
    downloadText(`${p.title.replace(/[^\w-]+/g, "-").toLowerCase() || "project"}.scholargrid.json`, JSON.stringify(data, null, 1), "application/json");
  };
  const exportBib = async () => {
    const o = await api.get<TextOut>(`/projects/${id}/bibtex`);
    downloadText(o.filename, o.content, o.media_type);
  };

  const TABS = [
    { id: "papers" as const, label: "Papers", n: p.counts.papers },
    { id: "gaps" as const, label: "Open problems", n: p.counts.gaps },
    { id: "plans" as const, label: "Plans", n: p.counts.plans },
    { id: "notes" as const, label: "Notes", n: p.counts.notes },
  ];

  return (
    <Container>
      <header className="mb-8">
        <p className="text-sm text-muted">
          <Link href="/projects" className="hover:text-ink">Projects</Link> / created {fmtDate(p.created_at.slice(0, 10))}
        </p>
        {renaming ? (
          <form
            className="mt-2 flex max-w-2xl gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await patch(() => api.patch(`/projects/${id}`, { title }), "Renamed.");
              setRenaming(false);
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-12 text-xl" autoFocus maxLength={200} aria-label="Project name" />
            <Button type="submit" variant="primary">Save</Button>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
          </form>
        ) : (
          <h1 className="serif mt-1 flex flex-wrap items-baseline gap-3 text-[2.5rem] leading-tight text-ink">
            {p.title}
            <button onClick={() => { setTitle(p.title); setRenaming(true); }} className="text-base text-muted hover:text-pen" aria-label="Rename project">
              <Pencil className="inline size-4" />
            </button>
          </h1>
        )}
        {p.topic_query ? (
          <p className="mt-2 text-[0.9375rem]">
            <Link href={topicHref(p.topic_query)} className="text-pen underline underline-offset-2">Open the topic map for “{p.topic_query}”</Link>
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {activeId === id ? <Tag tone="verd">New saves go here</Tag> : <Button size="sm" onClick={() => setActive(id)}>Save new items here</Button>}
          <Button size="sm" onClick={exportBib} disabled={!p.counts.papers}><Download className="size-4" aria-hidden /> BibTeX</Button>
          <Button size="sm" onClick={exportJson}><Download className="size-4" aria-hidden /> Project file</Button>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              if (!window.confirm(`Delete “${p.title}” and everything in it? This can't be undone.`)) return;
              await api.del(`/projects/${id}`);
              if (activeId === id) setActive(null);
              qc.invalidateQueries({ queryKey: ["projects"] });
              push({ tone: "ok", text: "Project deleted." });
              router.push("/projects");
            }}
          >
            <Trash2 className="size-4" aria-hidden /> Delete
          </Button>
        </div>
      </header>

      <div role="tablist" className="mb-8 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx("-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-[0.9375rem] font-semibold", tab === t.id ? "border-pen text-pen" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label} <span className="ml-1 font-normal text-faint tabular">{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "papers" ? (
        p.papers.length ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {[["all", "All"], ...Object.entries(PAPER_STATUS)].map(([k, v]) => (
                <button key={k} onClick={() => setFilter(k)} className={clsx("rounded-[7px] px-3 py-1.5 text-sm font-medium", filter === k ? "bg-ink text-paper" : "text-muted hover:bg-surface-2")}>
                  {v} <span className="tabular opacity-70">{k === "all" ? p.papers.length : p.papers.filter((x) => x.status === k).length}</span>
                </button>
              ))}
            </div>
            <ul className="mt-2 divide-y divide-line">{papers.map((x) => <PaperItem key={x.paper_id} pid={id} p={x} />)}</ul>
          </>
        ) : (
          <EmptyState title="No papers saved yet" action={<Link href="/search" className="font-medium text-pen underline">Search papers</Link>}>
            Press <b>Save</b> on any paper while this project is the one you save to.
          </EmptyState>
        )
      ) : null}
      {tab === "gaps" ? (
        p.gaps.length ? (
          <ul className="space-y-10">{p.gaps.map((g) => <GapItem key={g.gap_id} pid={id} g={g} topic={p.topic_query} />)}</ul>
        ) : (
          <EmptyState title="No open problems saved yet">Map a topic, open its open problems, and save the ones worth considering.</EmptyState>
        )
      ) : null}
      {tab === "plans" ? (
        p.plans.length ? (
          <ul className="space-y-4">
            {p.plans.map((pl) => (
              <li key={pl.id} className="rounded-[10px] border border-line bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="serif text-[1.25rem] text-ink">{pl.label}</p>
                    <p className="text-sm text-muted">Written {ago(pl.created_at)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setOpenPlan(openPlan === pl.id ? null : pl.id)}>{openPlan === pl.id ? "Close" : "Open"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => patch(() => api.del(`/projects/${id}/plans/${pl.id}`), "Plan deleted.")}>Delete</Button>
                  </div>
                </div>
                {openPlan === pl.id ? (
                  <div className="border-t border-line px-5 py-6">
                    <div className="mb-6"><PlanExports doc={pl.doc as unknown as PlanDocument} /></div>
                    <PlanView doc={pl.doc as unknown as PlanDocument} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No plans yet">Choose an open problem and select “Make a plan for this”.</EmptyState>
        )
      ) : null}
      {tab === "notes" ? <NotesTab pid={id} notes={p.notes} /> : null}
    </Container>
  );
}
