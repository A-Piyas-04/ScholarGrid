"""Request dependencies shared by the routers."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request

from .state import AppState


def state(request: Request) -> AppState:
    return request.app.state.sg


def repo_or_503(st: AppState) -> Any:
    repo = st.get_repo()
    if repo is None:
        raise HTTPException(503, detail="Projects are turned off (persistence.enabled is false)"
                            if not st.cfg["persistence"]["enabled"] else
                            f"The project database is unavailable: {st.repo_error}")
    return repo


def track(st: AppState, request: Request, name: str, **props: Any) -> None:
    """Privacy-respecting product event (no query text unless telemetry.store_queries)."""
    if not st.cfg["telemetry"]["enabled"]:
        return
    repo = st.get_repo()
    if repo is None:
        return
    try:
        sid = (request.headers.get("x-sg-session") or "anon")[:32]
        repo.add_event(session=sid, name=name, user_id=(st.local_user or {}).get("id"), props=props)
    except Exception:
        pass
