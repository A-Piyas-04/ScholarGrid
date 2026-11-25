"""Settings: AI provider status and free-quota counters, and the user's own Gemini key (kept in server
memory only, never written to disk)."""
from __future__ import annotations

import hashlib
import os
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException

from ..deps import state
from ..schemas import ByokIn, SettingsOut
from ..state import AppState
from .system import llm_status

router = APIRouter(tags=["settings"])


def _redact_db(url: str) -> str:
    if "@" in url and "://" in url:
        scheme, rest = url.split("://", 1)
        return f"{scheme}://***@{rest.split('@', 1)[1]}"
    return url


@router.get("/settings", response_model=SettingsOut)
def settings(st: AppState = Depends(state)) -> Dict:
    cfg = st.cfg
    llm = st.llm()
    quota_rows: List[Dict] = []
    q = getattr(llm, "quota", None)
    if q is not None:
        for route in q.routes_seen():
            rpd = (cfg["llm"]["limits"].get(route) or {}).get("rpd")
            quota_rows.append({"route": route, "used_today": q.used_today(route),
                               "remaining_today": q.remaining_today(route), "limit_per_day": rpd})
    tasks = [{"task": t, "route": list(spec["route"])} for t, spec in cfg["llm"]["tasks"].items()]
    return {"llm": llm_status(st), "quota": quota_rows, "tasks": tasks,
            "config_path": os.path.relpath(str(cfg.path), os.getcwd()) if getattr(cfg, "path", None) else "",
            "release_pin": cfg["release"].get("pin"), "db": _redact_db(cfg.db_url),
            "live_sources": list(cfg["search"]["live_sources"]) if cfg["search"]["live"] else []}


@router.post("/settings/byok")
def set_byok(body: ByokIn, st: AppState = Depends(state)) -> Dict[str, bool]:
    """Use your own free Gemini key (one tiny test request first). Lost when the server restarts."""
    from pydantic import BaseModel

    from ...llm import LLMError, build_router
    from ...llm.prompts import render

    cfg = st.cfg
    if not cfg["llm"]["allow_byok"] or cfg["llm"]["provider"] != "live":
        raise HTTPException(409, "Using your own key needs llm.provider: live and llm.allow_byok: true.")

    class _Check(BaseModel):
        ok: bool
        echo: str

    key = body.key.strip()
    udir = os.path.join(cfg.abspath(cfg["llm"]["usage_dir"]), "byok", hashlib.sha256(key.encode()).hexdigest()[:12])
    try:
        router_ = build_router(cfg, api_keys={"gemini": key}, usage_dir=udir)
        if "gemini" not in router_.backends:
            raise LLMError("the key could not be used")
        route = next((r for r in cfg["llm"]["tasks"]["check"]["route"] if r.startswith("gemini:")), None)
        system, user = render("check", word="scholargrid")
        res = router_._run("check", "check", _Check, system, user, only_route=route)
        if not res.value.ok:
            raise LLMError("unexpected answer from the provider")
    except LLMError as exc:
        raise HTTPException(400, f"That key didn't work ({type(exc).__name__}). Check it in Google AI Studio.") from exc
    st.byok_llm = router_
    return {"ok": True}


@router.delete("/settings/byok")
def clear_byok(st: AppState = Depends(state)) -> Dict[str, bool]:
    st.byok_llm = None
    return {"ok": True}
