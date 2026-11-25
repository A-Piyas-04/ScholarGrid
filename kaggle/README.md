# ScholarGrid on Kaggle: experiments and release builds

Kaggle gives you a free GPU in the browser (about 30 hours a week). ScholarGrid uses it for the heavy, **offline**
work: embedding tens of thousands of papers with bigger models, comparing them, and building a new data release.
The web app on your computer never needs a GPU. It only loads the finished release.

```
your computer                          kaggle.com (free GPU)                     your computer
─────────────                          ─────────────────────                     ─────────────
1. judge search results   ──push──►  2. run notebooks 00 → 08   ──download──►  3. import the release zip
   (web app, /evaluate)               (in the browser)                             python -m scholargrid.release import …
```

## 0. One-time setup

1. **Push this branch to GitHub.** Every notebook's first cell downloads the project with
   `git clone -b upgrade-use-case https://github.com/A-Piyas-04/PaperPorteHobe.git`. If the repository is private,
   either make it public, or upload the project folder as a private Kaggle dataset (*Datasets → New dataset*) and
   attach it to each notebook: the first cell finds it automatically.
2. **Create a Kaggle account** and verify your phone number (needed to turn on GPU and internet).
3. Optional: in *Settings → Secrets* (inside a notebook: *Add-ons → Secrets*), add `OPENALEX_MAILTO` with your email
   so OpenAlex puts you in its faster "polite pool". It is never written to outputs.

## 1. Before Kaggle: make real relevance labels (on your computer)

The search quality score in the current release uses guessed labels, so it can't tell which model is better. Start
the app (`./scripts/dev.ps1`), open **Explore → Judge search results**, and grade results for at least **40 queries**
(about 15 papers each). Grades are saved to `configs/search_judgments.json`. Commit and push that file. Notebook 01
reads it; with fewer than 20 judged queries every result is marked *provisional*.

## 2. Running a notebook

For each file in `kaggle/notebooks/`, in order:

1. kaggle.com → **Create → New Notebook** → *File → Import Notebook* → upload the `.ipynb`.
2. Right-hand panel → **Session options**: *Accelerator* = **GPU T4 x2** (or P100), *Internet* = **On**.
3. **Add data** (right panel → *Add Input*):
   - notebooks 00 and 08: the dataset **Cornell-University/arxiv** (search "arxiv"; ~4.5 GB metadata snapshot);
   - notebooks 01–07 and 09: the output of the earlier notebooks (see step 5).
4. **Run All**. Each notebook prints what it does and ends by saving `results/<name>.json`.
5. When it finishes: **Save Version → Save & Run All (commit)**. The files in `/kaggle/working` become that
   notebook's *Output*. To pass them on, open the notebook's *Output* tab → **New Dataset**, then attach that dataset
   to the next notebook. Simplest: keep one dataset, `scholargrid-work`, and add each notebook's output to it.

Environment variables you can set in the first cell (`os.environ["SG_PROFILE"] = "standard"`):

| Variable | Default | Meaning |
|---|---|---|
| `SG_PROFILE` | `dev` | corpus size: `dev` ≈ 5k papers, `standard` ≈ 50k. Start with `dev`. |
| `SG_DATE_START` | `2023-01-01` | earliest paper date |
| `SG_MODELS` | `minilm,bge-small,specter2-base,qwen3-0.6b` | models compared in 02 (add `bge-m3` if time allows) |
| `SG_QUICK` | `0` on Kaggle | `1` = tiny CPU smoke test (what runs locally) |

## 3. The notebooks

| # | Notebook | Needs | Produces | Typical time (T4) |
|---|---|---|---|---|
| 00 | Corpus preparation | arXiv dataset | `corpus.parquet`, `corpus_manifest.json` | 10–20 min |
| 01 | Relevance benchmark | 00, your `search_judgments.json` | `benchmark.json` (fixed dev / held-out split), `judgments_todo.csv` | 5 min |
| 02 | Embedding comparison | 00, 01 | model table (quality, CPU query latency, memory), `emb_<model>.npy` | 30–90 min |
| 03 | Hybrid retrieval + re-ranking | 00–02 | recommended `search` settings | 15–30 min |
| 04 | OpenAlex enrichment | 00, internet | `corpus_enriched.parquet`, match quality | 15–30 min (network) |
| 05 | Topics / clustering | 00, 02 | recommended `reduce` / `cluster` settings | 20–60 min |
| 06 | Scientific graph | 02, 04 | `edges_typed.parquet` (cites / coupling / similar, with provenance) | 5–15 min |
| 07 | Trends and leads | 00 (+05) | reliability and 6-month back-test of growth signals | 10 min |
| 08 | **Release builder** | arXiv dataset, results of 02/03/05 | `scholargrid_release_<id>.zip` | 20–40 min (50k) |
| 09 | Optional fine-tuning | 01, 02, 04 | a fine-tuned model, **only if** it beats the base model on held-out queries | 30–60 min |

Every recommendation follows one rule (`sg_kaggle.recommend`): a challenger replaces the current choice only if it
improves nDCG@10 on **held-out** queries by at least 0.02 with paired-bootstrap probability ≥ 0.9. A bigger model is
never assumed to be better, and CPU query latency (what your laptop pays per search) is reported next to quality.

## 4. Bringing the release home

1. Notebook 08 → *Output* tab → download `scholargrid_release_<id>.zip`.
2. On your computer, in the project folder:
   ```powershell
   .venv\Scripts\python -m scholargrid.release verify  path\to\scholargrid_release_<id>.zip
   .venv\Scripts\python -m scholargrid.release import  path\to\scholargrid_release_<id>.zip --activate
   ```
   `import` checks the bundle (file list, checksums, one vector per paper, cluster ids, and that the embedding model
   downloads and reproduces the stored vectors on your CPU), then attaches this computer's stored AI extractions
   (open problems, facets) to papers that are in both releases, and makes it the served release.
3. Restart the API (`python -m scholargrid.api`). The app's **Settings → Data releases** lists every release and can
   switch back to an older one at any time.

If the model can't run on your computer (for example a model that needs special code), import with `--allow-bm25`:
search then falls back to keywords for that release.

## 5. What runs where (and what does not)

* Kaggle sessions have **no AI keys**: LLM features (open-problem extraction, labels, plans) are switched off there
  (`configs/kaggle.yaml`). They keep running on your computer, on the free Gemini/Groq tiers, against whichever release
  is served.
* Full-text fetching is off on Kaggle (it is slow and rate-limited). Extractions you already have locally are reused.
* Nothing in these notebooks writes to your local data. Local smoke tests write only to `kaggle/_work/`
  (git-ignored): `SG_QUICK=1 .venv\Scripts\python kaggle\src\02_embedding_comparison.py`.

## 6. Editing the notebooks

The `.py` files in `kaggle/src/` are the source (cells are marked with `# %%`). After editing, regenerate the
notebooks with `python kaggle/build_notebooks.py`. Shared helpers live in `kaggle/sg_kaggle.py`.
