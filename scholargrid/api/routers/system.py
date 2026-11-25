"""Health, status, methodology, releases and job polling."""
from __future__ import annotations

import os
import time
from typing import Any, Dict, List

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from ... import __version__
from ...utils import load_json
from ..deps import state
from ..schemas import JobOut, LLMStatus, MethodologyOut, ReleaseInfo, ReleaseRow, StatusOut
from ..state import AppState

router = APIRouter(tags=["system"])


def _age_days(generated_at: Any) -> int | None:
    try:
        ts = pd.Timestamp(generated_at)
    except (TypeError, ValueError):
        return None
    if pd.isna(ts):
        return None
    if ts.tzinfo is not None:
        ts = ts.tz_convert(None)
    return int((pd.Timestamp.now(tz="UTC").tz_convert(None) - ts).days)


def release_info(st: AppState) -> ReleaseInfo:
    b = st.bundle
    meta = b.meta
    snap = meta.get("snapshot") or {}
    df = b.df
    age = _age_days(meta.get("generated_at"))
    return ReleaseInfo(
        id=os.path.basename(os.path.normpath(b.path)) if b.path else "",
        generated_at=str(meta.get("generated_at", "")),
        n_papers=int(len(df)),
        date_from=str(snap.get("earliest_included_date") or (df["date"].min().strftime("%Y-%m-%d") if len(df) else "")),
        date_to=str(snap.get("latest_included_date") or (df["date"].max().strftime("%Y-%m-%d") if len(df) else "")),
        n_categories=int(snap.get("n_categories") or df["primary_category"].nunique()),
        source=str(snap.get("source", "")),
        synthetic=snap.get("source") == "synthetic",
        embedding_model=str(meta.get("embedding_model", "")),
        semantic_search=b.embedder is not None,
        index=str(getattr(b.index, "backend", "") or "exact"),
        data_age_days=age,
        stale=age is not None and age > int(st.cfg["monitoring"]["stale_after_days"]),
        n_areas=len(b.clusters_meta),
        n_extracted=int(len(b.profiles)) if b.profiles is not None else 0,
        n_problems=int(len(b.problems)) if b.problems is not None else 0,
    )


def llm_status(st: AppState) -> Dict[str, Any]:
    cfg = st.cfg
    try:
        llm = st.llm()
        available = bool(llm.available())
        providers = sorted(getattr(llm, "backends", {}) or {})
    except Exception:
        available, providers = False, []
    return {"provider": str(cfg["llm"]["provider"]), "available": available, "byok_active": st.byok_llm is not None,
            "allow_byok": bool(cfg["llm"]["allow_byok"]) and cfg["llm"]["provider"] == "live",
            "providers": providers}


@router.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@router.get("/status", response_model=StatusOut)
def status(st: AppState = Depends(state)) -> StatusOut:
    ready = st.bundle is not None
    if ready:
        st.maybe_reload()
    scfg = st.cfg["search"]
    return StatusOut(
        ready=ready, loading=st.loading, error=st.load_error,
        release=release_info(st) if ready else None,
        live_search=bool(scfg["live"]) and bool(scfg["live_sources"]),
        live_sources=list(scfg["live_sources"]) if scfg["live"] else [],
        llm=LLMStatus(**llm_status(st)),
        persistence=st.get_repo() is not None, persistence_error=st.repo_error,
        uptime_s=round(time.time() - st.started_at, 1), version=__version__)


