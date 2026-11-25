# ScholarGrid

**From a vague research interest to a defensible research question, with the papers behind every claim.**

ScholarGrid helps beginner researchers (final-year undergraduates, new MSc and PhD students) start research in
computer science:

1. **Map a topic.** Describe an interest; see its sub-problems explained in plain language.
2. **Read first.** An ordered path: surveys, the foundations everyone cites, key recent work, the frontier.
3. **Find open problems.** Problems authors say are unsolved, untried method/problem pairs, narrow evaluations and
   conflicting results. Each comes with quoted evidence, a novelty check against recent papers, and the reasons it
   might *not* be a gap.
4. **Plan the first project.** Research question, hypotheses, baselines and datasets from the closest papers, a
   week-by-week timeline, risks, and an email to a supervisor.
5. **Keep it.** Projects hold saved papers (with reading status, tags, notes), open problems, plans and notes.

It also offers semantic paper search (collection + live arXiv, OpenAlex and Semantic Scholar), a cited research-brief
assistant, a map of the whole collection, research areas and trends, and a page for judging search quality.

## Architecture

```
offline (your computer or Kaggle GPU)              online (your computer)
┌────────────────────────────────────┐   ┌───────────────────────────────────────────────────┐
│ scholargrid.pipeline               │   │ web/  Next.js 15 · TypeScript · Tailwind 4         │
│ kaggle/ notebooks 00–09            │   │        │ /api/* (proxied)                           │
│        ▼                           │   │        ▼                                            │
│ versioned release bundle           │──►│ scholargrid/api  FastAPI: search, topics, open     │
│ data/releases/<id>/ (+ manifest,   │   │   problems, plans, projects, map, trends, assistant│
│ checksums, validation report)      │   │        │                                            │
└────────────────────────────────────┘   │ SQLite data/app.db (projects) · free-tier LLMs      │
                                         └───────────────────────────────────────────────────┘
```

* **`scholargrid/`**: the research library (ingest, enrichment, embeddings, clustering, hybrid search, topic
  workspaces, reading paths, gap engine, plan generator, LLM router, persistence). Unchanged by the web transition.
* **`scholargrid/api/`**: one FastAPI process that loads the current release once and exposes typed endpoints. Long
  tasks (topic maps, open problems, plans, briefs) run as background jobs with progress.
* **`scholargrid/assistant/`**: a controlled research-brief orchestrator (fixed tools, step budget, verified citations).
* **`web/`**: the user interface. Types are generated from the API's OpenAPI schema.
* **`kaggle/`**: GPU experiments (embedding models, hybrid retrieval, clustering, enrichment, trends) and a release
  builder whose output you import with one command. See [`kaggle/README.md`](kaggle/README.md).
* **`app/`**: the previous Streamlit interface, kept as legacy until the web app is validated.

Plan, decisions and status: [`Docs/web-app/TRANSITION_PLAN.md`](Docs/web-app/TRANSITION_PLAN.md).

## Run it locally

Requirements: Python 3.11+ and Node.js 20+ (22 recommended).

```powershell
# Windows: first run installs everything, then opens two windows (API + web)
./scripts/dev.ps1 -Install
# later runs
./scripts/dev.ps1
```

```bash
# macOS / Linux / Git Bash
./scripts/dev.sh --install
```

Or by hand:

```bash
python -m venv .venv && .venv/Scripts/activate        # Windows; use .venv/bin/activate elsewhere
pip install -r requirements.txt
python -m scholargrid.api                              # http://127.0.0.1:8000  (API docs at /docs)
cd web && npm install && npm run dev                   # http://localhost:3000
```

The API loads the served release on start (about 40 s for 48k papers with the embedding model); the web app shows a
loading screen meanwhile. No release yet? Build a small one with `python pipeline/run_pipeline.py`, or use the
synthetic demo config: `python pipeline/run_pipeline.py --config configs/ci.yaml`.

### AI features and keys

AI features use free tiers only (Gemini, optionally Groq / OpenRouter). Put keys in `.env` (see `.env.example`). Without
keys every feature still works with simpler methods: keyword labels, template open-problem cards, template plans and
extractive briefs. The app says which one you are seeing. You can also paste your own Gemini key in **Settings**.

## Data releases

```bash
python -m scholargrid.release list                       # releases, * marks the served one
python -m scholargrid.release rollback <id>              # serve an older release
python -m scholargrid.release verify <dir|zip>           # check an external bundle against the app's contract
python -m scholargrid.release import <dir|zip> --activate  # add a bundle built on Kaggle and serve it
```

Releases are immutable folders with a manifest, checksums and a validation report. **Settings → Data releases** in
the app lists them and switches between them.

## Pipeline

```bash
python pipeline/run_pipeline.py                       # configs/config.yaml (development)
python pipeline/run_pipeline.py --config configs/production.yaml
python pipeline/run_pipeline.py --from-stage analyze  # rerun from a stage
```

Stages: ingest → enrich (OpenAlex) → fulltext → extract (LLM) → embed → analyze (UMAP, HDBSCAN, labels, growth,
graph) → foundations → gaps → validate → publish. All parameters live in `configs/*.yaml` and are validated on load.

## Development

```bash
pip install -e ".[ml,app,api,dev,llm,fulltext,db]"
pytest                                  # library, API (tests/test_api.py), release import, legacy app
ruff check . && mypy
cd web && npm run typecheck && npm run build
python -m scholargrid.api --openapi web/openapi.json && (cd web && npm run gen:api)   # after API changes
```

## Measuring quality

Search quality is judged with real graded labels: open **Explore → Judge search results** (`/evaluate`), grade
pooled results for benchmark queries, and the labels go to `configs/search_judgments.json`. The validation stage and
the Kaggle notebooks use them; without them the reported search score is heuristic and the app says so.

## Honest limits

The collection is a stratified sample of arXiv computer science. An open-problem card is a lead to discuss with a
supervisor, not proof that nobody has solved it; sparse coverage or embedding similarity never establishes novelty.
AI-written text links to its sources; read them before relying on a claim.

Paper metadata comes from arXiv, OpenAlex (CC0) and Semantic Scholar. Thank you to arXiv for use of its open access
interoperability. Abstracts remain under each paper's licence.
