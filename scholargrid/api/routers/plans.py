"""Starter research plans generated from one Gap Card, plus exports."""
from __future__ import annotations

from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request

from ...plan import (
    PlanDocument,
    generate_plan,
    plan_to_bibtex,
    plan_to_json,
    plan_to_markdown,
    supervisor_email,
)
from ..deps import state, track
from ..schemas import JobOut, PlanExportIn, PlanIn, PlanOptions, TextOut
from ..state import AppState
from .topics import get_ws

router = APIRouter(tags=["plans"])

GOALS = ["Course project", "Bachelor/master thesis", "First paper", "Just exploring"]
COMPUTE = ["Laptop only", "One GPU", "Several GPUs", "Cloud credits"]


@router.get("/plans/options", response_model=PlanOptions)
def options(st: AppState = Depends(state)) -> PlanOptions:
    pc = st.cfg["plan"]
    opts = [int(x) for x in pc["weeks_options"]]
    default = int(pc["default_weeks"]) if int(pc["default_weeks"]) in opts else opts[len(opts) // 2]
    return PlanOptions(weeks_options=opts, default_weeks=default, goals=GOALS, compute=COMPUTE,
                       max_background_chars=int(pc["max_background_chars"]))


@router.post("/plans", response_model=JobOut)
def start_plan(body: PlanIn, request: Request, st: AppState = Depends(state)) -> Dict:
    b = st.require()
    if not st.cfg["plan"]["enabled"]:
        raise HTTPException(503, "Plan generation is turned off in the configuration.")
    if not body.card.get("id"):
        raise HTTPException(422, "The open problem (card) needs an id.")
    ws = get_ws(st, body.ws_key) if body.ws_key else None

    def run(progress):
        progress("Collecting the papers behind this problem…", 0.15)
        progress("Writing your plan (this uses the AI when available)…", 0.4)
        doc = generate_plan(body.card, b, st.cfg, st.llm(), b.embedder, weeks=int(body.weeks),
                            background=body.background, compute_access=body.compute_access, goal=body.goal,
                            workspace=ws, attempt=int(body.attempt))
        progress("Checking the plan against its sources…", 0.9)
        return doc.model_dump(mode="json")

    track(st, request, "plan_started", weeks=body.weeks, goal=body.goal)
    dedupe = f"plan:{body.card.get('id')}:{body.weeks}:{body.goal}:{body.compute_access}:{body.attempt}:{hash(body.background)}"
    return st.jobs.submit("plan", run, dedupe_key=dedupe, meta={"gap_id": body.card.get("id")}).public()


@router.post("/plans/validate", response_model=PlanDocument)
def validate(body: PlanExportIn) -> PlanDocument:
    """Check that a plan document (e.g. from an imported project) is well formed."""
    try:
        return PlanDocument.model_validate(body.doc)
    except Exception as exc:
        raise HTTPException(422, f"Not a valid plan document: {exc}") from exc


@router.post("/plans/export", response_model=TextOut)
def export(body: PlanExportIn) -> TextOut:
    try:
        doc = PlanDocument.model_validate(body.doc)
    except Exception as exc:
        raise HTTPException(422, f"Not a valid plan document: {exc}") from exc
    slug = "".join(ch if ch.isalnum() else "-" for ch in (doc.plan.title or "plan").lower())[:60].strip("-")
    if body.format == "markdown":
        return TextOut(filename=f"{slug}.md", media_type="text/markdown", content=plan_to_markdown(doc))
    if body.format == "json":
        return TextOut(filename=f"{slug}.json", media_type="application/json", content=plan_to_json(doc))
    if body.format == "bibtex":
        return TextOut(filename=f"{slug}.bib", media_type="application/x-bibtex", content=plan_to_bibtex(doc))
    return TextOut(filename=f"{slug}-email.txt", media_type="text/plain", content=supervisor_email(doc))
