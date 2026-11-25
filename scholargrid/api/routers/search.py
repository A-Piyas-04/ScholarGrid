"""Paper search over the collection plus live sources (arXiv, OpenAlex, Semantic Scholar)."""
from __future__ import annotations

import time
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request

from ...search import SearchFilters
from .. import serialize as ser
from ..deps import state, track
from ..schemas import AreaCount, PaperHit, SearchOut
from ..state import AppState

router = APIRouter(tags=["search"])


def _categories(values: Optional[List[str]]) -> List[str]:
    out: List[str] = []
    for v in values or []:
        out += [c.strip() for c in v.split(",") if c.strip()]
    return out


@router.get("/search", response_model=SearchOut)
def search(request: Request,
           q: str = Query(..., min_length=1, max_length=300, description="What to look for"),
           date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
           date_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
           categories: Optional[List[str]] = Query(None, description="arXiv categories, e.g. cs.CL"),
           min_citations: int = Query(0, ge=0),
           venue_only: bool = False,
           sort: Literal["relevance", "newest", "most_cited", "citation_velocity"] = Query("relevance"),
           live: bool = Query(True, description="Also query live sources (slower)"),
           pages: int = Query(1, ge=1, le=6),
           st: AppState = Depends(state)) -> SearchOut:
    b = st.require()
    t0 = time.time()
    filters = SearchFilters(date_from=date_from or None, date_to=date_to or None, categories=_categories(categories),
                            min_citations=min_citations, venue_only=venue_only)
    res = st.searcher.run(q, filters=filters if filters.active() else None, sort=sort, pages=pages, live=live)
    hits = [ser.hit(r, b.clusters_meta) for r in res["results"]]
    areas = ser.area_distribution(hits)
    track(st, request, "search", live=live, n=len(hits), page=pages)
    return SearchOut(
        query=res["query"], mode=str(res.get("mode") or ""), degraded=bool(res.get("degraded")),
        expansion=[str(x) for x in res.get("expansion") or []], results=[PaperHit(**h) for h in hits],
        areas=[AreaCount(**a) for a in areas],
        n_exact=int(res.get("n_exact", 0)), n_related=int(res.get("n_related", 0)),
        n_exact_total=int(res.get("n_exact_total", 0)), about_total=int(res.get("about_total", 0)),
        source_totals={k: int(v) for k, v in (res.get("source_totals") or {}).items() if v is not None},
        source_status={k: str(v) for k, v in (res.get("source_status") or {}).items()},
        has_more=bool(res.get("has_more")), live=bool(res.get("live")),
        live_seconds=float(res.get("live_seconds") or 0.0), n_found_online=int(res.get("n_found_online") or 0),
        ambiguous=sum(1 for a in areas if a["area_id"] != -1) > 1,
        elapsed_ms=int((time.time() - t0) * 1000))


@router.get("/categories", response_model=List[List[str | int]])
def categories(st: AppState = Depends(state)) -> List[List[str | int]]:
    """Primary categories in the collection with paper counts (for search filters)."""
    b = st.require()
    vc = b.df["primary_category"].value_counts()
    return [[str(k), int(v)] for k, v in vc.items()]
