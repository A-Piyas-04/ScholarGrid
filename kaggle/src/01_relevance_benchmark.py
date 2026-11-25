# %% [markdown]
# # 01 · Relevance benchmark
#
# **Goal.** A trustworthy yardstick for every retrieval change. The release's current search score uses heuristic
# grades (expected category + keyword), which is circular. This notebook builds the benchmark from **human graded
# judgments** (0 = not relevant, 1 = partly, 2 = relevant).
#
# **How labels are made.** Run the web app locally and open **Explore → Judge search results** (`/evaluate`). It
# pools results from dense, keyword and hybrid search blind and writes `configs/search_judgments.json`. Commit
# that file (or attach it as a dataset) before running this notebook. Aim for **≥ 40 queries with ≥ 15 judged
# papers each**; below 20 judged queries every downstream report is marked *provisional*.
#
# **This notebook also** pools candidates for unjudged queries from several systems and exports a labelling sheet
# (`judgments_todo.csv`), so you can judge offline too, then re-import with
# `python -m scholargrid.judgments import judgments_todo.csv`.
#
# **Output.** `benchmark.json` (queries, judgments, fixed dev / held-out split), `judgments_todo.csv`.

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

corpus = sk.load_corpus(max_papers=3000 if sk.QUICK else None)
bench = sk.load_benchmark()
jpath = os.path.join(sk.REPO, "configs", "search_judgments.json")
attached = sk.find_input("search_judgments.json", must=False)
if attached:
    jpath = attached
judgments = json.load(open(jpath, encoding="utf-8")).get("judgments", {}) if os.path.exists(jpath) else {}
ids = set(corpus["arxiv_id"])
in_corpus = {q: {p: g for p, g in j.items() if p in ids} for q, j in judgments.items()}
usable = {q: j for q, j in in_corpus.items() if len(j) >= 5}
print(f"{len(judgments)} judged queries, {len(usable)} with >= 5 judged papers inside this corpus")

# %% [markdown]
# ## Pool candidates for labelling (BM25 + MiniLM dense + RRF), depth 20

# %%
texts = sk.paper_texts(corpus)
bm25 = sk.bm25_index(texts)
enc = sk.load_encoder("minilm")
doc_vecs = sk.encode(enc, texts, batch_size=128 if sk.ON_KAGGLE else 32)
queries = [q["query"] for q in bench.queries] + [q for q in judgments if q not in {x["query"] for x in bench.queries}]
q_vecs = sk.encode(enc, queries)
dense = sk.topk(q_vecs, doc_vecs, 20)
rows = []
for qi, q in enumerate(queries):
    lex = np.argsort(-bm25.scores(q))[:20]
    pool = sk.rrf([dense[qi].tolist(), lex.tolist()])[:30]
    for i in pool:
        pid = corpus.iloc[i]["arxiv_id"]
        if pid in judgments.get(q, {}):
            continue
        rows.append({"query": q, "arxiv_id": pid, "title": corpus.iloc[i]["title"],
                     "abstract": str(corpus.iloc[i]["abstract"])[:600], "grade": ""})
todo = pd.DataFrame(rows)
todo.to_csv(os.path.join(sk.WORK, "judgments_todo.csv"), index=False)
print(f"{len(todo)} unjudged pooled candidates written to judgments_todo.csv")

# %% [markdown]
# ## Fixed split: 70% dev (for choosing settings), 30% held-out (for the final claim)

# %%
rng = np.random.default_rng(13)
judged_q = sorted(usable)
order = rng.permutation(len(judged_q))
cut = int(round(0.7 * len(judged_q)))
split = {"dev": [judged_q[i] for i in order[:cut]], "heldout": [judged_q[i] for i in order[cut:]]}
all_q = sorted(set(queries))
heur_split = {"dev": [q for k, q in enumerate(all_q) if k % 10 < 7], "heldout": [q for k, q in enumerate(all_q) if k % 10 >= 7]}
provisional = len(judged_q) < 20
bench_out = {"queries": bench.queries, "judgments": in_corpus, "split": split if not provisional else heur_split,
             "provisional": provisional, "n_judged_queries": len(judged_q),
             "n_judgments": int(sum(len(j) for j in in_corpus.values())),
             "grade_distribution": pd.Series([g for j in in_corpus.values() for g in j.values()]).value_counts().to_dict()}
with open(os.path.join(sk.WORK, "benchmark.json"), "w", encoding="utf-8") as fh:
    json.dump(bench_out, fh, indent=1)
if provisional:
    print("PROVISIONAL: fewer than 20 judged queries. Metrics will mix human and heuristic grades. "
          "Judge more queries in the web app (/evaluate) and re-run.")
sk.save_result("01_relevance_benchmark", {k: v for k, v in bench_out.items() if k not in ("queries", "judgments")})
