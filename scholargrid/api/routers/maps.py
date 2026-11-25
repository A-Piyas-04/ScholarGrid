"""The research map: a bounded sample of the collection (most-cited papers per area) with similarity and
bibliographic-coupling edges, for the Sigma.js view. Abstracts are not sent; the client fetches details on
selection. Search matches outside the sample come back as ``extra`` papers so the client can add them."""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

import numpy as np
from fastapi import APIRouter, Depends, Query

from ...search import search
from .. import serialize as ser
from ..deps import state
from ..state import AppState

router = APIRouter(tags=["map"])


def _select_nodes(bundle: Any, cap: int) -> np.ndarray:
    df = bundle.df
    n = len(df)
    if n <= cap:
        return np.arange(n)
    order = df.assign(_i=np.arange(n)).sort_values("cited_by_count", ascending=False)
    picks = []
    for _, g in order.groupby("cluster_id", sort=False):
        quota = max(1, int(round(cap * len(g) / n)))
        picks.append(g["_i"].to_numpy()[:quota])
    return np.sort(np.concatenate(picks)[:cap])


def _short_authors(authors: str, n: int = 3) -> str:
    names = ser.split_authors(authors)
    return "; ".join(names[:n]) + (" et al." if len(names) > n else "")


def _paper(r: Any, p: int) -> Dict[str, Any]:
    return {"i": p, "id": str(r.arxiv_id), "t": str(r.title), "au": _short_authors(str(r.authors or "")),
            "d": r.date.strftime("%Y-%m-%d"), "c": int(r.cluster_id), "cat": str(r.primary_category),
            "x": round(float(r.x2d), 4), "y": round(float(r.y2d), 4), "ci": int(r.cited_by_count),
            "rf": int(r.reference_count), "v": str(r.venue or ""), "ab": ""}


def payload(st: AppState) -> Tuple[Dict[str, Any], Dict[int, int]]:
    b = st.require()
    key = ("map", b.path)
    if key in st.map_cache:
        return st.map_cache[key]
    df, clusters = b.df, b.clusters_meta
    colors = ser.area_colors(clusters)
    keep = _select_nodes(b, int(st.cfg["app"]["max_graph_nodes"]))
    pos = {int(orig): p for p, orig in enumerate(keep)}
    sub = df.iloc[keep]
    papers = [_paper(r, p) for p, r in enumerate(sub.itertuples(index=False))]
    if len(keep) == len(df):
        edges, neighbors = b.edges, b.neighbors
    else:
        edges = [[pos[a], pos[bb], *rest] for a, bb, *rest in b.edges if a in pos and bb in pos]
        neighbors = {str(pos[int(k)]): [[pos[j], s] for j, s in v if j in pos]
                     for k, v in b.neighbors.items() if int(k) in pos}
    count: Dict[int, int] = {}
    cx: Dict[int, float] = {}
    cy: Dict[int, float] = {}
    for p in papers:
        c = p["c"]
        if c < 0:
            continue
        count[c] = count.get(c, 0) + 1
        cx[c] = cx.get(c, 0.0) + p["x"]
        cy[c] = cy.get(c, 0.0) + p["y"]
    areas = []
    for c in sorted(clusters.values(), key=lambda c: -int(c.get("size", 0))):
        cid = int(c["cluster_id"])
        rc = count.get(cid, 0)
        a = {"id": cid, "name": ser.area_name(clusters, cid), "color": colors[cid], "size": int(c.get("size", 0)),
             "rc": rc}
        if rc:
            a["x"], a["y"] = round(cx[cid] / rc, 4), round(cy[cid] / rc, 4)
        areas.append(a)
    paper_area = [p["c"] for p in papers]
    pair_w: Dict[Tuple[int, int], float] = {}
    for a, bb, w, *_ in edges:
        ca, cb = paper_area[a], paper_area[bb]
        if ca < 0 or cb < 0 or ca == cb:
            continue
        k = (ca, cb) if ca < cb else (cb, ca)
        pair_w[k] = pair_w.get(k, 0.0) + float(w)
    cats = sub["primary_category"].value_counts().head(30)
    cited_share = float((sub["cited_by_count"] > 0).mean()) if len(sub) else 0.0
    out = {"version": str(b.meta.get("generated_at", "")), "papers": papers, "edges": edges, "neighbors": neighbors,
           "areas": areas, "areaEdges": [[a, bb, round(w, 3)] for (a, bb), w in pair_w.items()],
           "categories": [[str(k), int(v)] for k, v in cats.items()],
           "sizeBy": "citations" if cited_share >= 0.2 else "links", "corpusTotal": int(len(df)),
           "renderedTotal": int(len(keep)), "maxAreaPapers": int(st.cfg["app"].get("max_area_papers", 400))}
    st.map_cache[key] = (out, pos)
    return out, pos


@router.get("/map")
def map_payload(st: AppState = Depends(state)) -> Dict[str, Any]:
    return payload(st)[0]


@router.get("/map/search")
def map_search(q: str = Query(..., min_length=1, max_length=300), k: int = Query(40, ge=1, le=200),
               st: AppState = Depends(state)) -> Dict[str, Any]:
    """Matches as ``[payload index, score]``; matches outside the sample are returned in ``extra`` with
    indices continuing after the payload's papers, in the same order."""
    b = st.require()
    data, pos = payload(st)
    res = search(q, b.embedder, b.embeddings, b.df, b.labels, b.clusters_meta, top_k=k, bm25=b.bm25, index=b.index,
                 cfg=st.cfg, phrase_index=b.phrase, acronyms=b.acronyms)
    items: List[List[float]] = []
    extra: List[Dict[str, Any]] = []
    nxt = len(data["papers"])
    for r, i in zip(res["results"], res["result_indices"]):
        score = float(r.get("sim") if r.get("sim") is not None else r.get("score") or 0.0)
        if int(i) in pos:
            items.append([pos[int(i)], round(score, 4)])
        else:
            row = next(b.df.iloc[[int(i)]].itertuples(index=False))
            extra.append(_paper(row, nxt))
            items.append([nxt, round(score, 4)])
            nxt += 1
    areas = {r["cluster_id"] for r in res["results"] if r["cluster_id"] != -1}
    return {"query": res["query"], "items": items, "extra": extra, "ambiguous": len(areas) > 1,
            "degraded": bool(res.get("degraded"))}
