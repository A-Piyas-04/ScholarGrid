"""Shared helpers for the ScholarGrid Kaggle notebooks (00-09).

Every notebook starts with::

    import sys; sys.path.insert(0, "/kaggle/working/sg/kaggle")   # or wherever this file is
    import sg_kaggle as sk
    sk.setup()            # clones/locates the repo, installs missing deps, prints the environment

The same code runs locally in QUICK mode (small samples, CPU) so the notebooks can be smoke-tested without a GPU:
``SG_QUICK=1 python kaggle/src/02_embedding_comparison.py``.

Conventions
-----------
* Paths: ``sk.WORK`` is the writable output folder (``/kaggle/working`` on Kaggle, ``kaggle/_work`` locally).
  Every notebook writes ``sk.WORK/results/<notebook>.json`` plus its data products under ``sk.WORK``.
* Inputs from earlier notebooks are read from ``sk.WORK`` (same session) or from an attached Kaggle dataset made
  from a previous notebook's output (``sk.find_input(name)`` searches ``/kaggle/input/*``).
* Relevance labels: ``configs/search_judgments.json`` (graded 0/1/2, made in the web app's /evaluate page).
  Without enough judged queries, metrics fall back to heuristic grades and every report says so.
"""
from __future__ import annotations

import gc
import json
import math
import os
import platform
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

ON_KAGGLE = os.path.isdir("/kaggle/working")
QUICK = os.environ.get("SG_QUICK", "0" if ON_KAGGLE else "1") == "1"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_URL = os.environ.get("SG_REPO_URL", "https://github.com/A-Piyas-04/PaperPorteHobe.git")
REPO_BRANCH = os.environ.get("SG_REPO_BRANCH", "upgrade-use-case")

if ON_KAGGLE:
    WORK = "/kaggle/working"
    REPO = os.environ.get("SG_REPO_DIR", "/kaggle/working/sg")
else:
    REPO = os.path.dirname(HERE)
    WORK = os.environ.get("SG_WORK", os.path.join(HERE, "_work"))
RESULTS = os.path.join(WORK, "results")

# Candidate embedding models. ``query_prefix``/``doc_prefix`` follow each model card; they are written into the
# release's embedder_meta.json so the local app embeds queries the same way.
MODELS: Dict[str, Dict[str, Any]] = {
    "minilm": {"name": "sentence-transformers/all-MiniLM-L6-v2", "query_prefix": "", "doc_prefix": "",
               "params_m": 23, "baseline": "original SRS baseline"},
    "bge-small": {"name": "BAAI/bge-small-en-v1.5", "revision": "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
                  "query_prefix": "Represent this sentence for searching relevant passages: ", "doc_prefix": "",
                  "params_m": 33, "baseline": "current release (2026.10.18.2)"},
    "specter2-base": {"name": "allenai/specter2_base", "query_prefix": "", "doc_prefix": "", "params_m": 110,
                      "note": "SciBERT-based scientific embedder. The full SPECTER2 uses adapters "
                              "(allenai/specter2 + adhoc_query); see notebook 02 for that variant."},
    "qwen3-0.6b": {"name": "Qwen/Qwen3-Embedding-0.6B",
                   "query_prefix": "Instruct: Given a research question or topic, retrieve relevant computer "
                                   "science paper abstracts\nQuery:",
                   "doc_prefix": "", "params_m": 600, "max_seq_length": 512},
    "bge-m3": {"name": "BAAI/bge-m3", "query_prefix": "", "doc_prefix": "", "params_m": 568, "optional": True,
               "max_seq_length": 512},
}
RERANKERS = {
    "ms-marco-minilm": "cross-encoder/ms-marco-MiniLM-L-6-v2",
    "bge-reranker-base": "BAAI/bge-reranker-base",
}


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
def sh(cmd: str, check: bool = True) -> int:
    print(f"$ {cmd}")
    return subprocess.run(cmd, shell=True, check=check).returncode


