# ScholarGrid Web App: Transition Plan and Working Context

> **Read this first** when you resume work on the full-stack transition. It records the decisions, the
> target layout, the phase checklist and a running status log. Update the checkboxes and the log as you go.
> Source brief: `Docs/upgrade-use-case/web-versin-convert/ScholarGrid_Project_Transition_Context (1).md`.
> The brief is a starting hypothesis, not a fixed spec; deviations are recorded in §3 with the reason.

## 1. What we are building

ScholarGrid helps **beginner researchers (final-year undergrads, new MSc/PhD students)** go from a vague
interest to a defensible research question: find papers, understand a topic's sub-problems, know what to
read first, see evidence-backed open problems, turn one into a starter plan, and keep the work in a project.

The Python library (`scholargrid/`) already implements all of the research logic (hybrid search, live
sources, topic workspaces, reading paths, gap engine, plan generator, persistence, evaluation). The
Streamlit UI on top of it was hard to use and extend. The transition replaces the UI layer with a proper
web application and **reuses the library unchanged wherever possible**.

## 2. Architecture (decided after auditing the repo)

```
          offline (pipeline / Kaggle)                     online (local app)
 ┌───────────────────────────────────────┐   ┌──────────────────────────────────────────────┐
 │ scholargrid.pipeline  (CPU, local)    │   │ web/  Next.js 15 + TypeScript + Tailwind v4  │
 │ kaggle/ notebooks 00-09 (GPU, Kaggle) │   │   TanStack Query, typed client from OpenAPI  │
 │        │                              │   │        │  /api/* (Next rewrite → :8000)        │
 │        ▼                              │   │        ▼                                      │
 │ release bundle (immutable, versioned) │──►│ scholargrid/api  FastAPI (one process)        │
 │ data/releases/<id>/ + manifest.json   │   │   AppState: config, bundle, LiveSearcher,     │
 │ (parquet, npy, faiss, json, checksums)│   │   LLM router, ProjectRepo, job runner         │
 └───────────────────────────────────────┘   │        │                                      │
                                             │        ▼                                      │
                                             │ SQLite data/app.db (projects, notes, plans)   │
                                             └──────────────────────────────────────────────┘
```

* **Backend:** FastAPI inside the library package (`scholargrid/api/`), run with
  `python -m scholargrid.api`. One process holds the loaded release (48k papers, embeddings, FAISS, BM25),
  so every request is a lightweight query. No microservices.
* **Long operations** (topic workspace build, open-problem generation, plan generation, research brief) run
  as **background jobs** in a small thread pool; the client polls `GET /api/jobs/{id}` for progress text and
  a fraction. Results are cached on disk by the library, so repeat visits are instant.
* **Frontend:** Next.js App Router, client-side data fetching (TanStack Query), Tailwind v4 with CSS
  variable tokens (light + dark), lucide icons, Sigma.js + graphology for the map (ported from the old
  explorer component). API types are generated from FastAPI's OpenAPI (`npm run gen:api`).
* **User state:** SQLite through the existing SQLAlchemy `ProjectRepo` (Alembic migrations). Local mode uses
  one implicit local user who owns all projects. Parquet stays read-only research data.
* **LLM:** the existing free-tier router (`scholargrid.llm`). Every AI feature degrades to its heuristic or
  template path when no provider or quota is available, and the UI says so.
* **Agent:** one controlled orchestrator (`scholargrid/assistant/`) with a fixed tool set (search the
  collection, search live sources, read paper details, get stated problems), a step budget, and verified
  citations. No free-form multi-agent framework.

## 3. Decisions and deviations from the brief

