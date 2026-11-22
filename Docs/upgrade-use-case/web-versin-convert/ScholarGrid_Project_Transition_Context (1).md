# ScholarGrid — Full-Stack Transition Context

> **Status:** Planning only; migration and Kaggle experiments have **not** been implemented.  
> **Repository:** https://github.com/A-Piyas-04/PaperPorteHobe  
> **Priority:** Build and test **locally first**. Deployment decisions come later.  
> **Purpose of this file:** Give future project conversations and coding agents the agreed direction without treating the implementation as fixed.

## 1. Project goal

ScholarGrid (currently in the **PaperPorteHobe** repository) is a research-discovery application focused on helping users **find papers, explore research topics and relationships, inspect evidence, understand trends, and organize investigations**. Its output should be trustworthy and useful to researchers—not merely visually impressive.

## 2. Why we are changing direction

The current Streamlit-centered experience is difficult to use and extend. Even seemingly simple interactions and workflows are cumbersome, and the UI does not meet the desired product standard.

**Decision:** Move toward a properly designed **full-stack web application**, while **auditing and reusing** the existing Python research/ML pipeline and validated results wherever possible. This is **not** a mandate to rewrite everything. Better architecture alone will not fix weak retrieval, unclear scientific claims, or UX problems.

## 3. Intended architecture (provisional)

- **Frontend:** React/Next.js + TypeScript, with a coherent, responsive research-oriented UI. Reuse existing graph work where practical.
- **Backend:** Typed APIs for search, paper details, topics, graph exploration, trends, workspaces, and later agent tools. **FastAPI/Python is a strong candidate**, but the service boundaries are not final.
- **Research computation:** Run expensive ingestion, embeddings, clustering, graph generation and analytics **offline**, independently of normal user requests.
- **Research artifacts:** Immutable, **versioned and validated** releases containing Parquet tables, embedding vectors, retrieval indexes, graph/projection data, metrics and manifests.
- **Application database:** Separate transactional storage (e.g., SQLite locally, or PostgreSQL later) for saved papers, notes, workspaces and agent task state. **Do not use Parquet as the primary writable user database.**
- **Runtime:** Load approved artifacts and perform necessary lightweight live queries. Arbitrary semantic queries still need a **matching query embedding model**, unless a lexical fallback is chosen.

The exact framework, database and service layout must be decided after inspecting the repository and testing representative workloads. Avoid premature microservices and infrastructure complexity.

## 4. Kaggle / open-model ML improvement track

Kaggle is an **optional offline compute and experimentation environment**, not the required production backend. Use it to evaluate and, only when justified, improve the intelligence that the web app consumes.

The separate **`ScholarGrid_Kaggle_Experiment_Blueprint.md`** is the detailed source for notebook-level implementation. Its planned experiments are:

| Order | Notebook / experiment | Goal |
|---|---|---|
| 00–01 | Corpus preparation + relevance benchmark | Clean/freeze arXiv corpus; establish trustworthy evaluation queries and labels |
| 02–03 | Embedding comparison + hybrid retrieval | Compare existing MiniLM against **SPECTER2, Qwen3-Embedding-0.6B**, optionally **BGE-M3**; test BM25, dense retrieval, fusion and reranking |
| 04 | OpenAlex enrichment | Add carefully matched scholarly metadata, references and citations |
| 05–06 | Topics/clustering + scientific graph | Improve coherent topic discovery and distinguish citation edges from model-estimated similarity |
| 07 | Trends and investigation leads | Compute evidence-backed trends, uncertainty and research *leads* (not proven gaps) |
| 08 | Release builder | Export a validated, reproducible artifact bundle usable by the local application |
| 09 | Optional fine-tuning | Fine-tune only if held-out evaluations justify its complexity |

**Evaluation rules:** Compare to the current baseline; use real judged relevance data, held-out queries, clustering stability, provenance, latency and memory measurements. Never assume a larger model is better. Keep model versions, vector dimensions, ID mappings, licenses and checksums recorded. Start with the existing **5k-paper development** scope and scale toward **50k** only after validation. Experiment outputs are proposed contracts; adapt them to the repository's actual release schemas.

## 5. Agentic AI: valuable, but not the first milestone

Future agent features should support specific researcher tasks: retrieve relevant papers, compare evidence, explain connections, build cited research briefs and save results to a workspace. Prefer **one controlled tool-using orchestrator** initially, with traceable sources, limits and user-visible uncertainty; avoid a decorative chatbot or unnecessary multi-agent framework.

An agent must never present sparse clusters, embedding similarity or missing corpus coverage as proof that a research problem is novel or unsolved.

## 6. Development priorities

1. **Audit and preserve:** inspect current code, models, release formats, tests and working features; keep a reproducible baseline.
2. **Design the user journey:** prioritize simple paper search, inspect paper, explore related work/topics, and save a research workspace. Validate usability before adding many features.
3. **Build the local full-stack shell:** responsive frontend, typed API, artifact loader, clear loading/error states and persistent local user data.
4. **Benchmark and integrate ML enhancements:** Kaggle experiments are a parallel, measurable workstream. Adopt only quality improvements, without breaking prior releases.
5. **Add narrowly scoped agent tools:** only after search, evidence and persistence are reliable.
6. **Consider free deployment later:** do not constrain today's local architecture around an unverified free hosting plan; assess inference and storage requirements when the application is working.

## 7. Non-negotiable principles

- **Local-first, research-quality-first, UX-first.**
- **Preserve proven components; do not blindly rewrite the pipeline.**
- **Separate offline ML computation, online product interactions and mutable user state.**
- **Evidence before claims:** citations and scientific relationships must retain source provenance.
- **Metrics before model selection:** every proposed ML improvement is an experiment, not an established win.
- **Small, understandable workflows over feature overload.**
- Plans and technology choices are **working hypotheses**, expected to evolve during development.

---

**Related detailed document:** `ScholarGrid_Kaggle_Experiment_Blueprint.md` — notebook inputs, datasets, candidate models, steps, schemas, validation and release outputs. Refer to it rather than duplicating all Kaggle details here.
