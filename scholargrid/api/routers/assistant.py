"""Research assistant: ask a question, get a short brief where every point cites evidence papers."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, Request

from ...assistant import brief_key, build_brief, load_cached_brief
from ..deps import state, track
from ..schemas import BriefIn, JobStarted
from ..state import AppState

router = APIRouter(tags=["assistant"])


@router.post("/assistant/brief", response_model=JobStarted)
def start_brief(body: BriefIn, request: Request, refresh: bool = False, st: AppState = Depends(state)) -> Dict:
    b = st.require()
    version = st.version
    key = brief_key(body.question, body.use_live, version, st.cfg, body.max_papers)
    if not refresh and load_cached_brief(st.cfg, key) is not None:
        return {"ready": True, "key": key}

    def run(progress):
        out = build_brief(body.question, b, st.searcher, st.cfg, st.llm(), use_live=body.use_live,
                          max_papers=body.max_papers, bundle_version=version, progress=progress,
                          use_cache=not refresh)
        return {"key": out["key"], "brief": out}

    track(st, request, "brief_started", live=body.use_live)
    job = st.jobs.submit("brief", run, dedupe_key=f"brief:{key}:{refresh}", meta={"key": key})
    return {"ready": False, "key": key, "job": job.public()}


@router.get("/assistant/brief/{key}")
def get_brief(key: str, st: AppState = Depends(state)) -> Dict[str, Any]:
    from fastapi import HTTPException

    data = load_cached_brief(st.cfg, key)
    if data is None:
        raise HTTPException(404, "This brief has expired or was not saved. Ask the question again.")
    return data