| # | Decision | Why |
|---|----------|-----|
| D1 | FastAPI lives in `scholargrid/api/`, not a separate service repo | The library objects (bundle, searcher, LLM router) are in-process Python; a second service would only add serialization. |
| D2 | Next.js with client-side fetching, not SSR of data | The data lives behind a local Python API; SSR adds complexity without benefit for a local-first app. Next still gives routing, layouts and a production build. |
| D3 | Background jobs + polling, not websockets/SSE | Simple, robust, works through the Next dev proxy, easy to test. |
| D4 | Implicit local user instead of login | Local-first. `ProjectRepo` already supports owners and capability tokens, so auth can be added later without schema changes. |
| D5 | Streamlit app kept in `app/` as **legacy**, not deleted | It still works and documents behaviour; remove after the web app is validated. |
| D6 | The Kaggle blueprint file named in the brief does not exist in the repo | `kaggle/` notebooks 00–09 are written from the brief's experiment table; each states inputs, steps, metrics and the exact output contract the app imports. |
| D7 | Release import is a CLI + validator (`python -m scholargrid.release import <dir|zip>`) | Kaggle outputs must pass the same checks as local builds (schema, checksums, embedder probe) before the app serves them. |
| D8 | Relevance judging UI is part of the web app | The brief requires "real judged relevance data"; `configs/search_judgments.json` is empty. The UI writes judgments the Kaggle benchmark consumes. |
| D9 | Area-level offline gap cards and reading paths are optional in the UI | The current release (2026.10.18.2) has facets/problems/findings/profiles but no `gaps.json` / `reading_paths.json`; topic workspaces compute paths online. |

## 4. Repository layout after the transition

```
scholargrid/            research library (pipeline, search, workspace, gaps, plan, llm, persistence)
scholargrid/api/        FastAPI app: main.py, state.py, jobs.py, schemas.py, routers/*.py
scholargrid/assistant/  controlled research-brief orchestrator
web/                    Next.js frontend (src/app routes, src/components, src/lib)
kaggle/                 Kaggle notebooks 00–09, shared helpers, README with the artifact contract
Docs/web-app/           this plan, ARCHITECTURE.md, API.md, KAGGLE_HANDOFF.md
app/                    legacy Streamlit UI (deprecated)
scripts/dev.ps1|dev.sh  start API + web together
```

## 5. Phases

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done.

### P0 Audit and plan
- [x] Read library, configs, release manifest, Streamlit views; record decisions (this file).
- [x] Baseline test run (1 pre-existing failure: `test_llm.py::test_estimate_lines` expects pack_size 4, config now 6).

### P1 Backend API (`scholargrid/api`)
- [x] App factory, lifespan bundle load, CORS, error handlers, `/api/health`, `/api/status`.
- [x] Search (`/api/search`), similar papers, paper detail (bundle + live store + facets/problems/findings).
- [x] Topic workspaces as jobs; subtopic papers; reading path.
- [x] Open problems (gap cards) jobs, novelty recheck; area cards.
- [x] Plans: generate job, export (md/json/bib/email).
- [x] Projects: CRUD, papers/gaps/plans/notes, export/import, BibTeX.
- [x] Areas, trends (opportunity table + growth series), map payload + map search.
- [x] Settings: LLM status + quota, BYOK key (process memory only), releases list.
- [x] Judgments queue + save.
- [x] Tests with FastAPI TestClient on the synthetic offline config.

### P2 Frontend foundation (`web/`)
- [x] Next.js + TS + Tailwind v4 scaffold, design tokens (light/dark), fonts, layout shell, nav.
- [x] API client, generated types, query hooks, job polling hook, error/empty/loading components.

### P3 Core journey
- [x] Home (start a topic, search, examples, recent topics, corpus facts).
- [x] Search page (filters, sort, exact vs related, live sources, load more, save).
- [x] Paper page (metadata, abstract, extracted facets/problems, similar, links, save).
- [x] Topic workspace (overview, prerequisites, sub-topics with micro-topics, papers, activity).
- [x] Read first (ordered path with reasons).

### P4 Research outputs and persistence
- [x] Open problems page (gap cards, evidence quotes, novelty, why-not, feasibility, save, plan).
- [x] Plan builder + plan document view + exports.
- [x] Projects list + project page (papers with status/notes/tags, gaps, plans, notes, export/import).

### P5 Explore and trust
- [x] Map (Sigma.js port), Areas list/detail, Trends (opportunity quadrant + growth charts).
- [x] About / Methodology (release, validation metrics, models, limits), Settings page.

