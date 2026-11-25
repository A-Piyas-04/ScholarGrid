"""Paper details, similar papers and BibTeX export."""
from __future__ import annotations

from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Query

from ...bibtex import to_bibtex
from .. import serialize as ser
from ..deps import state
from ..schemas import BibtexIn, PaperDetail, PaperHit, SimilarOut, TextOut
from ..state import AppState

router = APIRouter(tags=["papers"])


@router.get("/papers/detail", response_model=PaperDetail)
def detail(id: str = Query(..., min_length=1, max_length=300), st: AppState = Depends(state)) -> Dict:
    b = st.require()
    d = ser.paper_detail(b, st.searcher, id)
    if d is None:
        raise HTTPException(404, "This paper is not in the collection or the papers found online.")
    return d


@router.get("/papers/similar", response_model=SimilarOut)
def similar(id: str = Query(..., min_length=1, max_length=300), k: int = Query(12, ge=1, le=50),
            st: AppState = Depends(state)) -> SimilarOut:
    b = st.require()
    res = st.searcher.similar(id, top_k=k)
    title = res.get("query", "").removeprefix("papers like “").removesuffix("”")
    return SimilarOut(paper_id=id, title=title, results=[PaperHit(**ser.hit(r, b.clusters_meta)) for r in res["results"]])


@router.post("/papers/bibtex", response_model=TextOut)
def bibtex(body: BibtexIn, st: AppState = Depends(state)) -> TextOut:
    b = st.require()
    rows = list(body.records)
    for pid in body.paper_ids:
        rec = ser.paper_record(b, st.searcher, pid)
        if rec:
            rows.append(rec)
    return TextOut(filename="scholargrid.bib", media_type="application/x-bibtex", content=to_bibtex(rows))
