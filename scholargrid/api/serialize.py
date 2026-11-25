"""Turn library objects (bundle rows, search dicts, workspaces) into the API's response shapes."""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

from ..labeling import pretty_label

PALETTE = [
    "#3b6fe0", "#e07a1f", "#1f9d6e", "#d14b45", "#7a5ad6", "#c59a00",
    "#0f8aa8", "#c24a86", "#6b8f2a", "#8f6c3a", "#4c6bd9", "#2aa198",
    "#b5582f", "#5f69d4", "#3d8f40", "#a14a9b", "#127d8d", "#b0781d",
    "#6d5bd0", "#2f7d5c",
]
ABSTRACT_LIST_CHARS = 420


def clean(v: Any, default: Any = "") -> Any:
    """NaN/None -> default; numpy scalars -> Python."""
    if v is None:
        return default
    if isinstance(v, float) and math.isnan(v):
        return default
    if isinstance(v, (np.floating,)):
        f = float(v)
        return default if math.isnan(f) else f
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    try:
        if pd.isna(v):
            return default
    except (TypeError, ValueError):
        pass
    return v


def snippet(text: Any, n: int = ABSTRACT_LIST_CHARS) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


# ---------------------------------------------------------------------------
# Areas
# ---------------------------------------------------------------------------
def area_info(clusters: Dict, cid: Any) -> Dict:
    if cid is None:
        return {}
    return clusters.get(int(cid)) or clusters.get(str(cid)) or {}


def area_name(clusters: Dict, cid: Any) -> str:
    if cid is None:
        return ""
    if int(cid) == -1:
        return "Unclustered"
    info = area_info(clusters, cid)
    if info.get("keywords"):
        return pretty_label(info["keywords"])
    return str(info.get("label") or f"Area {cid}")


def area_colors(clusters: Dict) -> Dict[int, str]:
    order = sorted(clusters.values(), key=lambda c: -int(c.get("size", 0)))
    return {int(c["cluster_id"]): PALETTE[i % len(PALETTE)] for i, c in enumerate(order)}


# ---------------------------------------------------------------------------
# Papers
# ---------------------------------------------------------------------------
def is_arxiv_id(pid: str) -> bool:
    s = str(pid or "")
    return bool(s) and (s[:4].isdigit() and "." in s or "/" in s and not s.startswith("http"))


def links(arxiv_id: str = "", doi: str = "", openalex_id: str = "", url: str = "") -> Dict[str, str]:
    out = {"abs": "", "pdf": "", "html": "", "doi": "", "openalex": "", "semantic_scholar": ""}
    if arxiv_id:
        out["abs"] = f"https://arxiv.org/abs/{arxiv_id}"
        out["pdf"] = f"https://arxiv.org/pdf/{arxiv_id}"
        out["html"] = f"https://arxiv.org/html/{arxiv_id}"
        out["semantic_scholar"] = f"https://www.semanticscholar.org/arxiv/{arxiv_id}"
    elif url:
        out["abs"] = url
    if doi:
        d = str(doi).replace("https://doi.org/", "")
        out["doi"] = f"https://doi.org/{d}"
    if openalex_id:
        oid = str(openalex_id).rsplit("/", 1)[-1]
        out["openalex"] = f"https://openalex.org/{oid}"
    return out


def hit(r: Dict, clusters: Dict, abstract_chars: int = ABSTRACT_LIST_CHARS) -> Dict:
    """A search/similar result dict from the library -> ``PaperHit``."""
    cid = r.get("cluster_id")
    in_collection = r.get("bundle_index") is not None
    return {
        "rank": int(r.get("rank") or 0),
        "paper_id": str(r.get("paper_id") or r.get("arxiv_id") or ""),
        "arxiv_id": str(clean(r.get("arxiv_id"))),
        "doi": str(clean(r.get("doi"))),
        "url": str(clean(r.get("url")) or clean(r.get("arxiv_url"))),
        "title": str(clean(r.get("title"))),
        "abstract": snippet(r.get("abstract"), abstract_chars),
        "authors": str(clean(r.get("authors"))),
        "venue": str(clean(r.get("venue"))),
        "primary_category": str(clean(r.get("primary_category"))),
        "date": str(clean(r.get("date")))[:10],
        "area_id": None if cid is None or not in_collection else int(cid),
        "area_name": area_name(clusters, cid) if cid is not None and in_collection else "",
        "score": float(clean(r.get("score"), 0.0) or 0.0),
        "sim": None if r.get("sim") is None else float(r["sim"]),
        "cited_by_count": int(clean(r.get("cited_by_count"), 0) or 0),
        "citation_velocity": float(clean(r.get("citation_velocity"), 0.0) or 0.0),
        "matched_terms": [str(t) for t in (r.get("matched_terms") or [])],
        "match": str(r.get("match") or "related"),
        "match_level": None if r.get("match_level") is None else int(r["match_level"]),
        "sources": [str(s) for s in (r.get("sources") or [])],
        "is_new": bool(r.get("is_new")),
        "in_collection": in_collection,
    }