@router.get("/methodology", response_model=MethodologyOut)
def methodology(st: AppState = Depends(state)) -> MethodologyOut:
    b = st.require()
    manifest_path = os.path.join(b.path, "manifest.json")
    manifest = load_json(manifest_path) if os.path.exists(manifest_path) else {}
    cm = manifest.get("cluster_match") or {}
    if isinstance(cm.get("disappeared"), list):
        cm = {**cm, "disappeared": len(cm["disappeared"])}
    manifest = {**manifest, "cluster_match": cm}
    meta = b.meta
    params = meta.get("params") or {}
    keep = ("embedding", "index", "reduce", "cluster", "growth", "search", "workspace", "gaps")
    judgments_file = st.cfg.abspath(st.cfg["validation"]["judgments_file"] or "configs/search_judgments.json")
    judged = 0
    if os.path.exists(judgments_file):
        judged = sum(1 for v in (load_json(judgments_file).get("judgments") or {}).values() if v)
    counts = meta.get("counts") or {}
    coverage = {
        "papers": int(len(b.df)), "with_citations": counts.get("with_citations"),
        "with_references": counts.get("with_references"), "noise": counts.get("noise"),
        "edges": counts.get("edges"), "extracted_papers": int(len(b.profiles)),
        "stated_problems": int(len(b.problems)), "findings": int(len(b.findings)),
        "facet_rows": int(len(b.facets)), "live_store_papers": int(len(st.searcher.store)) if st.searcher else 0,
        "enrichment": manifest.get("enrichment") or meta.get("enrichment") or {},
        "cluster_stability": meta.get("cluster_stability"), "ann_recall_at_25": meta.get("ann_recall_at_25"),
    }
    return MethodologyOut(release=release_info(st), manifest=manifest,
                          validation=manifest.get("validation") or {}, backends=meta.get("backends") or {},
                          params={k: params[k] for k in keep if k in params}, coverage=coverage,
                          judged_queries=judged)


@router.get("/releases", response_model=List[ReleaseRow])
def releases(st: AppState = Depends(state)) -> List[ReleaseRow]:
    from ...release import current_release, list_releases

    cfg = st.cfg
    cur = current_release(cfg)
    serving = os.path.basename(os.path.normpath(st.bundle.path)) if st.bundle is not None else None
    rows = []
    for rid in reversed(list_releases(cfg)):
        d = os.path.join(cfg.releases_dir, rid)
        try:
            m = load_json(os.path.join(d, "manifest.json"))
        except Exception:
            m = {}
        gates = (m.get("validation") or {}).get("gates") or {}
        size = sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d) if os.path.isfile(os.path.join(d, f)))
        rows.append(ReleaseRow(id=rid, created_at=str(m.get("created_at", "")), current=rid == cur,
                               serving=rid == serving, n_papers=int((m.get("corpus") or {}).get("n_papers") or 0),
                               embedding_model=str(m.get("embedding_model", "")),
                               gates_passed=gates.get("passed"),
                               ndcg_at_10=((m.get("validation") or {}).get("search") or {}).get("ndcg_at_10"),
                               size_mb=round(size / 1e6, 1), files=sorted(os.listdir(d))))
    return rows


@router.post("/releases/{release_id}/activate", response_model=JobOut)
def activate(release_id: str, st: AppState = Depends(state)) -> Dict[str, Any]:
    """Serve another published release (writes ``data/releases/CURRENT`` and reloads)."""
    from ...release import list_releases, set_current

    if release_id not in list_releases(st.cfg):
        raise HTTPException(404, "No such release")
    if st.cfg["release"].get("pin"):
        raise HTTPException(409, "A release pin is configured (release.pin / SCHOLARGRID_RELEASE); remove it first.")

    def run(progress):
        progress("Switching release…", 0.1)
        set_current(st.cfg, release_id)
        progress("Loading the new release…", 0.3)
        st.load()
        if st.load_error:
            raise RuntimeError(st.load_error)
        return {"release": release_id}

    return st.jobs.submit("release", run, dedupe_key=f"release:{release_id}").public()


@router.get("/jobs/{job_id}", response_model=JobOut)
def job(job_id: str, st: AppState = Depends(state)) -> Dict[str, Any]:
    j = st.jobs.get(job_id)
    if j is None:
        raise HTTPException(404, "Unknown job (it may have expired; start it again)")
    return j.public()
