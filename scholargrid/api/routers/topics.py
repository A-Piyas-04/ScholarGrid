"""Topic workspaces: a query-scoped map of sub-topics, an overview and a reading path.

Building one takes seconds to a minute (retrieval, live sources, clustering, LLM labels, OpenAlex lookups),
so ``POST /topics`` returns a job unless the workspace is already cached.
"""
from __future__ import annotations

import json
import os
import threading
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ...workspace import build_workspace, load_cached, workspace_key
from .. import serialize as ser
from ..deps import state, track
from ..schemas import JobStarted, RecentTopic, TopicIn, WorkspaceOut
from ..state import AppState

router = APIRouter(tags=["topics"])

_MEM: OrderedDict[str, Any] = OrderedDict()
_MEM_MAX = 24
_LOCK = threading.Lock()


def remember(ws: Any) -> None:
    with _LOCK:
        _MEM[ws.key] = ws
        _MEM.move_to_end(ws.key)
        while len(_MEM) > _MEM_MAX:
            _MEM.popitem(last=False)


def get_ws(st: AppState, key: str) -> Optional[Any]:
    with _LOCK:
        ws = _MEM.get(key)
    if ws is None:
        ws = load_cached(key, st.cfg)
        if ws is not None:
            remember(ws)
    return ws


def require_ws(st: AppState, key: str) -> Any:
    ws = get_ws(st, key)
    if ws is None:
        raise HTTPException(404, "This topic map has expired or was never built. Open the topic again to rebuild it.")
    return ws


@router.post("/topics", response_model=JobStarted)
def start_topic(body: TopicIn, request: Request, st: AppState = Depends(state)) -> Dict:
    st.require()
    query = " ".join(body.query.split())
    if not st.cfg["workspace"]["enabled"]:
        raise HTTPException(503, "Topic workspaces are turned off in the configuration.")
    version = st.version
    key = workspace_key(query, version, st.cfg)
    if not body.refresh and get_ws(st, key) is not None:
        return {"ready": True, "key": key}

    def run(progress):
        ws = build_workspace(query, st.bundle, st.searcher, st.cfg, bundle_version=version, progress=progress,
                             lookup=st.lookup, use_cache=not body.refresh, llm=st.llm())
        remember(ws)
        return {"key": ws.key, "n_papers": len(ws.papers), "k": len(ws.top_level())}

    track(st, request, "topic_started", refresh=body.refresh)
    job = st.jobs.submit("topic", run, dedupe_key=f"topic:{key}:{body.refresh}", meta={"key": key, "query": query})
    return {"ready": False, "key": key, "job": job.public()}


@router.get("/topics/{key}", response_model=WorkspaceOut)
def get_topic(key: str, st: AppState = Depends(state)) -> Dict:
    return ser.workspace(require_ws(st, key))


@router.get("/topics", response_model=List[RecentTopic])
def recent_topics(limit: int = Query(12, ge=1, le=50), st: AppState = Depends(state)) -> List[Dict]:
    """Recently built topic maps on this machine (newest first)."""
    d = st.cfg.workspace_dir
    if not os.path.isdir(d):
        return []
    files = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".json") and not f.endswith(".gaps.json")]
    files.sort(key=os.path.getmtime, reverse=True)
    out: List[Dict] = []
    seen: set = set()
    version = st.version if st.bundle is not None else None
    for f in files[: limit * 3]:
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        if version and data.get("bundle_version") != version:
            continue
        q = " ".join(str(data.get("query", "")).lower().split())
        if not q or q in seen:
            continue
        seen.add(q)
        key = str(data.get("key"))
        out.append({"key": key, "query": data.get("query", ""), "created_at": float(data.get("created_at") or 0),
                    "n_papers": len(data.get("papers") or []),
                    "n_subtopics": sum(1 for s in data.get("subtopics") or [] if s.get("parent") is None),
                    "has_gaps": os.path.exists(os.path.join(d, f"{key}.gaps.json"))})
        if len(out) >= limit:
            break
    return out