def setup(extra_pip: Sequence[str] = ()) -> None:
    """Make ``import scholargrid`` work and create output folders."""
    if ON_KAGGLE and not os.path.isdir(os.path.join(REPO, "scholargrid")):
        attached = find_input("scholargrid", must=False, want_dir="scholargrid")
        if attached:
            sh(f"cp -r '{os.path.dirname(attached)}' '{REPO}'")
        else:
            sh(f"git clone --depth 1 -b {REPO_BRANCH} {REPO_URL} {REPO}")
    if REPO not in sys.path:
        sys.path.insert(0, REPO)
    need = []
    for mod, pkg in (("rapidfuzz", "rapidfuzz"), ("umap", "umap-learn"), ("hdbscan", "hdbscan"),
                     ("faiss", "faiss-cpu"), ("sentence_transformers", "sentence-transformers")):
        try:
            __import__(mod)
        except ImportError:
            need.append(pkg)
    need += list(extra_pip)
    if need and ON_KAGGLE:
        sh(f"pip install -q {' '.join(need)}")
    os.makedirs(RESULTS, exist_ok=True)
    print(env_summary())


def env_summary() -> Dict[str, Any]:
    info: Dict[str, Any] = {"kaggle": ON_KAGGLE, "quick": QUICK, "python": platform.python_version(),
                            "work": WORK, "repo": REPO}
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda"] = torch.cuda.is_available()
        if torch.cuda.is_available():
            info["gpu"] = torch.cuda.get_device_name(0)
    except ImportError:
        info["torch"] = None
    return info


def device() -> str:
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


def find_input(name: str, must: bool = True, want_dir: Optional[str] = None) -> Optional[str]:
    """First path under /kaggle/input (or WORK) whose basename is ``name`` (file) or that contains ``want_dir``."""
    roots = ["/kaggle/input", WORK] if ON_KAGGLE else [WORK, os.path.join(REPO, "data")]
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            if want_dir and want_dir in dirnames:
                return os.path.join(dirpath, want_dir)
            if not want_dir and name in filenames:
                return os.path.join(dirpath, name)
    if must:
        raise FileNotFoundError(f"{name} not found under {roots}. Attach the dataset that contains it.")
    return None


