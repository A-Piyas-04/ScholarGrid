"""Background jobs for long operations (topic workspaces, open problems, plans, research briefs).

The library functions take a ``progress(message, fraction)`` callback; a job stores the latest message and
fraction so the frontend can poll ``GET /api/jobs/{id}``. Jobs with the same ``dedupe_key`` share one run,
so two tabs asking for the same topic do not build it twice. Context variables (the LLM session id) are
copied into the worker thread.
"""
from __future__ import annotations

import contextvars
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from ..utils import get_logger

log = get_logger("api.jobs")

Progress = Callable[[str, float], None]
_KEEP = 300


@dataclass
class Job:
    id: str
    kind: str
    dedupe_key: Optional[str]
    status: str = "queued"            # queued | running | done | error
    progress: float = 0.0
    message: str = "Waiting to start…"
    result: Any = None
    error: Optional[str] = None
    error_kind: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    meta: Dict[str, Any] = field(default_factory=dict)

    def public(self, include_result: bool = True) -> Dict[str, Any]:
        out = {"id": self.id, "kind": self.kind, "status": self.status, "progress": round(self.progress, 3),
               "message": self.message, "error": self.error, "error_kind": self.error_kind,
               "created_at": self.created_at, "updated_at": self.updated_at, "meta": self.meta}
        if include_result:
            out["result"] = self.result
        return out


class JobManager:
    def __init__(self, max_workers: int = 2):
        self._pool = ThreadPoolExecutor(max_workers=max(1, int(max_workers)), thread_name_prefix="sg-job")
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, kind: str, fn: Callable[[Progress], Any], *, dedupe_key: Optional[str] = None,
               meta: Optional[Dict[str, Any]] = None) -> Job:
        with self._lock:
            if dedupe_key:
                for job in self._jobs.values():
                    if job.dedupe_key == dedupe_key and job.status in ("queued", "running"):
                        return job
            job = Job(id=uuid.uuid4().hex[:16], kind=kind, dedupe_key=dedupe_key, meta=dict(meta or {}))
            self._jobs[job.id] = job
            self._trim()
        ctx = contextvars.copy_context()
        self._pool.submit(ctx.run, self._run, job, fn)
        return job

    def _run(self, job: Job, fn: Callable[[Progress], Any]) -> None:
        def progress(message: str, fraction: float) -> None:
            job.message = str(message)
            job.progress = max(job.progress, min(1.0, max(0.0, float(fraction))))
            job.updated_at = time.time()

        job.status, job.message, job.updated_at = "running", "Starting…", time.time()
        try:
            job.result = fn(progress)
            job.status, job.progress, job.message = "done", 1.0, "Done"
        except Exception as exc:  # reported to the client; the server keeps running
            log.error("Job %s (%s) failed: %s\n%s", job.id, job.kind, exc, traceback.format_exc())
            job.status = "error"
            job.error_kind = type(exc).__name__
            job.error = friendly_error(exc)
        job.updated_at = time.time()

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self, kind: Optional[str] = None) -> List[Job]:
        with self._lock:
            jobs = [j for j in self._jobs.values() if kind is None or j.kind == kind]
        return sorted(jobs, key=lambda j: -j.created_at)

    def _trim(self) -> None:
        if len(self._jobs) <= _KEEP:
            return
        done = sorted((j for j in self._jobs.values() if j.status in ("done", "error")), key=lambda j: j.updated_at)
        for j in done[: len(self._jobs) - _KEEP]:
            self._jobs.pop(j.id, None)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


def friendly_error(exc: Exception) -> str:
    """A short message that is safe to show (no secrets, no stack traces)."""
    from ..redact import scrub

    name = type(exc).__name__
    if name in ("QuotaExhausted", "BudgetExceeded"):
        return "The free AI allowance is used up for now. Results fall back to simpler methods; try again later."
    if name == "LLMUnavailable":
        return "No AI provider is available, so this step could not run."
    text = scrub(str(exc))[:300] if str(exc) else name
    return f"{text}"