def bundle_hit(bundle: Any, i: int, sim: Optional[float] = None) -> Dict:
    r = bundle.df.iloc[int(i)]
    aid = str(r["arxiv_id"])
    return hit({"paper_id": aid, "arxiv_id": aid, "doi": r.get("doi", ""), "url": f"https://arxiv.org/abs/{aid}",
                "title": r["title"], "abstract": r.get("abstract", ""), "authors": r.get("authors", ""),
                "venue": r.get("venue", ""), "primary_category": r["primary_category"],
                "date": pd.Timestamp(r["date"]).strftime("%Y-%m-%d"), "cluster_id": int(bundle.labels[int(i)]),
                "sim": sim, "score": sim or 0.0, "cited_by_count": r.get("cited_by_count", 0),
                "citation_velocity": r.get("citation_velocity", 0.0), "sources": ["collection"],
                "bundle_index": int(i)}, bundle.clusters_meta)


def area_distribution(results: Iterable[Dict]) -> List[Dict]:
    counts: Dict[Any, Dict] = {}
    for r in results:
        if r.get("area_id") is None:
            continue
        c = counts.setdefault(r["area_id"], {"area_id": r["area_id"], "name": r["area_name"], "count": 0})
        c["count"] += 1
    return sorted(counts.values(), key=lambda c: -c["count"])


def split_authors(value: Any) -> List[str]:
    s = str(clean(value))
    sep = ";" if ";" in s else ","
    return [a.strip() for a in s.split(sep) if a.strip()]


def row_index(bundle: Any) -> Dict[str, int]:
    idx = getattr(bundle, "_sg_row_index", None)
    if idx is None:
        idx = {str(a): i for i, a in enumerate(bundle.df["arxiv_id"].astype(str))}
        bundle._sg_row_index = idx
    return idx


def _group_facets(rows: pd.DataFrame) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    for facet, g in rows.groupby("facet", sort=False):
        vals = [str(v) for v in g["value"].fillna(g["value_raw"]).astype(str) if str(v).strip()]
        out[str(facet)] = list(dict.fromkeys(vals))[:12]
    return out


def paper_detail(bundle: Any, searcher: Any, paper_id: str) -> Optional[Dict]:
    from ..foundations.surveys import is_survey

    pid = str(paper_id)
    i = row_index(bundle).get(pid)
    if i is None:
        rec = searcher.paper(pid) if searcher is not None else None
        if rec is None:
            return None
        aid = str(clean(rec.get("arxiv_id")))
        return {
            "paper_id": pid, "arxiv_id": aid, "doi": str(clean(rec.get("doi"))), "title": str(rec.get("title") or ""),
            "abstract": str(clean(rec.get("abstract"))),
            "authors": split_authors(rec.get("authors")),
            "venue": str(clean(rec.get("venue"))), "date": str(clean(rec.get("date")))[:10],
            "primary_category": str(clean(rec.get("primary_category"))),
            "cited_by_count": int(clean(rec.get("cited_by_count"), 0) or 0), "in_collection": False,
            "is_survey": is_survey(str(rec.get("title") or ""), str(clean(rec.get("abstract")))),
            "sources": [str(s) for s in rec.get("sources") or []],
            "links": links(aid, str(clean(rec.get("doi"))), "", str(clean(rec.get("url")))),
        }
    r = bundle.df.iloc[i]
    aid = str(r["arxiv_id"])
    cid = int(bundle.labels[i])
    out: Dict[str, Any] = {
        "paper_id": aid, "arxiv_id": aid, "doi": str(clean(r.get("doi"))), "title": str(r["title"]),
        "abstract": str(clean(r.get("abstract"))),
        "authors": split_authors(r.get("authors")),
        "venue": str(clean(r.get("venue"))), "venue_type": str(clean(r.get("venue_type"))),
        "date": pd.Timestamp(r["date"]).strftime("%Y-%m-%d"), "primary_category": str(r["primary_category"]),
        "categories": [c for c in str(clean(r.get("categories"))).split() if c],
        "journal_ref": str(clean(r.get("journal_ref"))), "license": str(clean(r.get("license"))),
        "cited_by_count": int(clean(r.get("cited_by_count"), 0) or 0),
        "reference_count": int(clean(r.get("reference_count"), 0) or 0),
        "citation_velocity": float(clean(r.get("citation_velocity"), 0.0) or 0.0),
        "area": None if cid == -1 else {"id": cid, "name": area_name(bundle.clusters_meta, cid)},
        "in_collection": True,
        "is_survey": is_survey(str(r["title"]), str(clean(r.get("abstract")))),
        "sources": ["collection"],
        "links": links(aid, str(clean(r.get("doi"))), str(clean(r.get("openalex_id")))),
    }
    facets = getattr(bundle, "facets", None)
    if facets is not None and len(facets):
        out["facets"] = _group_facets(facets[facets["arxiv_id"].astype(str) == aid])
    problems = getattr(bundle, "problems", None)
    if problems is not None and len(problems):
        rows = problems[problems["arxiv_id"].astype(str) == aid]
        out["problems"] = [{
            "problem_id": str(p.problem_id), "statement": str(clean(p.statement)), "quote": str(clean(p.quote)),
            "section": str(clean(p.section)), "section_kind": str(clean(p.section_kind)),
            "problem_type": str(clean(p.problem_type)),
            "anchor_url": f"https://arxiv.org/html/{aid}#{clean(p.anchor)}" if clean(p.anchor) else "",
            "verified": float(clean(p.verified_ratio, 0.0) or 0.0) >= 90,
        } for p in rows.itertuples()]
    findings = getattr(bundle, "findings", None)
    if findings is not None and len(findings):
        rows = findings[findings["arxiv_id"].astype(str) == aid]
        out["findings"] = [{k: str(clean(getattr(f, k))) for k in
                            ("claim", "task", "dataset", "metric", "direction", "compared_to")}
                           for f in rows.itertuples()]
    profiles = getattr(bundle, "profiles", None)
    if profiles is not None and len(profiles):
        rows = profiles[profiles["arxiv_id"].astype(str) == aid]
        if len(rows):
            p = rows.iloc[0]
            ev = {k.replace("eval_", ""): (None if clean(p.get(k), None) is None else bool(p.get(k)))
                  for k in p.index if str(k).startswith("eval_")}
            dr = clean(p.get("data_released"), None)
            out["profile"] = {"summary": str(clean(p.get("summary"))), "code_url": str(clean(p.get("code_url"))),
                              "data_released": None if dr is None else bool(dr),
                              "compute": str(clean(p.get("compute"), "unknown")), "evaluation": ev,
                              "mode": str(clean(p.get("mode")))}
    return out


