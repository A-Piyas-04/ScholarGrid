"""Process-wide state for the API: config, the served release, searcher, LLM client, project repo, jobs.

The release loads once in a background thread at startup (about 40 s for 48k papers with the embedding
model), so the server answers ``/api/status`` immediately and the frontend can show a loading screen.
Requests that need the bundle wait for it. A newly published release (``data/releases/CURRENT`` or a pin
change) is picked up on the next request after ``RELEASE_CHECK_S`` seconds.
"""
from __future__ import annotations

import contextlib
import os
import threading
import time
from typing import Any, Dict, Optional

from ..config import Config, load_config
from ..utils import get_logger
from .jobs import JobManager

log = get_logger("api.state")

RELEASE_CHECK_S = 20.0
LOCAL_USER_EMAIL = "local@scholargrid.local"


class NotReady(RuntimeError):
    """The release is still loading (or failed to load)."""


def apply_demo_overrides(cfg: Config) -> Config:
    """Serving the synthetic demo bundle: run the whole journey offline (fake LLM, no live sources)."""
    from ..release import resolve_bundle_dir
    from ..utils import load_json

    if cfg.is_production:
        return cfg
    try:
        meta = load_json(os.path.join(resolve_bundle_dir(cfg), "meta.json"))
    except Exception:
        return cfg
    if (meta.get("snapshot") or {}).get("source") != "synthetic":
        return cfg
    if cfg.raw["llm"]["provider"] == "none":
        cfg.raw["llm"]["provider"] = "fake"
    cfg.raw["search"]["live"] = False
    cfg.raw["workspace"]["live"] = False
    if cfg.raw["persistence"]["default_url"] == "sqlite:///data/app.db":
        cfg.raw["persistence"]["default_url"] = "sqlite:///data/demo_app.db"
    return cfg


class AppState:
    def __init__(self, cfg: Optional[Config] = None, *, config_path: Optional[str] = None):
        self.cfg = apply_demo_overrides(cfg if cfg is not None else load_config(config_path))
        self._lock = threading.RLock()
        self._ready = threading.Event()
        self.bundle: Any = None
        self.searcher: Any = None
        self.lookup: Any = None
        self.release_key: str = ""
        self.load_error: Optional[str] = None
        self.loading = False
        self.loaded_at: Optional[float] = None
        self._last_check = 0.0
        self._llm: Any = None
        self.byok_llm: Any = None
        self.repo: Any = None
        self.repo_error: Optional[str] = None
        self.local_user: Optional[Dict[str, Any]] = None
        self.jobs = JobManager(max_workers=int(self.cfg["app"]["heavy_slots"]))
        self.started_at = time.time()
        self.map_cache: Dict[Any, Any] = {}
        self.guard_enabled = os.environ.get("SCHOLARGRID_API_GUARD", "") == "1"

    # -- release -------------------------------------------------------------------------
    def _current_key(self) -> str:
        from ..release import resolve_bundle_dir

        try:
            path = resolve_bundle_dir(self.cfg)
            meta = os.path.join(path, "meta.json")
            return f"{path}|{os.path.getmtime(meta) if os.path.exists(meta) else 0}"
        except Exception:
            return "unknown"

    def load(self) -> None:
        """Load (or reload) the served release. Safe to call from a background thread."""
        from ..artifacts import load_bundle
        from ..foundations import WorkLookup
        from ..live_search import LiveSearcher

        with self._lock:
            self.loading = True
            key = self._current_key()
        t0 = time.time()
        try:
            bundle = load_bundle(self.cfg)
            if self.cfg["app"]["pre_warm"] and bundle.embedder is not None:
                with contextlib.suppress(Exception):
                    bundle.embedder.encode_query("warm up")
            searcher = LiveSearcher(self.cfg, bundle)
            synthetic = (bundle.meta.get("snapshot") or {}).get("source") == "synthetic"
            lookup = WorkLookup(self.cfg, synthetic=synthetic)
            with self._lock:
                self.bundle, self.searcher, self.lookup = bundle, searcher, lookup
                self.release_key, self.load_error = key, None
                self.loaded_at = time.time()
                self.map_cache.clear()
            log.info("Release loaded in %.1fs (%d papers).", time.time() - t0, len(bundle.df))
        except Exception as exc:
            log.exception("Could not load the release")
            with self._lock:
                self.load_error = f"{type(exc).__name__}: {exc}"
        finally:
            with self._lock:
                self.loading = False
            self._ready.set()

    def load_async(self) -> threading.Thread:
        t = threading.Thread(target=self.load, name="sg-bundle-load", daemon=True)
        t.start()
        return t

    def maybe_reload(self) -> None:
        now = time.time()
        if now - self._last_check < RELEASE_CHECK_S or self.loading or self.bundle is None:
            return
        self._last_check = now
        if self._current_key() != self.release_key:
            log.info("A new release was published; reloading.")
            self.load_async()

    def require(self, timeout: float = 120.0) -> Any:
        """The loaded bundle, waiting for the startup load if needed."""
        if self.bundle is None:
            if not self._ready.wait(timeout):
                raise NotReady("The research collection is still loading. Try again in a moment.")
            if self.bundle is None:
                raise NotReady(f"The research collection could not be loaded: {self.load_error}")
        self.maybe_reload()
        return self.bundle

    @property
    def version(self) -> str:
        b = self.require()
        return str(b.meta.get("generated_at", "v1"))

    @property
    def is_synthetic(self) -> bool:
        b = self.bundle
        return bool(b is not None and (b.meta.get("snapshot") or {}).get("source") == "synthetic")

    # -- LLM -----------------------------------------------------------------------------
    def shared_llm(self) -> Any:
        if self._llm is None:
            from ..llm import get_llm
            from ..llm.guard import install_guard

            llm = get_llm(self.cfg)
            if self.guard_enabled and self.get_repo() is not None:
                install_guard(llm, self.cfg, self.get_repo())
            self._llm = llm
        return self._llm

    def llm(self) -> Any:
        """The user's own key if they added one in Settings, else the shared client."""
        return self.byok_llm or self.shared_llm()

    # -- persistence -------------------------------------------------------------------
    def get_repo(self) -> Any:
        if not self.cfg["persistence"]["enabled"]:
            return None
        if self.repo is None and self.repo_error is None:
            try:
                from ..persistence import get_repo

                self.repo = get_repo(self.cfg)
                self.local_user = self.repo.upsert_user(email=LOCAL_USER_EMAIL, name="Local researcher",
                                                        provider="local")
            except Exception as exc:
                log.exception("Project database unavailable")
                self.repo_error = f"{type(exc).__name__}: {exc}"
        return self.repo

    def access(self, project_id: Optional[str] = None) -> Any:
        from ..persistence.repo import Access

        self.get_repo()
        uid = (self.local_user or {}).get("id")
        return Access(user_id=uid, project_id=project_id)

    def shutdown(self) -> None:
        self.jobs.shutdown()
