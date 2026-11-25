"""Open problems (Gap Cards) for a topic workspace, novelty re-checks, and offline area cards."""
from __future__ import annotations

from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request

from ...gaps.model import TYPE_HELP, TYPE_LABELS
from ...gaps.workspace import gaps_for_workspace, load_cached_gaps, recheck_novelty
from ..deps import state, track
from ..schemas import GapsOut, JobOut, JobStarted, RecheckIn
from ..state import AppState
from .topics import require_ws

router = APIRouter(tags=["open problems"])


@router.get("/gaps/types")
def gap_types() -> Dict[str, Dict[str, str]]:
    return {k: {"label": v, "help": TYPE_HELP.get(k, "")} for k, v in TYPE_LABELS.items()}


@router.post("/topics/{key}/gaps", response_model=JobStarted)
def start_gaps(key: str, request: Request, refresh: bool = False, st: AppState = Depends(state)) -> Dict:
    st.require()
    if not st.cfg["gaps"]["enabled"]:
        raise HTTPException(503, "Open-problem detection is turned off in the configuration.")
    ws = require_ws(st, key)
    if not refresh and load_cached_gaps(key, st.cfg) is not None:
        return {"ready": True, "key": key}

    def run(progress):
        data = gaps_for_workspace(ws, st.bundle, st.searcher, st.cfg, st.llm(), progress=progress,
                                  use_cache=not refresh)
        return {"key": key, "n_cards": len(data.get("cards") or []),
                "quota_stopped": bool((data.get("stats") or {}).get("quota_stopped"))}

    track(st, request, "gaps_started", refresh=refresh)
    job = st.jobs.submit("gaps", run, dedupe_key=f"gaps:{key}:{refresh}", meta={"key": key, "query": ws.query})
    return {"ready": False, "key": key, "job": job.public()}


@router.get("/topics/{key}/gaps", response_model=GapsOut)
def get_gaps(key: str, st: AppState = Depends(state)) -> Dict:
    data = load_cached_gaps(key, st.cfg)
    if data is None:
        raise HTTPException(404, "Open problems have not been generated for this topic yet.")
    return data


@router.post("/gaps/recheck", response_model=JobOut)
def recheck(body: RecheckIn, st: AppState = Depends(state)) -> Dict:
    st.require()
    ws = require_ws(st, body.ws_key)

    def run(progress):
        progress("Searching recent papers that might already solve this…", 0.2)
        return recheck_novelty(body.card, ws, st.bundle, st.searcher, st.cfg, st.llm())

    return st.jobs.submit("novelty", run, dedupe_key=f"novelty:{body.ws_key}:{body.card.get('id')}").public()