def save_result(notebook: str, data: Dict[str, Any]) -> str:
    os.makedirs(RESULTS, exist_ok=True)
    path = os.path.join(RESULTS, f"{notebook}.json")
    payload = {"notebook": notebook, "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "environment": env_summary(), **data}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, default=_json_default)
    print(f"Saved {path}")
    return path


def _json_default(o: Any) -> Any:
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


@contextmanager
def timer(label: str, store: Optional[Dict[str, float]] = None):
    t0 = time.time()
    yield
    dt = time.time() - t0
    if store is not None:
        store[label] = round(dt, 3)
    print(f"[{label}] {dt:.1f}s")


def gpu_mem_mb() -> Optional[float]:
    try:
        import torch

        if torch.cuda.is_available():
            return round(torch.cuda.max_memory_allocated() / 1e6, 1)
    except ImportError:
        pass
    return None


def free_gpu() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.reset_peak_memory_stats()
    except ImportError:
        pass


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def load_corpus(max_papers: Optional[int] = None):
    """The frozen corpus from notebook 00 (``WORK/corpus.parquet``), else the repo's current release (local)."""
    import pandas as pd

    path = os.path.join(WORK, "corpus.parquet")
    if not os.path.exists(path):
        path = (find_input("corpus.parquet", must=False) or "") if ON_KAGGLE else ""
    if not path:
        cur = os.path.join(REPO, "data", "releases")
        rid = open(os.path.join(cur, "CURRENT"), encoding="utf-8").read().strip() if os.path.exists(
            os.path.join(cur, "CURRENT")) else None
        if rid and os.path.exists(os.path.join(cur, rid, "papers.parquet")):
            path = os.path.join(cur, rid, "papers.parquet")
        else:
            raise FileNotFoundError("No corpus: run notebook 00 or attach its output dataset.")
    df = pd.read_parquet(path)
    df["arxiv_id"] = df["arxiv_id"].astype(str)
    if max_papers and len(df) > max_papers:
        df = df.sample(max_papers, random_state=7).sort_index()
    print(f"Corpus: {len(df):,} papers from {path}")
    return df.reset_index(drop=True)


def paper_texts(df) -> List[str]:
    """Exactly the document text the app embeds (scholargrid.embeddings.paper_text)."""
    return (df["title"].astype(str) + ". " + df["abstract"].astype(str)).tolist()


@dataclass
class Benchmark:
    queries: List[Dict[str, Any]]
    judgments: Dict[str, Dict[str, int]]
    split: Dict[str, List[str]] = field(default_factory=dict)

    @property
    def judged(self) -> List[str]:
        return [q for q, j in self.judgments.items() if len(j) >= 5]


def load_benchmark() -> Benchmark:
    """Benchmark queries + graded judgments; notebook 01 writes ``WORK/benchmark.json`` with a fixed split."""
    path = os.path.join(WORK, "benchmark.json")
    if not os.path.exists(path):
        path = find_input("benchmark.json", must=False) or ""
    if path:
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        return Benchmark(d["queries"], d["judgments"], d.get("split", {}))
    with open(os.path.join(REPO, "configs", "validation_queries.json"), encoding="utf-8") as fh:
        queries = json.load(fh)["queries"]
    jpath = os.path.join(REPO, "configs", "search_judgments.json")
    judgments = json.load(open(jpath, encoding="utf-8")).get("judgments", {}) if os.path.exists(jpath) else {}
    return Benchmark(queries, judgments)


def heuristic_grades(df, q: Dict[str, Any]) -> np.ndarray:
    """+1 expected category, +1 expected keyword (the circular baseline; only for comparison)."""
    text = (df["title"].astype(str) + " " + df["abstract"].astype(str)).str.lower()
    cats = tuple(q.get("expect_categories", []))
    cat_ok = df["primary_category"].astype(str).str.startswith(cats).to_numpy() if cats else np.zeros(len(df), bool)
    kw_ok = np.zeros(len(df), bool)
    for w in q.get("expect_keywords", []):
        kw_ok |= text.str.contains(w.lower(), regex=False).to_numpy()
    return cat_ok.astype(int) + kw_ok.astype(int)


# ---------------------------------------------------------------------------
# Metrics (graded relevance, unjudged = 0 unless ``judged_only``)
# ---------------------------------------------------------------------------
def dcg(gains: Sequence[float]) -> float:
    return float(sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(gains)))


def metrics_for(ranked_ids: Sequence[str], grades: Dict[str, int], k: int = 10, recall_k: int = 50,
                judged_only: bool = False) -> Dict[str, Optional[float]]:
    ids = [i for i in ranked_ids if (i in grades or not judged_only)]
    gains = [grades.get(i, 0) for i in ids[:k]]
    ideal = sorted(grades.values(), reverse=True)[:k]
    idcg = dcg(ideal)
    rel = {i for i, g in grades.items() if g >= 1}
    strong = {i for i, g in grades.items() if g >= 2}
    first = next((r for r, i in enumerate(ids, start=1) if i in rel), None)
    judged_at_k = sum(1 for i in ranked_ids[:k] if i in grades)
    return {
        "ndcg@10": round(dcg(gains) / idcg, 4) if idcg > 0 else None,
        "p@10": round(sum(1 for i in ids[:k] if i in rel) / k, 4),
        "mrr": round(1 / first, 4) if first else 0.0,
        "recall@50": round(len([i for i in ids[:recall_k] if i in strong]) / len(strong), 4) if strong else None,
        "judged@10": round(judged_at_k / k, 3),
    }


def aggregate(rows: Iterable[Dict[str, Optional[float]]]) -> Dict[str, Optional[float]]:
    rows = list(rows)
    out: Dict[str, Optional[float]] = {}
    for key in ("ndcg@10", "p@10", "mrr", "recall@50", "judged@10"):
        vals = [r[key] for r in rows if r.get(key) is not None]
        out[key] = round(float(np.mean(vals)), 4) if vals else None
    out["n_queries"] = len(rows)
    return out


