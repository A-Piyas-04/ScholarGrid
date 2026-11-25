# %% [markdown]
# # 09 · Optional fine-tuning (only if justified)
#
# **When to run.** Only if 02/03 leave a measurable gap (for example, judged queries where relevant papers sit
# below rank 20) **and** there are enough training pairs that do not overlap the held-out queries. Otherwise stop:
# a fine-tuned model is one more artifact to version and serve.
#
# **Training pairs** (dev split only, never held-out queries):
# 1. judged query → paper graded 2 (relevant),
# 2. citation pairs: paper text → text of a paper it cites inside the corpus (from notebook 04),
# with in-batch negatives (`MultipleNegativesRankingLoss`).
#
# **Acceptance.** Same rule as 02: ≥ 0.02 nDCG@10 on held-out with paired-bootstrap P(better) ≥ 0.9, and no loss on
# the heuristic sanity set larger than 0.02. Otherwise the base model stays.
#
# **Serving a fine-tuned model.** The app loads embedders by name with sentence-transformers. Either push the model
# to the Hugging Face Hub (needs your account) and use its id, or copy the saved folder next to the app and build the
# release with `embedding.model_name` set to that folder's absolute path.

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

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

bench = sk.load_benchmark()
path = os.path.join(sk.WORK, "corpus_enriched.parquet")
corpus = pd.read_parquet(path) if os.path.exists(path) else sk.load_corpus(max_papers=1500 if sk.QUICK else None)
corpus["arxiv_id"] = corpus["arxiv_id"].astype(str)
prev = os.path.join(sk.RESULTS, "02_embedding_comparison.json")
base_key = json.load(open(prev, encoding="utf-8"))["recommendation"]["model"] if os.path.exists(prev) else "bge-small"
spec = sk.MODELS[base_key]
texts = dict(zip(corpus["arxiv_id"], sk.paper_texts(corpus)))
dev = set(bench.split.get("dev") or [])
heldout = bench.split.get("heldout") or []

pairs = [(spec["query_prefix"] + q, texts[p]) for q in dev for p, g in bench.judgments.get(q, {}).items()
         if g >= 2 and p in texts]
if "references" in corpus.columns:
    oa = corpus["openalex_id"].astype(str).str.rsplit("/", n=1).str[-1]
    by_oa = dict(zip(oa, corpus["arxiv_id"]))
    for aid, refs in zip(corpus["arxiv_id"], corpus["references"]):
        for w in (str(refs).split() if isinstance(refs, str) else list(refs or []))[:5]:
            t = by_oa.get(str(w).rsplit("/", 1)[-1])
            if t and t != aid:
                pairs.append((texts[aid], texts[t]))
print(f"{len(pairs)} training pairs ({len(dev)} dev queries)")
ENOUGH = 2000 if not sk.QUICK else 20

# %%
if len(pairs) < ENOUGH or len(heldout) < 10:
    msg = f"Skipped: {len(pairs)} pairs / {len(heldout)} held-out queries is not enough to justify fine-tuning."
    print(msg)
    sk.save_result("09_optional_finetuning", {"skipped": True, "reason": msg})
else:
    from sentence_transformers import InputExample, losses
    from torch.utils.data import DataLoader

    model = sk.load_encoder(base_key)
    model.float()
    rng = np.random.default_rng(0)
    rng.shuffle(pairs)
    loader = DataLoader([InputExample(texts=[a, b]) for a, b in pairs], batch_size=64 if sk.ON_KAGGLE else 8,
                        shuffle=True)
    loss = losses.MultipleNegativesRankingLoss(model)
    model.fit(train_objectives=[(loader, loss)], epochs=1, warmup_steps=int(0.1 * len(loader)), show_progress_bar=True)
    out_dir = os.path.join(sk.WORK, f"finetuned-{base_key}")
    model.save(out_dir)

    ids = corpus["arxiv_id"].tolist()
    doc_text = sk.paper_texts(corpus)
    runs = {}
    for name, m in (("base", sk.load_encoder(base_key)), ("finetuned", model)):
        docs = sk.encode(m, doc_text, batch_size=128 if sk.ON_KAGGLE else 16)
        qv = sk.encode(m, heldout, prefix=spec["query_prefix"])
        top = sk.topk(qv, docs, 100)
        runs[name] = {q: [ids[i] for i in top[k]] for k, q in enumerate(heldout)}
    res = sk.evaluate_runs(runs, bench, heldout)
    best, why = sk.recommend(res, "base")
    print({k: v["summary"] for k, v in res.items()}, "\n->", best, why)
    sk.save_result("09_optional_finetuning", {"skipped": False, "pairs": len(pairs), "base": base_key,
                                              "summary": {k: v["summary"] for k, v in res.items()},
                                              "adopt": best == "finetuned", "reason": why, "model_dir": out_dir})
