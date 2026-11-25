"""HTTP API (FastAPI) on the synthetic offline bundle: every resource end to end, jobs included."""
from __future__ import annotations

import time

import pytest
from conftest import make_config

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from scholargrid.runner import run  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from scholargrid.api.main import create_app
    from scholargrid.api.state import AppState
    from scholargrid.llm import reset_llm

    tmp = tmp_path_factory.mktemp("api")
    cfg = make_config(tmp)
    cfg.raw["validation"]["judgments_file"] = str(tmp / "judgments.json")
    run(cfg)
    reset_llm()
    st = AppState(cfg)
    st.load()
    assert st.bundle is not None, st.load_error
    app = create_app(st, load_on_start=False)
    with TestClient(app) as c:
        yield c


def wait_job(client, job, timeout=120):
    t0 = time.time()
    while job["status"] in ("queued", "running"):
        assert time.time() - t0 < timeout, job
        time.sleep(0.2)
        job = client.get(f"/api/jobs/{job['id']}").json()
    assert job["status"] == "done", job
    return job


def test_health_and_status(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    s = client.get("/api/status").json()
    assert s["ready"] and s["release"]["n_papers"] > 100 and s["release"]["synthetic"]
    assert s["llm"]["provider"] == "fake" and s["persistence"]


def test_search_filters_and_sort(client):
    r = client.get("/api/search", params={"q": "neural networks", "live": "false"}).json()
    assert r["results"] and r["results"][0]["rank"] == 1
    assert all(h["in_collection"] for h in r["results"])
    assert r["areas"] and r["elapsed_ms"] >= 0
    cat = r["results"][0]["primary_category"]
    f = client.get("/api/search", params={"q": "neural networks", "live": "false", "categories": cat}).json()
    assert f["results"] and all(h["primary_category"] == cat for h in f["results"])
    n = client.get("/api/search", params={"q": "neural networks", "live": "false", "sort": "newest"}).json()
    dates = [h["date"] for h in n["results"]]
    assert dates == sorted(dates, reverse=True)
    assert client.get("/api/search", params={"q": ""}).status_code == 422
    assert client.get("/api/categories").json()


def test_paper_detail_similar_bibtex(client):
    hit = client.get("/api/search", params={"q": "learning", "live": "false"}).json()["results"][0]
    d = client.get("/api/papers/detail", params={"id": hit["paper_id"]}).json()
    assert d["title"] == hit["title"] and d["in_collection"] and d["links"]["abs"].startswith("https://arxiv.org/")
    sim = client.get("/api/papers/similar", params={"id": hit["paper_id"], "k": 5}).json()
    assert len(sim["results"]) == 5 and all(r["paper_id"] != hit["paper_id"] for r in sim["results"])
    bib = client.post("/api/papers/bibtex", json={"paper_ids": [hit["paper_id"]]}).json()
    assert bib["content"].startswith("@misc{")
    assert client.get("/api/papers/detail", params={"id": "nope-0000"}).status_code == 404


def test_topic_gaps_plan_project_flow(client):
    start = client.post("/api/topics", json={"query": "neural networks"}).json()
    key = start["key"]
    if not start["ready"]:
        wait_job(client, start["job"])
    ws = client.get(f"/api/topics/{key}").json()
    assert ws["query"] == "neural networks" and ws["subtopics"] and ws["papers"]
    assert any(s["parent"] is None for s in ws["subtopics"])
    again = client.post("/api/topics", json={"query": "neural  networks"}).json()
    assert again["ready"] and again["key"] == key
    assert any(t["key"] == key for t in client.get("/api/topics").json())

    g = client.post(f"/api/topics/{key}/gaps").json()
    if not g["ready"]:
        wait_job(client, g["job"])
    gaps = client.get(f"/api/topics/{key}/gaps").json()
    assert "cards" in gaps and "stats" in gaps
    cards = gaps["cards"] or gaps["area_cards"]

    proj = client.post("/api/projects", json={"title": "Thesis", "topic_query": "neural networks"}).json()
    pid = proj["id"]
    paper = ws["papers"][0]["paper_id"]
    assert client.post(f"/api/projects/{pid}/papers", json={"paper_id": paper}).json() == {"added": True}
    assert client.post(f"/api/projects/{pid}/papers", json={"paper_id": paper}).json() == {"added": False}
    assert client.patch(f"/api/projects/{pid}/papers", json={"paper_id": paper, "status": "reading",
                                                             "tags": ["core"], "note": "read §3"}).status_code == 200
    assert client.patch(f"/api/projects/{pid}/papers", json={"paper_id": paper, "status": "bogus"}).status_code == 400
    nid = client.post(f"/api/projects/{pid}/notes", json={"body": "first idea"}).json()["id"]
    client.patch(f"/api/projects/{pid}/notes/{nid}", json={"body": "better idea"})

    if cards:
        card = cards[0]
        assert client.post(f"/api/projects/{pid}/gaps", json={"card": card}).json()["added"]
        client.patch(f"/api/projects/{pid}/gaps/{card['id']}", json={"status": "shortlisted"})
        job = client.post("/api/plans", json={"card": card, "ws_key": key, "weeks": 8}).json()
        doc = wait_job(client, job)["result"]
        assert doc["gap_id"] == card["id"] and doc["plan"]["milestones"]
        for fmt in ("markdown", "json", "bibtex", "email"):
            out = client.post("/api/plans/export", json={"doc": doc, "format": fmt}).json()
            assert out["content"] and out["filename"]
        assert client.post(f"/api/projects/{pid}/plans", json={"doc": doc}).json()["id"] > 0

    detail = client.get(f"/api/projects/{pid}").json()
    assert detail["papers"][0]["status"] == "reading" and detail["papers"][0]["tags"] == ["core"]
    assert detail["notes"][0]["body"] == "better idea"
    assert any(p["id"] == pid for p in client.get("/api/projects").json())
    exported = client.get(f"/api/projects/{pid}/export").json()
    imported = client.post("/api/projects/import", json={"data": exported}).json()
    assert imported["counts"]["papers"] == 1 and imported["id"] != pid
    assert client.get(f"/api/projects/{pid}/bibtex").json()["content"].startswith("@misc{")
    client.delete(f"/api/projects/{pid}/papers", params={"paper_id": paper})
    assert client.get(f"/api/projects/{pid}").json()["counts"]["papers"] == 0
    assert client.delete(f"/api/projects/{imported['id']}").json() == {"ok": True}
    assert client.get(f"/api/projects/{imported['id']}").status_code == 404


def test_missing_topic_is_404(client):
    assert client.get("/api/topics/doesnotexist").status_code == 404
    assert client.post("/api/topics/doesnotexist/gaps").status_code == 404


def test_areas_trends_map(client):
    areas = client.get("/api/areas").json()
    assert areas and all(a["name"] and a["color"].startswith("#") for a in areas)
    a = client.get(f"/api/areas/{areas[0]['id']}").json()
    assert a["id"] == areas[0]["id"] and a["monthly"] and a["windows"] and a["newest"]
    pp = client.get(f"/api/areas/{areas[0]['id']}/papers", params={"sort": "newest", "limit": 5}).json()
    assert pp["total"] == areas[0]["size"] and len(pp["results"]) == 5
    assert client.get("/api/areas/99999").status_code == 404
    t = client.get("/api/trends").json()
    assert t["areas"] and t["corpus_monthly"] and t["quadrants"]
    m = client.get("/api/map").json()
    assert m["papers"] and m["areas"] and "edges" in m
    hl = client.get("/api/map/search", params={"q": "learning"}).json()
    assert hl["items"] and all(len(i) == 2 for i in hl["items"])


def test_methodology_releases_settings(client):
    m = client.get("/api/methodology").json()
    assert m["release"]["n_papers"] > 0 and "coverage" in m
    rel = client.get("/api/releases").json()
    assert rel and any(r["serving"] for r in rel)
    s = client.get("/api/settings").json()
    assert s["llm"]["provider"] == "fake" and any(t["task"] == "brief" for t in s["tasks"])
    assert client.post("/api/settings/byok", json={"key": "x" * 20}).status_code == 409
    assert client.post("/api/releases/nope/activate").status_code == 404


def test_judgments_roundtrip(client):
    qs = client.get("/api/judgments/queries").json()
    assert qs
    q = qs[0]["query"]
    pool = client.get("/api/judgments/pool", params={"query": q}).json()
    assert pool["candidates"] and all(c["grade"] is None for c in pool["candidates"])
    pid = pool["candidates"][0]["paper_id"]
    assert client.post("/api/judgments", json={"query": q, "paper_id": pid, "grade": 2}).json()["judged_for_query"] == 1
    again = client.get("/api/judgments/pool", params={"query": q}).json()
    assert next(c for c in again["candidates"] if c["paper_id"] == pid)["grade"] == 2
    assert client.post("/api/judgments", json={"query": q, "paper_id": pid, "grade": None}).json()["total"] == 0
    assert client.post("/api/judgments", json={"query": q, "paper_id": pid, "grade": 5}).status_code == 422


def test_assistant_brief_is_cited_and_verified(client):
    start = client.post("/api/assistant/brief", json={"question": "how do neural networks learn representations",
                                                      "use_live": False}).json()
    if start["ready"]:
        brief = client.get(f"/api/assistant/brief/{start['key']}").json()
    else:
        brief = wait_job(client, start["job"])["result"]["brief"]
    ids = {e["eid"] for e in brief["evidence"]}
    assert brief["evidence"] and brief["mode"] == "llm"
    cites = [c for s in brief["sections"] for p in s["points"] for c in p["cites"]]
    assert cites and set(cites) <= ids                       # the fake's P999 citation was removed
    assert any("removed" in u for u in brief["uncertainty"])
    assert any(t["tool"] == "search_collection" for t in brief["trace"])
    assert brief["markdown"].startswith("# ")
    assert client.get(f"/api/assistant/brief/{brief['key']}").status_code == 200