def bootstrap_diff(a: Sequence[float], b: Sequence[float], n: int = 2000, seed: int = 0) -> Dict[str, float]:
    """Paired bootstrap of mean(b - a): is system b better than a on the same queries?"""
    a_, b_ = np.asarray(a, float), np.asarray(b, float)
    rng = np.random.default_rng(seed)
    d = b_ - a_
    boots = [float(rng.choice(d, size=len(d), replace=True).mean()) for _ in range(n)]
    lo, hi = np.percentile(boots, [5, 95])
    return {"mean_diff": round(float(d.mean()), 4), "ci90": [round(float(lo), 4), round(float(hi), 4)],
            "p_better": round(float(np.mean(np.array(boots) > 0)), 3)}


# ---------------------------------------------------------------------------
# Retrieval building blocks
# ---------------------------------------------------------------------------
def load_encoder(key: str, dev: Optional[str] = None):
    from sentence_transformers import SentenceTransformer

    spec = MODELS[key]
    kwargs: Dict[str, Any] = {"device": dev or device()}
    if spec.get("revision"):
        kwargs["revision"] = spec["revision"]
    model = SentenceTransformer(spec["name"], **kwargs)
    if spec.get("max_seq_length"):
        model.max_seq_length = int(spec["max_seq_length"])
    elif model.max_seq_length and model.max_seq_length > 512:
        model.max_seq_length = 512
    if dev == "cuda" or (dev is None and device() == "cuda"):
        try:
            model.half()
        except Exception:
            pass
    return model


def encode(model, texts: Sequence[str], prefix: str = "", batch_size: int = 64) -> np.ndarray:
    vecs = model.encode([prefix + t for t in texts], batch_size=batch_size, show_progress_bar=len(texts) > 2000,
                        convert_to_numpy=True, normalize_embeddings=True)
    return np.asarray(vecs, dtype=np.float32)


def topk(qvecs: np.ndarray, docs: np.ndarray, k: int) -> np.ndarray:
    sims = qvecs @ docs.T
    k = min(k, docs.shape[0])
    part = np.argpartition(-sims, k - 1, axis=1)[:, :k]
    order = np.take_along_axis(sims, part, axis=1).argsort(axis=1)[:, ::-1]
    return np.take_along_axis(part, order, axis=1)


def bm25_index(texts: Sequence[str]):
    from scholargrid.bm25 import BM25Index

    return BM25Index.build(list(texts))


def rrf(rankings: Sequence[Sequence[int]], k: int = 60) -> List[int]:
    score: Dict[int, float] = {}
    for r in rankings:
        for rank, i in enumerate(r):
            score[int(i)] = score.get(int(i), 0.0) + 1.0 / (k + rank + 1)
    return sorted(score, key=lambda i: -score[i])


def evaluate_runs(runs: Dict[str, Dict[str, List[str]]], bench: Benchmark, queries: Sequence[str],
                  heuristic: Optional[Callable[[str], Dict[str, int]]] = None) -> Dict[str, Any]:
    """``runs[system][query] = ranked paper ids``. Uses judgments where present, heuristic grades otherwise."""
    out: Dict[str, Any] = {}
    for system, ranked in runs.items():
        per_q, kinds = {}, {"judged": 0, "heuristic": 0}
        for q in queries:
            grades = bench.judgments.get(q)
            if grades and len(grades) >= 5:
                kinds["judged"] += 1
            elif heuristic is not None:
                grades, kinds["heuristic"] = heuristic(q), kinds["heuristic"] + 1
            else:
                continue
            per_q[q] = metrics_for(ranked.get(q, []), grades)
        out[system] = {"summary": aggregate(per_q.values()), "labels": kinds, "per_query": per_q}
    return out


def print_table(rows: List[Dict[str, Any]], cols: Sequence[str]) -> None:
    widths = {c: max(len(c), *(len(f"{r.get(c, '')}") for r in rows)) for c in cols}
    print("  ".join(c.ljust(widths[c]) for c in cols))
    for r in rows:
        print("  ".join(f"{r.get(c, '')}".ljust(widths[c]) for c in cols))


def write_checksums(directory: str) -> Dict[str, str]:
    """Same format as ``python -m scholargrid.release checksums``."""
    import hashlib

    out: Dict[str, str] = {}
    for root, _, files in os.walk(directory):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), directory).replace("\\", "/")
            if rel in ("checksums.json", "manifest.json", "changelog.json"):
                continue
            h = hashlib.sha256()
            with open(os.path.join(root, f), "rb") as fh:
                for chunk in iter(lambda fh=fh: fh.read(1 << 20), b""):
                    h.update(chunk)
            out[rel] = h.hexdigest()
    with open(os.path.join(directory, "checksums.json"), "w", encoding="utf-8") as fh:
        json.dump(dict(sorted(out.items())), fh, indent=1)
    return out


