"""Search relevance judging: real graded labels (0/1/2) for benchmark queries.

The search quality gate used to rest on heuristic grades (expected category / keyword), which is circular.
This page pools the top results of several retrieval methods (dense, lexical, hybrid and the configured
pipeline), shows them blind and in a stable shuffled order, and stores grades in
``configs/search_judgments.json``, the file the validation stage and the Kaggle benchmark notebooks read.
"""
from __future__ import annotations

import hashlib
import os
import threading
from typing import Dict, List

from fastapi import APIRouter, Depends, Query

from ...search import search
from ...utils import load_json, save_json
from .. import serialize as ser
from ..deps import state
from ..schemas import JudgeIn, JudgePool, JudgeQuery
from ..state import AppState

router = APIRouter(tags=["evaluation"])
_LOCK = threading.Lock()
POOL_DEPTH = 10


def _path(st: AppState) -> str:
    return st.cfg.abspath(st.cfg["validation"]["judgments_file"] or "configs/search_judgments.json")


def _load(st: AppState) -> Dict:
    p = _path(st)
    data = load_json(p) if os.path.exists(p) else {}
    data.setdefault("judgments", {})
    return data


@router.get("/judgments/queries", response_model=List[JudgeQuery])
def queries(st: AppState = Depends(state)) -> List[Dict]:
    spec_path = st.cfg.abspath(st.cfg["validation"]["queries_file"])
    spec = load_json(spec_path) if os.path.exists(spec_path) else {"queries": []}
    judged = _load(st)["judgments"]
    out = [{"query": q["query"], "area": q.get("area", ""), "n_judged": len(judged.get(q["query"], {}))}
           for q in spec.get("queries", [])]
    known = {q["query"] for q in out}
    out += [{"query": q, "area": "custom", "n_judged": len(v)} for q, v in judged.items() if q not in known]
    return out


@router.get("/judgments/pool", response_model=JudgePool)
def pool(query: str = Query(..., min_length=1, max_length=300), st: AppState = Depends(state)) -> Dict:
    b = st.require()
    ids: List[int] = []
    for mode in ("dense", "lexical", "hybrid", None):
        if mode == "dense" and b.embedder is None:
            continue
        res = search(query, b.embedder, b.embeddings, b.df, b.labels, b.clusters_meta, top_k=POOL_DEPTH,
                     bm25=b.bm25, index=b.index, cfg=st.cfg, phrase_index=b.phrase, acronyms=b.acronyms, mode=mode)
        ids += [int(i) for i in res["result_indices"]]
    uniq = list(dict.fromkeys(ids))
    uniq.sort(key=lambda i: hashlib.sha1(f"{query}|{i}".encode()).hexdigest())   # blind, stable order
    grades = _load(st)["judgments"].get(query, {})
    cands = []
    for i in uniq:
        r = b.df.iloc[i]
        aid = str(r["arxiv_id"])
        cands.append({"paper_id": aid, "title": str(r["title"]), "abstract": ser.snippet(r.get("abstract"), 900),
                      "date": r["date"].strftime("%Y-%m-%d"), "primary_category": str(r["primary_category"]),
                      "grade": grades.get(aid)})
    return {"query": query, "candidates": cands}


@router.post("/judgments")
def judge(body: JudgeIn, st: AppState = Depends(state)) -> Dict[str, int]:
    with _LOCK:
        data = _load(st)
        q = data["judgments"].setdefault(body.query, {})
        if body.grade is None:
            q.pop(body.paper_id, None)
        else:
            q[body.paper_id] = int(body.grade)
        if not q:
            data["judgments"].pop(body.query, None)
        save_json(data, _path(st))
        total = sum(len(v) for v in data["judgments"].values())
    return {"judged_for_query": len(data["judgments"].get(body.query, {})), "total": total}
