# %% [markdown]
# # 02 · Embedding model comparison
#
# **Question.** Does a scientific or larger embedding model retrieve better papers than the current
# `BAAI/bge-small-en-v1.5`, enough to justify its cost?
#
# **Candidates** (see `sk.MODELS`): `minilm` (original baseline), `bge-small` (current release), `specter2-base`,
# `qwen3-0.6b`, optionally `bge-m3`. Every model embeds exactly the app's document text (`title. abstract`) with
# its model-card query prefix.
#
# **Measured.** nDCG@10, P@10, MRR, recall@50 on the **held-out** queries (graded judgments; heuristic grades only
# where no judgments exist, reported separately), encode time per 1k papers, query latency on CPU (what the local
# app pays per search), GPU memory, vector size on disk.
#
# **Decision rule.** Adopt a challenger only if it beats `bge-small` by ≥ 0.02 nDCG@10 with paired-bootstrap
# P(better) ≥ 0.9 **and** its CPU query latency stays under ~300 ms. Bigger is not assumed to be better.
#
# **Kaggle setup.** GPU (T4 ×2 or P100), internet on, attach the outputs of 00 and 01.
#
# **Output.** `results/02_embedding_comparison.json`, `emb_<model>.npy` (document vectors, reused by 03 and 05).

# %%
# Bootstrap (identical in every notebook): get the repo, then import the shared helpers.
import os
import sys

if os.path.isdir("/kaggle/working") and not os.path.isdir("/kaggle/working/sg/kaggle"):
    os.system("git clone --depth 1 -b upgrade-use-case https://github.com/A-Piyas-04/PaperPorteHobe.git /kaggle/working/sg")
sys.path.insert(0, "/kaggle/working/sg/kaggle" if os.path.isdir("/kaggle/working") else os.path.abspath("kaggle"))
import sg_kaggle as sk  # noqa: E402

sk.setup()

# %%
import numpy as np  # noqa: E402

corpus = sk.load_corpus(max_papers=1500 if sk.QUICK else None)
bench = sk.load_benchmark()
texts = sk.paper_texts(corpus)
queries = sorted({q["query"] for q in bench.queries} | set(bench.judgments))
heldout = bench.split.get("heldout") or queries
qmeta = {q["query"]: q for q in bench.queries}
CANDIDATES = os.environ.get("SG_MODELS", "minilm,bge-small" if sk.QUICK else "minilm,bge-small,specter2-base,qwen3-0.6b")
CANDIDATES = [c.strip() for c in CANDIDATES.split(",") if c.strip()]
print("models:", CANDIDATES, "| held-out queries:", len(heldout))


def heuristic(q):
    meta = qmeta.get(q)
    if not meta:
        return {}
    g = sk.heuristic_grades(corpus, meta)
    return {corpus.iloc[i]["arxiv_id"]: int(g[i]) for i in np.flatnonzero(g > 0)}


# %% [markdown]
# ## Encode and retrieve with each model

# %%
import time  # noqa: E402

runs, costs = {}, {}
for key in CANDIDATES:
    spec = sk.MODELS[key]
    sk.free_gpu()
    t = {}
    with sk.timer("load", t):
        model = sk.load_encoder(key)
    with sk.timer("encode_docs", t):
        docs = sk.encode(model, texts, prefix=spec.get("doc_prefix", ""), batch_size=128 if sk.ON_KAGGLE else 16)
    np.save(os.path.join(sk.WORK, f"emb_{key}.npy"), docs.astype(np.float16))
    qv = sk.encode(model, queries, prefix=spec["query_prefix"])
    top = sk.topk(qv, docs, 100)
    runs[key] = {q: [corpus.iloc[i]["arxiv_id"] for i in top[k]] for k, q in enumerate(queries)}
    # CPU query latency: what a local search pays to embed one query.
    cpu = sk.load_encoder(key, dev="cpu")
    lat = []
    for q in queries[:20]:
        t0 = time.time()
        sk.encode(cpu, [q], prefix=spec["query_prefix"])
        lat.append(time.time() - t0)
    costs[key] = {"dim": int(docs.shape[1]), "encode_s_per_1k": round(t["encode_docs"] / len(texts) * 1000, 2),
                  "cpu_query_ms_p50": round(float(np.median(lat)) * 1000, 1), "gpu_peak_mb": sk.gpu_mem_mb(),
                  "disk_mb_fp16": round(docs.shape[0] * docs.shape[1] * 2 / 1e6, 1), "params_m": spec.get("params_m")}
    del model, cpu
    print(key, costs[key])

# %% [markdown]
# ## Quality on held-out queries

# %%
results = sk.evaluate_runs(runs, bench, heldout, heuristic=heuristic)
table = [{"model": k, **results[k]["summary"], **costs[k], "labels": results[k]["labels"]} for k in runs]
sk.print_table(table, ["model", "ndcg@10", "p@10", "mrr", "recall@50", "judged@10", "cpu_query_ms_p50", "dim"])
best, why = sk.recommend(results, "bge-small" if "bge-small" in results else CANDIDATES[0])
if costs.get(best, {}).get("cpu_query_ms_p50", 0) > 300:
    why += f"; but CPU query latency {costs[best]['cpu_query_ms_p50']} ms is high for local search"
print("recommendation:", best, "-", why)
sk.save_result("02_embedding_comparison", {"models": CANDIDATES, "costs": costs,
                                           "summary": {k: results[k]["summary"] for k in results},
                                           "labels": {k: results[k]["labels"] for k in results},
                                           "per_query": {k: results[k]["per_query"] for k in results},
                                           "recommendation": {"model": best, "reason": why},
                                           "provisional": bool(getattr(bench, "split", None) is None)})

# %% [markdown]
# ### Optional: full SPECTER2 with adapters
#
# `allenai/specter2_base` above is the shared encoder. The paper-recommended setup loads the *proximity* adapter for
# documents and the *adhoc_query* adapter for short queries (`pip install adapters`). Run it only if
# `specter2-base` is competitive; it cannot be served by sentence-transformers alone, so adopting it would need an
# `Embedder` backend in `scholargrid/embeddings.py`.