### P6 Evaluation and artifact contract
- [x] Relevance judging page → `configs/search_judgments.json`.
- [x] `scholargrid.release verify|import|checksums` (`scholargrid/release_import.py`, tests in `tests/test_release_import.py`); import attaches locally stored LLM extractions.

### P7 Research assistant
- [x] Orchestrator with tool budget, verified citations, uncertainty notes; API job; tests.
- [x] Assistant UI page (`/ask`).

### P8 Kaggle track
- [x] `kaggle/` notebooks 00–09 (`src/*.py` → `notebooks/*.ipynb` via `build_notebooks.py`), `sg_kaggle.py`, `configs/kaggle.yaml`, `kaggle/README.md` (step-by-step for first-time Kaggle users).
- [x] Every notebook smoke-tested locally in QUICK mode on CPU (outputs in git-ignored `kaggle/_work/`); 04 ran against the live OpenAlex API (92.5% match on 200 papers); 08 built, checksummed, verified and re-imported a bundle.

### P9 Verification and polish
- [x] Ran API + web together on the real 48k release; Playwright screenshots of every page, desktop/mobile/dark; real AI flows (topic map, open problems, plan, brief) exercised end to end.
- [x] `next build` (16 routes), `tsc`, pytest, ruff, mypy.
- [x] README rewrite, `web/README.md`, `scripts/dev.ps1` / `dev.sh`, CI `web` job (types up to date + build) and `api` extra in tests.

## 6. How to run (target)

```powershell
# terminal 1 — API on :8000 (loads the current release once)
.venv\Scripts\python -m scholargrid.api
# terminal 2 — web on :3000
cd web; npm install; npm run dev
# or both at once
./scripts/dev.ps1
```

## 7. Status log

- 2026-11-23: P0 done. Plan written. Starting P1.
- 2026-11-23: P1 done: `scholargrid/api` (45 endpoints, jobs, typed schemas), `scholargrid/assistant` (controlled brief orchestrator, new `brief` LLM task), `tests/test_api.py` (9 tests pass), ruff + mypy clean. FastAPI added to `pyproject` (`api` extra) and `requirements.txt`. Starting P2.
- 2026-11-23: P2–P5 done in `web/` (Next 15.5, React 19, Tailwind 4, TanStack Query 5, Sigma 3). Pages: `/`, `/search`, `/paper`, `/topic`, `/plan`, `/ask`, `/projects`, `/projects/[id]`, `/map`, `/areas`, `/areas/[id]`, `/trends`, `/about`, `/settings`, `/evaluate`. Design: graph-paper + ink + highlighter tokens (globals.css), Newsreader + Schibsted Grotesk. Verified against the real 48k release (topic build ~45 s with live sources + Gemini labels).
- 2026-11-23: P6–P9 done. Fixed along the way: Windows race in `save_json` (unique temp names + retry) that failed concurrent live searches; tests leaking into the real `data/app.db` because `.env` sets `SCHOLARGRID_DB_URL` (now isolated in `conftest.make_config`; leaked rows removed, backup at `data/app.db.bak-2026-11-23`); grouped citations "[P3, P4]" in briefs.

## 8. What is left for the user

1. **Commit and push** the `upgrade-use-case` branch (the Kaggle notebooks clone it from GitHub).
2. **Judge search results** in the app (`/evaluate`): at least 40 queries, ~15 papers each, then commit
   `configs/search_judgments.json`. Without this every model comparison is provisional.
3. **Run the Kaggle notebooks** 00 → 08 (`kaggle/README.md`), download the release zip, then
   `python -m scholargrid.release import <zip> --activate`.
4. Optional: add `GEMINI_API_KEY` / `GROQ_API_KEY` to `.env` if not already there; remove the legacy Streamlit app
   (`app/`, Streamlit deps) once the web app has replaced it for you.

## 9. Known limits / next ideas

* Old Streamlit-era projects with no owner (capability links) are not listed by the local app; none existed in
  `data/app.db` at transition time.
* Typed citation edges (`edges_typed.parquet` from notebook 06) are produced but the map does not style them yet.
* Generating open problems for a topic takes ~10–15 minutes on free-tier rate limits (results are cached for 72 h).
