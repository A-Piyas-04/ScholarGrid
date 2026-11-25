"""Research assistant guardrails: citation verification, grouped citations, fusion, extractive fallback."""
from __future__ import annotations

from scholargrid.assistant.brief import _extractive, _fuse, _verify, split_groups, to_markdown
from scholargrid.assistant.prompts import BriefDraft, SearchPlan


def test_grouped_citations_are_split_and_unknown_ids_removed():
    assert split_groups("x [P3, P4] y [P1;P2]") == "x [P3][P4] y [P1][P2]"
    draft = BriefDraft(
        answer="Claim [P1, P9] and more [P2].",
        sections=[{"heading": "H", "points": [{"text": "kept [P2]", "cites": []},
                                              {"text": "dropped", "cites": ["P99"]}]}],
        open_questions=[{"text": "open", "cites": ["p1"]}],
    )
    out = _verify(draft, {"P1", "P2"})
    assert out["answer"] == "Claim [P1] and more [P2]."
    assert [p["text"] for p in out["sections"][0]["points"]] == ["kept [P2]"]
    assert out["sections"][0]["points"][0]["cites"] == ["P2"]
    assert out["open_questions"][0]["cites"] == ["P1"]          # normalised to upper case
    assert out["removed_citations"] >= 2


def test_sections_without_supported_points_disappear():
    draft = BriefDraft(answer="a", sections=[{"heading": "Empty", "points": [{"text": "x", "cites": ["P7"]}]}])
    assert _verify(draft, {"P1"})["sections"] == []


def test_search_plan_is_capped_and_deduplicated():
    plan = SearchPlan(queries=["a b", "a  b", "c", "d", "e", "f"])
    assert plan.queries == ["a b", "c", "d", "e"]


def test_fuse_keeps_each_lists_best_paper():
    lists = [[{"paper_id": "a"}, {"paper_id": "b"}, {"paper_id": "c"}],
             [{"paper_id": "b"}, {"paper_id": "a"}],
             [{"paper_id": "z"}]]
    picked = [r["paper_id"] for r in _fuse(lists, 3)]
    assert set(picked) == {"a", "b", "z"}


def test_extractive_brief_cites_every_point():
    ev = [{"eid": "P1", "paper_id": "1", "title": "T1", "abstract": "First sentence. Second.", "year": 2024,
           "url": "u", "problems": [{"statement": "S is open", "quote": "", "section": ""}]}]
    body = _extractive("q", ["q"], {"q": ["1"]}, ev)
    assert body["sections"][0]["points"][0]["cites"] == ["P1"]
    assert body["open_questions"][0]["text"] == "S is open"
    md = to_markdown({"question": "q", **body, "uncertainty": ["u"], "evidence": ev})
    assert md.startswith("# q") and "[P1] T1 (2024)" in md