def recommend(results: Dict[str, Any], baseline: str, metric: str = "ndcg@10", min_gain: float = 0.02,
              p_better: float = 0.9) -> Tuple[str, str]:
    """Adopt a challenger only if it beats the baseline by ``min_gain`` with paired-bootstrap confidence."""
    base = results.get(baseline)
    if not base:
        return baseline, "baseline missing"
    best, why = baseline, "no challenger beat the baseline clearly"
    for name, r in results.items():
        if name == baseline:
            continue
        qs = sorted(set(base["per_query"]) & set(r["per_query"]))
        a = [base["per_query"][q][metric] or 0.0 for q in qs]
        b = [r["per_query"][q][metric] or 0.0 for q in qs]
        if len(qs) < 10:
            continue
        diff = bootstrap_diff(a, b)
        if diff["mean_diff"] >= min_gain and diff["p_better"] >= p_better:
            cur = results[best]["summary"][metric] or 0
            if r["summary"][metric] and r["summary"][metric] > cur:
                best, why = name, f"{metric} +{diff['mean_diff']} (90% CI {diff['ci90']}, P(better)={diff['p_better']})"
    return best, why


# ---------------------------------------------------------------------------
# ScholarGrid config for Kaggle runs
# ---------------------------------------------------------------------------
def deep_merge(base: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def sg_config(overrides: Optional[Dict[str, Any]] = None, name: str = "kaggle_run"):
    """A validated ScholarGrid Config that extends ``configs/kaggle.yaml`` and writes under ``WORK/sg_data``.

    Kaggle sessions have no API keys, so LLM features are off (``llm.provider: none``); extraction stays on this
    machine's side and is attached on import (``python -m scholargrid.release import``)."""
    import yaml

    from scholargrid.config import load_config

    data_root = os.path.join(WORK, "sg_data")
    base = {
        "extends": os.path.join(REPO, "configs", "kaggle.yaml").replace("\\", "/"),
        "paths": {k: os.path.join(data_root, v).replace("\\", "/") for k, v in {
            "raw_dir": "raw", "processed_dir": "processed", "reports_dir": "reports", "stages_dir": "stages",
            "releases_dir": "releases", "live_dir": "live"}.items()},
        "storage": {"backend": "parquet", "path": os.path.join(data_root, "store.duckdb").replace("\\", "/")},
        "llm": {"cache_dir": os.path.join(data_root, "llm_cache").replace("\\", "/"),
                "usage_dir": os.path.join(data_root, "llm_usage").replace("\\", "/")},
        "workspace": {"cache_dir": os.path.join(data_root, "workspaces").replace("\\", "/")},
        "fulltext": {"store_dir": os.path.join(data_root, "fulltext").replace("\\", "/")},
        "extract": {"store_dir": os.path.join(data_root, "extract").replace("\\", "/")},
        "persistence": {"default_url": "sqlite:///" + os.path.join(data_root, "app.db").replace("\\", "/")},
    }
    raw = deep_merge(base, overrides or {})
    os.makedirs(data_root, exist_ok=True)
    path = os.path.join(WORK, f"{name}.yaml")
    with open(path, "w", encoding="utf-8") as fh:
        yaml.safe_dump(raw, fh, sort_keys=False)
    return load_config(path)


def embedding_overrides(model_key: str) -> Dict[str, Any]:
    """Config ``embedding`` section for a candidate model (written into the release's embedder_meta.json)."""
    spec = MODELS[model_key]
    return {"embedding": {"backend": "minilm", "model_name": spec["name"], "model_revision": spec.get("revision"),
                          "query_prefix": spec["query_prefix"], "max_seq_length": spec.get("max_seq_length", 256),
                          "device": "auto", "dtype": "float16" if not QUICK else "float32",
                          "batch_size": 128 if ON_KAGGLE else 32}}
