"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Job, JobStarted, Status } from "./types";

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => api.get<Status>("/status"),
    refetchInterval: (q) => (q.state.data?.ready ? 60_000 : 2_000),
    retry: false,
  });
}

/** Poll a job until it finishes. */
export function useJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "done" || s === "error" ? false : 700;
    },
    retry: 2,
  });
}

export type Runnable<R> =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "running"; job: Job }
  | { phase: "done"; key: string | null; result?: R }
  | { phase: "error"; message: string; kind?: string | null };

/**
 * Start a server-side build that returns ``JobStarted`` (ready now, or a job to poll) and follow it.
 * ``onReady`` runs once the resource exists (immediately for cached ones).
 */
export function useBuild<R = unknown>(onReady?: (key: string | null, result?: R) => void) {
  const [state, setState] = useState<Runnable<R>>({ phase: "idle" });
  const [jobId, setJobId] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const cb = useRef(onReady);
  cb.current = onReady;
  const job = useJob(jobId);

  useEffect(() => {
    const j = job.data;
    if (!j) return;
    if (j.status === "done") {
      setJobId(null);
      setState({ phase: "done", key: keyRef.current, result: j.result as R });
      cb.current?.(keyRef.current, j.result as R);
    } else if (j.status === "error") {
      setJobId(null);
      setState({ phase: "error", message: j.error ?? "Something went wrong.", kind: j.error_kind });
    } else {
      setState({ phase: "running", job: j });
    }
  }, [job.data]);

  useEffect(() => {
    if (job.error) {
      setJobId(null);
      setState({ phase: "error", message: (job.error as Error).message });
    }
  }, [job.error]);

  const start = useCallback(async (fn: () => Promise<JobStarted | Job>) => {
    setState({ phase: "starting" });
    try {
      const res = await fn();
      if ("ready" in res) {
        keyRef.current = res.key ?? null;
        if (res.ready || !res.job) {
          setState({ phase: "done", key: res.key ?? null });
          cb.current?.(res.key ?? null);
        } else {
          setState({ phase: "running", job: res.job });
          setJobId(res.job.id);
        }
      } else {
        keyRef.current = null;
        setState({ phase: "running", job: res });
        setJobId(res.id);
      }
    } catch (err) {
      setState({ phase: "error", message: err instanceof ApiError ? err.message : String(err) });
    }
  }, []);

  const reset = useCallback(() => {
    setJobId(null);
    setState({ phase: "idle" });
  }, []);

  return { state, start, reset };
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* storage unavailable: keep the default */
    }
    setLoaded(true);
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set, loaded];
}

export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback((...keys: unknown[][]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })), [qc]);
}
