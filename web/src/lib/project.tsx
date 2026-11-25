"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api";
import { useLocalStorage, useStatus } from "./hooks";
import type { GapCard, PlanDocument, ProjectDetail, ProjectSummary } from "./types";

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
  href?: string;
  hrefLabel?: string;
}

const ToastCtx = createContext<{ toasts: Toast[]; push: (t: Omit<Toast, "id">) => void; dismiss: (id: number) => void }>({
  toasts: [],
  push: () => undefined,
  dismiss: () => undefined,
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );
  return <ToastCtx.Provider value={{ toasts, push, dismiss }}>{children}</ToastCtx.Provider>;
}

export function useToast() {
  return useContext(ToastCtx);
}

// ---------------------------------------------------------------------------
// Active project: where "Save" puts things. Remembered per browser.
// ---------------------------------------------------------------------------
interface ProjectApi {
  enabled: boolean;
  activeId: string | null;
  active: ProjectDetail | undefined;
  projects: ProjectSummary[];
  setActive: (id: string | null) => void;
  savedPaperIds: Set<string>;
  savedGapIds: Set<string>;
  togglePaper: (paperId: string, opts?: { topic?: string; record?: Record<string, unknown>; source?: string }) => Promise<void>;
  toggleGap: (card: GapCard, opts?: { topic?: string }) => Promise<void>;
  savePlan: (doc: PlanDocument, opts?: { topic?: string }) => Promise<void>;
  createProject: (title: string, topic?: string) => Promise<ProjectSummary>;
  busy: boolean;
}

const ProjectCtx = createContext<ProjectApi | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const status = useStatus();
  const enabled = status.data?.persistence ?? false;
  const [activeId, setActiveId, storageLoaded] = useLocalStorage<string | null>("sg-active-project", null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const list = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<ProjectSummary[]>("/projects"),
    enabled,
  });
  const active = useQuery({
    queryKey: ["project", activeId],
    queryFn: () => api.get<ProjectDetail>(`/projects/${activeId}`),
    enabled: enabled && !!activeId,
    retry: false,
  });

  // Local single-user app: with nothing chosen yet, save into the most recently updated project.
  useEffect(() => {
    if (storageLoaded && !activeId && list.data?.length) setActiveId(list.data[0].id);
  }, [storageLoaded, activeId, list.data, setActiveId]);

  // Forget a project that no longer exists.
  useEffect(() => {
    if (active.error instanceof ApiError && active.error.status === 404) setActiveId(null);
  }, [active.error, setActiveId]);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["project"] });
  }, [qc]);

  const createProject = useCallback(
    async (title: string, topic = "") => {
      const p = await api.post<ProjectSummary>("/projects", { title: title || "My research project", topic_query: topic });
      setActiveId(p.id);
      refresh();
      return p;
    },
    [refresh, setActiveId],
  );

  const ensure = useCallback(
    async (topic?: string): Promise<string> => {
      if (activeId) return activeId;
      const title = topic ? topic.charAt(0).toUpperCase() + topic.slice(1) : "My research project";
      const p = await createProject(title, topic ?? "");
      push({ tone: "ok", text: `Created the project “${p.title}”.`, href: `/projects/${p.id}`, hrefLabel: "Open" });
      return p.id;
    },
    [activeId, createProject, push],
  );

  const savedPaperIds = useMemo(() => new Set((active.data?.papers ?? []).map((p) => p.paper_id)), [active.data]);
  const savedGapIds = useMemo(() => new Set((active.data?.gaps ?? []).map((g) => g.gap_id)), [active.data]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        push({ tone: "error", text: err instanceof ApiError ? err.message : "Couldn't save. Try again." });
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [push, refresh],
  );

  const togglePaper: ProjectApi["togglePaper"] = useCallback(
    (paperId, opts) =>
      run(async () => {
        const pid = await ensure(opts?.topic);
        if (savedPaperIds.has(paperId) && pid === activeId) {
          await api.del(`/projects/${pid}/papers`, { paper_id: paperId });
          push({ tone: "ok", text: "Removed from the project." });
        } else {
          await api.post(`/projects/${pid}/papers`, { paper_id: paperId, record: opts?.record, source: opts?.source ?? "web" });
          push({ tone: "ok", text: "Saved to the project.", href: `/projects/${pid}`, hrefLabel: "Open project" });
        }
      }),
    [run, ensure, savedPaperIds, activeId, push],
  );

  const toggleGap: ProjectApi["toggleGap"] = useCallback(
    (card, opts) =>
      run(async () => {
        const pid = await ensure(opts?.topic);
        if (savedGapIds.has(card.id) && pid === activeId) {
          await api.del(`/projects/${pid}/gaps/${encodeURIComponent(card.id)}`);
          push({ tone: "ok", text: "Removed the open problem from the project." });
        } else {
          await api.post(`/projects/${pid}/gaps`, { card });
          push({ tone: "ok", text: "Saved the open problem.", href: `/projects/${pid}`, hrefLabel: "Open project" });
        }
      }),
    [run, ensure, savedGapIds, activeId, push],
  );

  const savePlan: ProjectApi["savePlan"] = useCallback(
    (doc, opts) =>
      run(async () => {
        const pid = await ensure(opts?.topic);
        await api.post(`/projects/${pid}/plans`, { doc });
        if (!savedGapIds.has(doc.gap_id)) {
          await api.post(`/projects/${pid}/gaps`, { card: doc.gap_snapshot });
        }
        push({ tone: "ok", text: "Saved the plan.", href: `/projects/${pid}`, hrefLabel: "Open project" });
      }),
    [run, ensure, savedGapIds, push],
  );

  const value: ProjectApi = {
    enabled,
    activeId,
    active: active.data,
    projects: list.data ?? [],
    setActive: setActiveId,
    savedPaperIds,
    savedGapIds,
    togglePaper,
    toggleGap,
    savePlan,
    createProject,
    busy,
  };
  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
}

export function useProject(): ProjectApi {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error("useProject outside ProjectProvider");
  return ctx;
}
