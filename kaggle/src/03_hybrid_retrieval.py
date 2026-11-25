# %% [markdown]
# # 03 · Hybrid retrieval and re-ranking
#
# **Question.** Which combination of keyword (BM25) and dense retrieval, fusion constant and optional cross-encoder
# re-ranking gives the best ranking for the app's `search` settings?
#
# **Systems.** BM25 alone; dense alone (the model chosen in 02, plus the current `bge-small`); Reciprocal Rank Fusion
# with k ∈ {20, 60, 100}; RRF + cross-encoder re-ranking of the top 50 (`ms-marco-MiniLM-L-6-v2`,
# `bge-reranker-base`).
#
# **Choose on dev, report on held-out.** Settings are picked on the dev split only; the held-out numbers are the
# claim. Re-ranking must also fit the CPU latency budget of a local search (re-ranking 50 pairs on CPU).
#
# **Output.** `results/03_hybrid_retrieval.json` with recommended values for `search.hybrid`, `search.rrf_k`,
# `search.rerank`, `search.rerank_model` (keys that already exist in `configs/config.yaml`).

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
import json  # noqa: E402
import time  # noqa: E402

import numpy as np  # noqa: E402

corpus = sk.load_corpus(max_papers=1500 if sk.QUICK else None)
bench = sk.load_benchmark()
texts = sk.paper_texts(corpus)
queries = sorted({q["query"] for q in bench.queries} | set(bench.judgments))
dev = bench.split.get("dev") or queries
heldout = bench.split.get("heldout") or queries
qmeta = {q["query"]: q for q in bench.queries}
prev = os.path.join(sk.RESULTS, "02_embedding_comparison.json")
chosen = json.load(open(prev, encoding="utf-8"))["recommendation"]["model"] if os.path.exists(prev) else "bge-small"
dense_models = list(dict.fromkeys([chosen, "bge-small"]))
print("dense models:", dense_models)


def heuristic(q):
    meta = qmeta.get(q)
    if not meta:
        return {}
    g = sk.heuristic_grades(corpus, meta)
    return {corpus.iloc[i]["arxiv_id"]: int(g[i]) for i in np.flatnonzero(g > 0)}


ids = corpus["arxiv_id"].tolist()

# %%
bm25 = sk.bm25_index(texts)
lex = {q: np.argsort(-bm25.scores(q))[:100].tolist() for q in queries}
dense = {}
for key in dense_models:
    path = os.path.join(sk.WORK, f"emb_{key}.npy")
    model = sk.load_encoder(key)
    docs = np.load(path).astype(np.float32) if os.path.exists(path) and len(np.load(path, mmap_mode="r")) == len(corpus) \
        else sk.encode(model, texts, batch_size=128 if sk.ON_KAGGLE else 16)
    qv = sk.encode(model, queries, prefix=sk.MODELS[key]["query_prefix"])
    top = sk.topk(qv, docs, 100)
    dense[key] = {q: top[k].tolist() for k, q in enumerate(queries)}
    sk.free_gpu()

runs = {"bm25": {q: [ids[i] for i in lex[q]] for q in queries}}
for key in dense_models:
    runs[f"dense:{key}"] = {q: [ids[i] for i in dense[key][q]] for q in queries}
    for k in (20, 60, 100):
        runs[f"rrf{k}:{key}"] = {q: [ids[i] for i in sk.rrf([dense[key][q], lex[q]], k=k)[:100]] for q in queries}

# %% [markdown]
# ## Pick the fusion setting on dev

# %%
dev_res = sk.evaluate_runs(runs, bench, dev, heuristic=heuristic)
best_fusion = max((s for s in runs if s.startswith("rrf")), key=lambda s: dev_res[s]["summary"]["ndcg@10"] or 0)
print("best fusion on dev:", best_fusion)

# %% [markdown]
# ## Re-rank the best fused list (top 50) with cross-encoders

# %%
from sentence_transformers import CrossEncoder  # noqa: E402

rerank_costs = {}
by_id = dict(zip(ids, texts))
rerankers = {k: v for k, v in sk.RERANKERS.items() if not sk.QUICK or k == "ms-marco-minilm"}
for name, model_id in rerankers.items():
    ce = CrossEncoder(model_id, device=sk.device(), max_length=384)
    out = {}
    for q in queries:
        head = runs[best_fusion][q][:50]
        scores = ce.predict([(q, by_id[p]) for p in head], batch_size=64)
        out[q] = [head[j] for j in np.argsort(-np.asarray(scores))] + runs[best_fusion][q][50:]
    runs[f"{best_fusion}+{name}"] = out
    cpu = CrossEncoder(model_id, device="cpu", max_length=384)
    t0 = time.time()
    cpu.predict([(queries[0], by_id[p]) for p in runs[best_fusion][queries[0]][:50]], batch_size=50)
    rerank_costs[name] = {"cpu_ms_for_50": round((time.time() - t0) * 1000, 1)}
    del ce, cpu
    sk.free_gpu()
print(rerank_costs)

# %% [markdown]
# ## Held-out results and recommendation

# %%
results = sk.evaluate_runs(runs, bench, heldout, heuristic=heuristic)
table = [{"system": s, **results[s]["summary"]} for s in runs]
sk.print_table(sorted(table, key=lambda r: -(r["ndcg@10"] or 0)), ["system", "ndcg@10", "p@10", "mrr", "recall@50", "judged@10"])
baseline = "rrf60:bge-small"
best, why = sk.recommend(results, baseline)
rerank = "+" in best
rk = int(best.split(":")[0].replace("rrf", "").split("+")[0]) if best.startswith("rrf") else 60
config = {"search": {"hybrid": best.startswith("rrf"), "rrf_k": rk, "rerank": rerank,
                     **({"rerank_model": sk.RERANKERS[best.split("+")[1]]} if rerank else {})},
          "embedding_model": best.split(":")[1].split("+")[0] if ":" in best else chosen}
if rerank and rerank_costs[best.split("+")[1]]["cpu_ms_for_50"] > 1500:
    why += " (note: re-ranking is slow on CPU; consider keeping rerank off locally)"
print("recommendation:", best, "-", why, "\nconfig:", config)
sk.save_result("03_hybrid_retrieval", {"best_fusion_dev": best_fusion, "rerank_costs": rerank_costs,
                                       "summary": {s: results[s]["summary"] for s in results},
                                       "per_query": {s: results[s]["per_query"] for s in results},
                                       "recommendation": {"system": best, "reason": why, "config": config}})