def paper_record(bundle: Any, searcher: Any, paper_id: str, record: Optional[Dict] = None) -> Optional[Dict]:
    """A saveable dict for a project (collection or live paper)."""
    fields = ["paper_id", "arxiv_id", "doi", "url", "title", "authors", "venue", "date", "primary_category",
              "cited_by_count", "sources"]
    if record:
        row = dict(record)
    else:
        d = paper_detail(bundle, searcher, paper_id)
        if d is None:
            return None
        row = dict(d, authors="; ".join(d.get("authors") or []), url=(d.get("links") or {}).get("abs", ""))
    out = {k: clean(row.get(k), "") for k in fields}
    out["paper_id"] = str(paper_id)
    out["date"] = str(out["date"] or "")[:10]
    return out


# ---------------------------------------------------------------------------
# Workspaces
# ---------------------------------------------------------------------------
def workspace(ws: Any) -> Dict:
    from ..workspace.activity import recently_active

    subs = []
    for s in ws.subtopics:
        d = dict(s.__dict__)
        d["recently_active"] = bool(recently_active(int(s.size), float(s.recent_share)))
        subs.append(d)
    papers = [{
        "paper_id": p.paper_id, "title": p.title, "abstract": snippet(p.abstract), "date": str(p.date or ""),
        "cited_by_count": int(p.cited_by_count or 0), "url": p.url, "in_collection": p.bundle_index is not None,
        "is_new": bool(p.is_new), "sim": None if p.sim is None else round(float(p.sim), 4),
        "subtopic": int(p.subtopic), "micro": int(p.micro)} for p in ws.papers]
    path = [{k: v for k, v in it.items() if k not in ("abstract", "bundle_index")} for it in (ws.reading_path or [])]
    ov = ws.overview or {}
    return {"key": ws.key, "query": ws.query, "bundle_version": ws.bundle_version, "created_at": ws.created_at,
            "overview": {"summary": str(ov.get("summary") or ""), "how_they_relate": str(ov.get("how_they_relate") or ""),
                         "prerequisites": [str(x) for x in ov.get("prerequisites") or []]},
            "subtopics": subs, "papers": papers, "reading_path": path,
            "stats": json_safe(ws.stats or {}), "llm_used": bool(ws.llm_used), "warnings": list(ws.warnings or [])}


def json_safe(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [json_safe(v) for v in obj.tolist()]
    if isinstance(obj, (pd.Timestamp,)):
        return obj.isoformat()
    v = clean(obj, None)
    return v


# ---------------------------------------------------------------------------
# Growth
# ---------------------------------------------------------------------------
def growth_of(growth: Dict, cid: Any) -> Dict:
    cl = (growth or {}).get("clusters") or {}
    return cl.get(str(cid)) or cl.get(cid) or {}


def growth_text(growth: Dict, cid: Any) -> str:
    g = growth_of(growth, cid)
    w = ((g.get("windows") or {}).get(str(growth.get("default_window"))) or {}) if g else {}
    months = growth.get("default_window")
    counts = f"{w.get('recent_count', 0)} papers in the last {months} months vs {w.get('previous_count', 0)} before"
    if not (g and g.get("reliable")) or w.get("relative_growth") is None:
        return f"{counts}. The trend is not reliable yet."
    lo, hi = (w.get("ci") or [None, None])[:2]
    level = int(round(float((growth.get("gate") or {}).get("ci_level", 0.9)) * 100))
    ci = f" ({level}% interval {lo:.2f}–{hi:.2f})" if lo is not None else ""
    return f"{w['relative_growth']:.2f}× the CS-wide rate{ci}; {counts}."
