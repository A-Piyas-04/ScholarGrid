"""A controlled research-brief orchestrator: question -> search plan -> tool calls -> evidence -> cited brief.

This is deliberately not an open-ended agent. The steps and tools are fixed, every tool call is recorded in
a visible trace, the number of calls is capped, and the brief can only cite evidence papers that the tools
returned. Citations to unknown ids are removed and uncited points are dropped. Without an LLM (or when the
free quota is used up) the same pipeline produces an extractive brief, and says so.

Tools (all read-only):
  * ``search_collection`` - hybrid search over the analysed release
  * ``search_live``       - arXiv / OpenAlex / Semantic Scholar (when live search is enabled)
  * ``paper_details``     - abstract, stated open problems (verified quotes) and extracted summary
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import asdict, dataclass, field
from functools import partial
from typing import Any, Callable, Dict, List, Optional

import numpy as np

from ..config import Config
from ..llm.prompts import wrap_untrusted
from ..utils import get_logger, save_json
from . import prompts as _prompts  # noqa: F401  (registers the assistant prompts)
from .prompts import BriefDraft, SearchPlan

log = get_logger("assistant")
Progress = Optional[Callable[[str, float], None]]

MAX_TOOL_CALLS = 14
PER_QUERY = 8
LIVE_QUERIES = 2
LIVE_PER_QUERY = 4
ABSTRACT_CHARS = 1100
_CITE = re.compile(r"\[(P\d+)\]")
_GROUP = re.compile(r"\[((?:P\d+\s*[,;]\s*)+P\d+)\]")


def split_groups(text: str) -> str:
    """'[P3, P4]' -> '[P3][P4]' so grouped citations are verified one by one."""
    return _GROUP.sub(lambda m: "".join(f"[{x.strip()}]" for x in re.split(r"[,;]", m.group(1))), text)


@dataclass
class ToolCall:
    tool: str
    args: Dict[str, Any]
    n_results: int = 0
    ms: int = 0
    note: str = ""


@dataclass
class _Trace:
    calls: List[ToolCall] = field(default_factory=list)

    def run(self, tool: str, args: Dict[str, Any], fn: Callable[[], Any], count: Callable[[Any], int]) -> Any:
        if len(self.calls) >= MAX_TOOL_CALLS:
            self.calls.append(ToolCall(tool, args, 0, 0, "skipped: tool budget reached"))
            return None
        t0 = time.time()
        try:
            out = fn()
            self.calls.append(ToolCall(tool, args, count(out), int((time.time() - t0) * 1000)))
            return out
        except Exception as exc:  # a failing tool never fails the brief
            self.calls.append(ToolCall(tool, args, 0, int((time.time() - t0) * 1000), f"failed: {type(exc).__name__}"))
            return None


def _n(out: Any) -> int:
    return len(out or [])


def _one(out: Any) -> int:
    return 1 if out else 0


def _task(cfg: Config) -> str:
    return "brief" if "brief" in cfg["llm"]["tasks"] else "plan"


def brief_key(question: str, use_live: bool, bundle_version: str, cfg: Config, max_papers: int) -> str:
    q = " ".join(question.lower().split())
    return hashlib.sha1(f"{bundle_version}|{q}|{use_live}|{max_papers}|{cfg['llm']['provider']}".encode()).hexdigest()[:20]


def _cache_path(cfg: Config, key: str) -> str:
    return os.path.join(cfg.workspace_dir, "briefs", f"{key}.json")


def load_cached_brief(cfg: Config, key: str) -> Optional[Dict]:
    p = _cache_path(cfg, key)
    if not os.path.exists(p) or time.time() - os.path.getmtime(p) > float(cfg["workspace"]["cache_ttl_hours"]) * 3600:
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _save(cfg: Config, key: str, data: Dict) -> None:
    try:
        save_json(data, _cache_path(cfg, key))
    except OSError as exc:  # caching is best-effort
        log.info("Brief cache write skipped (%s).", exc)


def _plan(question: str, llm: Any, cfg: Config, trace: _Trace) -> List[str]:
    queries = [" ".join(question.split())[:200]]
    if llm is not None and llm.available():
        from ..llm import LLMError

        t0 = time.time()
        try:
            res = llm.structured(_task(cfg), "assistant_plan", SearchPlan,
                                 question=question.replace("</user_question>", "</ user_question>"))
            queries += res.value.queries
            trace.calls.append(ToolCall("plan_searches", {"model": res.route}, len(res.value.queries),
                                        int((time.time() - t0) * 1000)))
        except LLMError as exc:
            trace.calls.append(ToolCall("plan_searches", {}, 0, int((time.time() - t0) * 1000),
                                        f"AI unavailable ({type(exc).__name__}); searching the question as written"))
    return list(dict.fromkeys(q for q in queries if q))[:5]


def _collection_hits(q: str, bundle: Any, cfg: Config) -> List[Dict]:
    from ..search import search

    res = search(q, bundle.embedder, bundle.embeddings, bundle.df, bundle.labels, bundle.clusters_meta,
                 top_k=PER_QUERY, bm25=bundle.bm25, index=bundle.index, cfg=cfg, phrase_index=bundle.phrase,
                 acronyms=bundle.acronyms)
    return res["results"]


def _live_hits(q: str, searcher: Any) -> List[Dict]:
    res = searcher.run(q, pages=1, live=True)
    return [r for r in res["results"] if r.get("bundle_index") is None][:LIVE_PER_QUERY]


def _details(paper: Dict, bundle: Any, searcher: Any) -> Dict:
    pid = str(paper["paper_id"])
    problems = getattr(bundle, "problems", None)
    stated: List[Dict] = []
    if problems is not None and len(problems):
        rows = problems[problems["arxiv_id"].astype(str) == pid].head(2)
        stated = [{"statement": str(r.statement), "quote": str(r.quote or ""), "section": str(r.section_kind or "")}
                  for r in rows.itertuples()]
    summary = ""
    profiles = getattr(bundle, "profiles", None)
    if profiles is not None and len(profiles):
        rows = profiles[profiles["arxiv_id"].astype(str) == pid]
        if len(rows):
            summary = str(rows.iloc[0].get("summary") or "")
    abstract = str(paper.get("abstract") or "")
    if not abstract and searcher is not None:
        rec = searcher.paper(pid) or {}
        abstract = str(rec.get("abstract") or "")
    return {"abstract": abstract, "problems": stated, "summary": summary}


def _fuse(lists: List[List[Dict]], k: int, rrf_k: int = 60) -> List[Dict]:
    score: Dict[str, float] = {}
    first: Dict[str, Dict] = {}
    for lst in lists:
        for rank, r in enumerate(lst):
            pid = str(r.get("paper_id") or "")
            if not pid:
                continue
            score[pid] = score.get(pid, 0.0) + 1.0 / (rrf_k + rank + 1)
            first.setdefault(pid, r)
    order = sorted(score, key=lambda p: -score[p])
    # make sure every non-empty list contributes its best paper
    must = [str(lst[0]["paper_id"]) for lst in lists if lst]
    picked = list(dict.fromkeys(must + order))[:k]
    return [first[p] for p in picked]


def _evidence_text(ev: List[Dict]) -> str:
    lines = []
    for e in ev:
        lines.append(f"[{e['eid']}] {e['title']} ({e['year'] or 'n.d.'})")
        if e.get("summary"):
            lines.append(f"Summary: {e['summary']}")
        lines.append(f"Abstract: {e['abstract'][:ABSTRACT_CHARS]}")
        for p in e.get("problems") or []:
            lines.append(f"Authors say is open ({p['section'] or 'paper'}): {p['quote'] or p['statement']}")
        lines.append("")
    return wrap_untrusted("evidence", "\n".join(lines))


def _verify(draft: BriefDraft, valid: set) -> Dict:
    removed = 0

    def fix_text(t: str) -> str:
        nonlocal removed
        t = split_groups(t)

        def sub(m: re.Match) -> str:
            nonlocal removed
            if m.group(1) in valid:
                return m.group(0)
            removed += 1
            return ""
        return re.sub(r"\s{2,}", " ", _CITE.sub(sub, t)).strip()

    def fix_points(points: List[Any]) -> List[Dict]:
        nonlocal removed
        out = []
        for p in points:
            cites = [c for c in dict.fromkeys(p.cites) if c in valid]
            removed += len(p.cites) - len(cites)
            cites = list(dict.fromkeys(cites + [c for c in _CITE.findall(split_groups(p.text)) if c in valid]))
            if not cites:
                removed += 1
                continue
            out.append({"text": fix_text(p.text), "cites": cites})
        return out

    sections = [{"heading": s.heading, "points": fix_points(s.points)} for s in draft.sections]
    sections = [s for s in sections if s["points"]]
    return {"answer": fix_text(draft.answer), "sections": sections, "open_questions": fix_points(draft.open_questions),
            "caveats": [c for c in draft.caveats if c.strip()][:5], "removed_citations": removed}


def _first_sentence(text: str, n: int = 260) -> str:
    s = " ".join(str(text or "").split())
    m = re.search(r"(.+?[.!?])(\s|$)", s)
    out = m.group(1) if m else s
    return out if len(out) <= n else out[: n - 1].rsplit(" ", 1)[0] + "…"


def _extractive(question: str, queries: List[str], per_query: Dict[str, List[str]], ev: List[Dict]) -> Dict:
    by_pid = {e["paper_id"]: e for e in ev}
    sections = []
    used: set = set()
    for q in queries:
        pts = []
        for pid in per_query.get(q, []):
            e = by_pid.get(pid)
            if e is None or pid in used:
                continue
            used.add(pid)
            pts.append({"text": f"{e['title']}: {_first_sentence(e['abstract'])}", "cites": [e["eid"]]})
            if len(pts) >= 4:
                break
        if pts:
            sections.append({"heading": f"Papers on “{q}”", "points": pts})
    oq = [{"text": p["statement"], "cites": [e["eid"]]} for e in ev for p in e.get("problems") or []][:6]
    lead = ev[0] if ev else None
    answer = ("No AI summary is available right now, so this brief lists the most relevant papers with their "
              "own first sentences." + (f" The closest match is “{lead['title']}” [{lead['eid']}]." if lead else ""))
    return {"answer": answer, "sections": sections, "open_questions": oq, "caveats": [], "removed_citations": 0}


def to_markdown(brief: Dict) -> str:
    ev = {e["eid"]: e for e in brief.get("evidence", [])}

    def cite(cs: List[str]) -> str:
        return "".join(f" [{c}]" for c in cs)

    lines = [f"# {brief['question']}", "", brief.get("answer", ""), ""]
    for s in brief.get("sections", []):
        lines += [f"## {s['heading']}", ""] + [f"- {p['text']}{cite(p['cites'])}" for p in s["points"]] + [""]
    if brief.get("open_questions"):
        lines += ["## Open questions (leads to check, not proven gaps)", ""]
        lines += [f"- {p['text']}{cite(p['cites'])}" for p in brief["open_questions"]] + [""]
    if brief.get("uncertainty"):
        lines += ["## How much to trust this", ""] + [f"- {u}" for u in brief["uncertainty"]] + [""]
    lines += ["## Evidence", ""]
    for eid, e in ev.items():
        lines.append(f"- [{eid}] {e['title']} ({e['year'] or 'n.d.'}). {e['url']}")
    return "\n".join(lines).strip() + "\n"


def build_brief(question: str, bundle: Any, searcher: Any, cfg: Config, llm: Any, *, use_live: bool = True,
                max_papers: int = 12, bundle_version: str = "", progress: Progress = None,
                use_cache: bool = True) -> Dict:
    from ..llm import LLMError, QuotaExhausted

    question = " ".join(str(question).split())[:500]
    key = brief_key(question, use_live, bundle_version, cfg, max_papers)
    if use_cache:
        cached = load_cached_brief(cfg, key)
        if cached is not None:
            return cached

    def say(msg: str, frac: float) -> None:
        if progress:
            progress(msg, frac)

    trace = _Trace()
    say("Planning the searches…", 0.05)
    queries = _plan(question, llm, cfg, trace)

    say("Searching the analysed collection…", 0.2)
    lists: List[List[Dict]] = []
    per_query: Dict[str, List[str]] = {}
    for q in queries:
        hits = trace.run("search_collection", {"query": q}, partial(_collection_hits, q, bundle, cfg), _n) or []
        lists.append(hits)
        per_query[q] = [str(h["paper_id"]) for h in hits]
    live_on = bool(use_live and searcher is not None and getattr(searcher, "live_enabled", False))
    if live_on:
        say("Checking arXiv, OpenAlex and Semantic Scholar for newer papers…", 0.4)
        for q in queries[:LIVE_QUERIES]:
            hits = trace.run("search_live", {"query": q}, partial(_live_hits, q, searcher), _n) or []
            lists.append(hits)
            per_query.setdefault(q, []).extend(str(h["paper_id"]) for h in hits)

    say("Reading the most relevant papers…", 0.55)
    picked = _fuse(lists, int(max_papers))
    evidence: List[Dict] = []
    for n, r in enumerate(picked, start=1):
        d = trace.run("paper_details", {"paper_id": r["paper_id"]}, partial(_details, r, bundle, searcher),
                      _one) or {"abstract": str(r.get("abstract") or ""), "problems": [], "summary": ""}
        date = str(r.get("date") or "")
        evidence.append({
            "eid": f"P{n}", "paper_id": str(r["paper_id"]), "title": str(r.get("title") or ""),
            "year": int(date[:4]) if date[:4].isdigit() else None, "date": date[:10],
            "url": str(r.get("url") or r.get("arxiv_url") or ""), "in_collection": r.get("bundle_index") is not None,
            "is_new": bool(r.get("is_new")), "cited_by_count": int(r.get("cited_by_count") or 0),
            "abstract": d["abstract"], "summary": d["summary"], "problems": d["problems"],
            "snippet": _first_sentence(d["abstract"], 320)})

    say("Writing the brief with citations…", 0.7)
    mode, model, llm_note = "extractive", "none", ""
    body: Optional[Dict] = None
    if evidence and llm is not None and llm.available():
        try:
            res = llm.structured(_task(cfg), "assistant_brief", BriefDraft,
                                 question=question.replace("</user_question>", "</ user_question>"),
                                 evidence=_evidence_text(evidence))
            body = _verify(res.value, {e["eid"] for e in evidence})
            mode, model = "llm", res.route
            if not body["sections"] and not body["answer"]:
                body, mode = None, "extractive"
        except QuotaExhausted:
            llm_note = "The free AI allowance is used up, so this is an extractive brief (paper first sentences)."
        except LLMError as exc:
            llm_note = f"The AI could not write the brief ({type(exc).__name__}), so this is an extractive brief."
    if body is None:
        body = _extractive(question, queries, per_query, evidence)

    say("Checking the citations…", 0.92)
    n_coll = sum(1 for e in evidence if e["in_collection"])
    n_live = len(evidence) - n_coll
    cited = {c for s in body["sections"] for p in s["points"] for c in p["cites"]}
    cited |= {c for p in body["open_questions"] for c in p["cites"]} | set(_CITE.findall(body["answer"]))
    years = [e["year"] for e in evidence if e["year"]]
    unc = []
    if evidence:
        unc.append(f"Based on {len(evidence)} papers ({n_coll} from the analysed collection"
                   + (f", {n_live} found online" if n_live else "") + ")"
                   + (f", published {min(years)}–{max(years)}." if years else "."))
    else:
        unc.append("No relevant papers were found, so there is nothing to summarise. Try rephrasing the question.")
    if len(evidence) < 5:
        unc.append("Few papers matched; the brief is likely incomplete.")
    if bundle.embedder is None:
        unc.append("Semantic search is unavailable; papers were found by keyword matching only.")
    if mode == "llm":
        unc.append("Written by an AI from abstracts (and authors' own limitation statements where available); "
                   "open the cited papers before relying on a claim.")
        if body.get("removed_citations"):
            unc.append(f"{body['removed_citations']} unsupported citation(s) or uncited point(s) were removed.")
    if llm_note:
        unc.append(llm_note)
    unc.append("Open questions are leads to investigate. Sparse coverage in this collection does not prove that "
               "a problem is unsolved.")
    unc += [c for c in body.get("caveats", [])]

    out = {"key": key, "question": question, "queries": queries, "answer": body["answer"],
           "sections": body["sections"], "open_questions": body["open_questions"], "uncertainty": unc,
           "evidence": [{k: v for k, v in e.items() if k != "abstract"} for e in evidence],
           "trace": [asdict(c) for c in trace.calls], "mode": mode, "model": model, "created_at": time.time(),
           "coverage": {"n_papers": len(evidence), "n_cited": len(cited), "n_collection": n_coll, "n_live": n_live,
                        "live_used": live_on}}
    out["markdown"] = to_markdown(out)
    out = json.loads(json.dumps(out, default=lambda o: o.item() if isinstance(o, np.generic) else str(o)))
    if mode == "llm" or not (llm is not None and llm.available()):
        _save(cfg, key, out)
    say("Done", 1.0)
    return out
