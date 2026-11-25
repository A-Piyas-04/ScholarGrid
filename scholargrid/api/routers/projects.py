"""Durable research projects: saved papers, open problems, plans and notes (SQLite via ProjectRepo).

Local mode has one implicit user who owns every project; the repo's capability tokens stay in the database
so sign-in can be added later without a migration.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ...bibtex import to_bibtex
from ...persistence.repo import GAP_STATUSES, PAPER_STATUSES, AccessDenied
from .. import serialize as ser
from ..deps import repo_or_503, state, track
from ..schemas import (
    AddGapIn,
    AddPaperIn,
    AddPlanIn,
    GapPatch,
    ImportIn,
    NoteIn,
    PaperPatch,
    ProjectDetail,
    ProjectIn,
    ProjectPatch,
    ProjectSummary,
    TextOut,
)
from ..state import AppState

router = APIRouter(tags=["projects"])


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except AccessDenied as exc:
        raise HTTPException(404, "Project not found") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _detail(repo: Any, st: AppState, pid: str) -> Dict:
    acc = st.access(pid)
    summary = _call(repo.get_project, pid, acc)
    papers = _call(repo.papers, pid, acc)
    gaps = [{**g, "title": str((g.get("payload") or {}).get("title") or "")} for g in _call(repo.gaps, pid, acc)]
    plans = [{"id": p["id"], "gap_id": p["gap_id"], "label": p["label"], "created_at": p["created_at"],
              "doc": p["payload"]} for p in _call(repo.plans, pid, acc)]
    notes = _call(repo.notes, pid, acc)
    return {**summary, "papers": papers, "gaps": gaps, "plans": plans, "notes": notes}


@router.get("/projects/statuses")
def statuses() -> Dict[str, List[str]]:
    return {"paper": list(PAPER_STATUSES), "gap": list(GAP_STATUSES)}


@router.get("/projects", response_model=List[ProjectSummary])
def list_projects(st: AppState = Depends(state)) -> List[Dict]:
    repo = repo_or_503(st)
    return repo.list_projects((st.local_user or {})["id"])


@router.post("/projects", response_model=ProjectSummary)
def create(body: ProjectIn, request: Request, st: AppState = Depends(state)) -> Dict:
    repo = repo_or_503(st)
    version = st.version if st.bundle is not None else ""
    pid, _ = _call(repo.create_project, st.access(), title=body.title, topic_query=body.topic_query,
                   scope_name=str(st.cfg["scope"]["name"]), bundle_version=version)
    track(st, request, "project_created", mode="local")
    return _call(repo.get_project, pid, st.access(pid))


@router.get("/projects/{pid}", response_model=ProjectDetail)
def get(pid: str, st: AppState = Depends(state)) -> Dict:
    return _detail(repo_or_503(st), st, pid)


@router.patch("/projects/{pid}", response_model=ProjectSummary)
def patch(pid: str, body: ProjectPatch, st: AppState = Depends(state)) -> Dict:
    repo = repo_or_503(st)
    acc = st.access(pid)
    if body.title is not None:
        _call(repo.rename, pid, acc, body.title)
    if body.topic_query is not None:
        _call(repo.set_topic, pid, acc, body.topic_query, st.version if st.bundle is not None else "")
    return _call(repo.get_project, pid, acc)


@router.delete("/projects/{pid}")
def delete(pid: str, st: AppState = Depends(state)) -> Dict[str, bool]:
    _call(repo_or_503(st).delete_project, pid, st.access(pid))
    return {"ok": True}


# -- papers ---------------------------------------------------------------------------------
@router.post("/projects/{pid}/papers")
def add_paper(pid: str, body: AddPaperIn, request: Request, st: AppState = Depends(state)) -> Dict[str, bool]:
    repo = repo_or_503(st)
    b = st.require()
    rec = ser.paper_record(b, st.searcher, body.paper_id, body.record)
    if rec is None:
        raise HTTPException(404, "Paper not found")
    added = _call(repo.add_paper, pid, st.access(pid), rec, source=body.source)
    if added:
        track(st, request, "paper_saved", source=body.source)
    return {"added": bool(added)}


@router.patch("/projects/{pid}/papers")
def update_paper(pid: str, body: PaperPatch, st: AppState = Depends(state)) -> Dict[str, bool]:
    _call(repo_or_503(st).update_paper, pid, st.access(pid), body.paper_id, status=body.status, tags=body.tags,
          note=body.note)
    return {"ok": True}


@router.delete("/projects/{pid}/papers")
def remove_paper(pid: str, paper_id: str = Query(...), st: AppState = Depends(state)) -> Dict[str, bool]:
    _call(repo_or_503(st).remove_paper, pid, st.access(pid), paper_id)
    return {"ok": True}


# -- open problems --------------------------------------------------------------------------
@router.post("/projects/{pid}/gaps")
def add_gap(pid: str, body: AddGapIn, request: Request, st: AppState = Depends(state)) -> Dict[str, bool]:
    added = _call(repo_or_503(st).add_gap, pid, st.access(pid), body.card)
    if added:
        track(st, request, "gap_saved", type=body.card.get("type"))
    return {"added": bool(added)}


@router.patch("/projects/{pid}/gaps/{gap_id}")
def update_gap(pid: str, gap_id: str, body: GapPatch, st: AppState = Depends(state)) -> Dict[str, bool]:
    _call(repo_or_503(st).update_gap, pid, st.access(pid), gap_id, status=body.status, note=body.note)
    return {"ok": True}


@router.delete("/projects/{pid}/gaps/{gap_id}")
def remove_gap(pid: str, gap_id: str, st: AppState = Depends(state)) -> Dict[str, bool]:
    _call(repo_or_503(st).remove_gap, pid, st.access(pid), gap_id)
    return {"ok": True}


# -- plans ----------------------------------------------------------------------------------
@router.post("/projects/{pid}/plans")
def add_plan(pid: str, body: AddPlanIn, request: Request, st: AppState = Depends(state)) -> Dict[str, int]:
    plan_id = _call(repo_or_503(st).add_plan, pid, st.access(pid), body.doc, label=body.label)
    track(st, request, "plan_saved")
    return {"id": int(plan_id)}


@router.delete("/projects/{pid}/plans/{plan_id}")
def remove_plan(pid: str, plan_id: int, st: AppState = Depends(state)) -> Dict[str, bool]:
    _call(repo_or_503(st).remove_plan, pid, st.access(pid), plan_id)
    return {"ok": True}


# -- notes ----------------------------------------------------------------------------------
@router.post("/projects/{pid}/notes")
def add_note(pid: str, body: NoteIn, st: AppState = Depends(state)) -> Dict[str, int]:
    return {"id": int(_call(repo_or_503(st).add_note, pid, st.access(pid), body.body))}


@router.patch("/projects/{pid}/notes/{note_id}")
def update_note(pid: str, note_id: int, body: NoteIn, st: AppState = Depends(state)) -> Dict[str, bool]:
    _call(repo_or_503(st).update_note, pid, st.access(pid), note_id, body.body)
    return {"ok": True}


@router.delete("/projects/{pid}/notes/{note_id}")
def remove_note(pid: str, note_id: int, st: AppState = Depends(state)) -> Dict[str, bool]:
    _call(repo_or_503(st).remove_note, pid, st.access(pid), note_id)
    return {"ok": True}


# -- portability ----------------------------------------------------------------------------
@router.get("/projects/{pid}/export")
def export(pid: str, st: AppState = Depends(state)) -> Dict[str, Any]:
    return _call(repo_or_503(st).export_project, pid, st.access(pid))


@router.post("/projects/import", response_model=ProjectSummary)
def import_project(body: ImportIn, st: AppState = Depends(state)) -> Dict:
    repo = repo_or_503(st)
    pid, _ = _call(repo.import_project, body.data, st.access())
    return _call(repo.get_project, pid, st.access(pid))


@router.get("/projects/{pid}/bibtex", response_model=TextOut)
def bibtex(pid: str, st: AppState = Depends(state)) -> TextOut:
    repo = repo_or_503(st)
    papers = _call(repo.papers, pid, st.access(pid))
    rows = [{**(p.get("payload") or {}), "paper_id": p["paper_id"], "title": p["title"], "url": p.get("url", "")}
            for p in papers]
    return TextOut(filename="project.bib", media_type="application/x-bibtex", content=to_bibtex(rows))
