"""Collection-wide research areas (global clusters), their growth, and the opportunity view (trends)."""
from __future__ import annotations

from typing import Any, Dict, List, Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from ...opportunity import QUADRANTS, opportunity_table
from ...workspace.labels import top_facets
from .. import serialize as ser
from ..deps import state
from ..schemas import AreaDetail, AreaPapersOut, AreaSummary, TrendsOut
from ..state import AppState

router = APIRouter(tags=["areas"])


def _opportunity(st: AppState) -> pd.DataFrame:
    b = st.require()
    cache = st.map_cache
    key = ("opportunity", b.path)
    if key not in cache:
        cache[key] = opportunity_table(b)
    return cache[key]


def _summaries(st: AppState) -> List[Dict[str, Any]]:
    b = st.require()
    colors = ser.area_colors(b.clusters_meta)
    opp = _opportunity(st).set_index("area_id") if len(_opportunity(st)) else pd.DataFrame()
    out = []
    for cid, info in b.clusters_meta.items():
        cid = int(cid)
        o = opp.loc[cid] if len(opp) and cid in opp.index else None
        ci = None if o is None or o["growth_ci"] is None or (isinstance(o["growth_ci"], float)) else \
            [float(x) for x in o["growth_ci"]]
        quad = str(o["quadrant"]) if o is not None else ""
        out.append({
            "id": cid, "name": ser.area_name(b.clusters_meta, cid), "label": str(info.get("label", "")),
            "size": int(info.get("size", 0)), "color": colors.get(cid, ser.PALETTE[0]),
            "keywords": [str(k) for k in info.get("keywords") or []][:10],
            "top_categories": {str(k): int(v) for k, v in (info.get("top_categories") or {}).items()},
            "recent_papers": int(o["recent_papers"]) if o is not None else 0,
            "crowdedness": float(o["crowdedness"]) if o is not None else 0.0,
            "growth": None if o is None or pd.isna(o["growth"]) else float(o["growth"]),
            "growth_ci": ci, "reliable": bool(o["reliable"]) if o is not None else False,
            "quadrant": quad, "advice": QUADRANTS.get(quad, ""),
            "open_problems": int(o["open_problems"]) if o is not None else 0,
            "stated_per_100": None if o is None or pd.isna(o["stated_per_100"]) else float(o["stated_per_100"]),
            "stability": ser.clean(info.get("stability_survival"), None),
        })
    return sorted(out, key=lambda a: -a["size"])


@router.get("/areas", response_model=List[AreaSummary])
def areas(st: AppState = Depends(state)) -> List[Dict]:
    return _summaries(st)


def _area_rows(st: AppState, cid: int) -> np.ndarray:
    b = st.require()
    rows = np.flatnonzero(np.asarray(b.labels) == int(cid))
    if not len(rows):
        raise HTTPException(404, "No such area")
    return rows


@router.get("/areas/{cid}", response_model=AreaDetail)
def area(cid: int, st: AppState = Depends(state)) -> Dict:
    b = st.require()
    summary = next((a for a in _summaries(st) if a["id"] == cid), None)
    if summary is None:
        raise HTTPException(404, "No such area")
    rows = _area_rows(st, cid)
    info = ser.area_info(b.clusters_meta, cid)
    sub = b.df.iloc[rows]
    g = ser.growth_of(b.growth, cid)
    windows = []
    for months, w in sorted(((int(k), v) for k, v in (g.get("windows") or {}).items()), key=lambda t: t[0]):
        windows.append({"months": months, "recent_count": int(w.get("recent_count") or 0),
                        "previous_count": int(w.get("previous_count") or 0),
                        "relative_growth": w.get("relative_growth"), "ci": w.get("ci"),
                        "direction": w.get("direction"), "passes_gate": bool(w.get("passes_gate"))})
    rep_ids = [str(p.get("arxiv_id")) for p in info.get("representative_papers") or []]
    idx = ser.row_index(b)
    rep = [ser.bundle_hit(b, idx[a]) for a in rep_ids if a in idx]
    cites = sub["cited_by_count"].to_numpy()
    most: Any = rows[np.argsort(-cites, kind="stable")[:8]] if cites.max(initial=0) > 0 else []
    newest = rows[np.argsort(-sub["date"].astype("int64").to_numpy(), kind="stable")[:8]]
    ids = sub["arxiv_id"].astype(str).tolist()
    path = (b.reading_paths or {}).get(str(cid)) or (b.reading_paths or {}).get(cid) or []
    cards = ((b.gaps or {}).get("areas") or {}).get(str(cid)) or []
    return {**summary, "monthly": {str(k): int(v) for k, v in (g.get("monthly_counts") or {}).items()},
            "windows": windows, "growth_text": ser.growth_text(b.growth, cid),
            "representative": rep, "most_cited": [ser.bundle_hit(b, int(i)) for i in most],
            "newest": [ser.bundle_hit(b, int(i)) for i in newest],
            "top_facets": top_facets(b.facets, ids, n=6) if len(b.facets) else {},
            "reading_path": [{k: v for k, v in it.items() if k not in ("abstract", "bundle_index")} for it in path],
            "gap_cards": cards}


@router.get("/areas/{cid}/papers", response_model=AreaPapersOut)
def area_papers(cid: int, sort: Literal["cited", "newest", "central"] = Query("cited"),
                offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100),
                st: AppState = Depends(state)) -> Dict:
    b = st.require()
    rows = _area_rows(st, cid)
    sub = b.df.iloc[rows]
    if sort == "cited":
        order = np.argsort(-sub["cited_by_count"].to_numpy(), kind="stable")
    elif sort == "newest":
        order = np.argsort(-sub["date"].astype("int64").to_numpy(), kind="stable")
    else:
        e = np.asarray(b.embeddings[rows], dtype=np.float32)
        c = e.mean(axis=0)
        c /= np.linalg.norm(c) + 1e-9
        order = np.argsort(-(e @ c), kind="stable")
    pick = rows[order[offset: offset + limit]]
    return {"total": int(len(rows)), "results": [ser.bundle_hit(b, int(i)) for i in pick]}


@router.get("/trends", response_model=TrendsOut)
def trends(st: AppState = Depends(state)) -> Dict:
    b = st.require()
    g = b.growth or {}
    corpus_monthly = b.df["year_month"].value_counts().sort_index()
    area_monthly: Dict[str, Dict[str, int]] = {}
    for cid in b.clusters_meta:
        gm = ser.growth_of(g, cid).get("monthly_counts") or {}
        area_monthly[str(int(cid))] = {str(k): int(v) for k, v in gm.items()}
    return {"reference_date": str(g.get("reference_date", "")), "default_window": int(g.get("default_window", 6)),
            "windows": [int(x) for x in g.get("windows_months") or []],
            "corpus_growth": {str(k): float(v) for k, v in (g.get("corpus_raw_growth") or {}).items() if v is not None},
            "history_days": int(g.get("history_days") or 0), "sufficient_history": bool(g.get("sufficient_history")),
            "ci_level": float((g.get("gate") or {}).get("ci_level", 0.9)), "quadrants": QUADRANTS,
            "areas": _summaries(st), "corpus_monthly": {str(k): int(v) for k, v in corpus_monthly.items()},
            "area_monthly": area_monthly}
