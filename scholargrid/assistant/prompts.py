"""Prompts and output schemas for the research assistant (search planning and the cited brief)."""
from __future__ import annotations

from typing import Any, List

from pydantic import BaseModel, Field, field_validator

from ..llm.fakes import register_fake
from ..llm.prompts import Prompt, register


class SearchPlan(BaseModel):
    queries: List[str] = Field(default_factory=list)   # 2-4 focused search phrases
    focus: str = ""                                    # one line: what the user is really asking

    @field_validator("queries", mode="before")
    @classmethod
    def _q(cls, v: Any) -> List[str]:
        out = [" ".join(str(x).split())[:120] for x in (v or []) if str(x).strip()]
        return list(dict.fromkeys(out))[:4]


class BriefPoint(BaseModel):
    text: str
    cites: List[str] = Field(default_factory=list)     # evidence ids like "P3"

    @field_validator("cites", mode="before")
    @classmethod
    def _c(cls, v: Any) -> List[str]:
        return [str(x).strip().strip("[]").upper() for x in (v or []) if str(x).strip()][:8]


class BriefSection(BaseModel):
    heading: str
    points: List[BriefPoint] = Field(default_factory=list)


class BriefDraft(BaseModel):
    answer: str                                        # 2-5 sentences with [P#] markers
    sections: List[BriefSection] = Field(default_factory=list)
    open_questions: List[BriefPoint] = Field(default_factory=list)
    caveats: List[str] = Field(default_factory=list)

    @field_validator("sections", mode="before")
    @classmethod
    def _s(cls, v: Any) -> list:
        return list(v or [])[:6]


register(Prompt(
    name="assistant_plan", version="1",
    system=("You plan literature searches for a beginner researcher. Turn their question into 2 to 4 short "
            "search phrases (3-8 words each) that together cover it: the main topic, the key methods, and the "
            "specific angle they ask about. Use the vocabulary papers would use. Do not answer the question."),
    user="<user_question>\n$question\n</user_question>",
))

register(Prompt(
    name="assistant_brief", version="1",
    system=("You write a short, cited research brief for a beginner researcher, using ONLY the evidence papers "
            "given. Every factual sentence must cite at least one evidence id like [P2]. Never cite an id that "
            "is not in the evidence. If the evidence does not answer part of the question, say so plainly. "
            "Plain English, define jargon briefly, no hype. Structure: 'answer' (2-5 sentences with [P#] "
            "markers), 2-4 'sections' (each a heading and 2-5 points with cites), and 'open_questions' "
            "(things the evidence says are unsolved or untested, each with cites). Open questions are leads "
            "to check, not proven research gaps: phrase them carefully. Put limits of the evidence (few "
            "papers, only abstracts, old papers) in 'caveats'."),
    user="<user_question>\n$question\n</user_question>\n$evidence",
))


@register_fake("assistant_plan")
def _fake_plan(v: dict) -> dict:
    q = str(v.get("question", "")).replace("<user_question>", "").strip()
    words = [w for w in q.split() if len(w) > 3][:6]
    return {"queries": [" ".join(words) or q[:60], " ".join(words[:3]) + " survey"], "focus": q[:120]}


@register_fake("assistant_brief")
def _fake_brief(v: dict) -> dict:
    ev = str(v.get("evidence", ""))
    ids = [tok.strip("[]:") for tok in ev.split() if tok.startswith("[P") and tok.rstrip(":").endswith("]")][:4]
    ids = ids or ["P1"]
    return {"answer": f"The evidence covers this question from several angles [{ids[0]}].",
            "sections": [{"heading": "Main approaches",
                          "points": [{"text": "One line of work is described here.", "cites": ids[:2]},
                                     {"text": "An unknown paper is cited here.", "cites": ["P999"]}]}],
            "open_questions": [{"text": "Robustness is not yet well tested.", "cites": ids[-1:]}],
            "caveats": ["Based on abstracts only."]}
