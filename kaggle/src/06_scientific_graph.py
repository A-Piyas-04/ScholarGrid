# %% [markdown]
# # 06 · Scientific graph with provenance
#
# **Goal.** Keep three kinds of links apart, because they mean different things to a researcher:
#
# | Edge type | Meaning | Provenance |
# |---|---|---|
# | `cites` | paper A's reference list contains paper B | OpenAlex references (notebook 04) |
# | `coupling` | A and B cite ≥ 2 of the same works | OpenAlex references |
# | `similar` | A and B have close embeddings | model name + cosine, *model-estimated* |
#
# The app's map currently draws similarity (+ a coupling boost) and must never present a similarity line as a
# citation. This notebook measures how much the three overlap and exports a typed edge table a future release can
# ship next to `edges.json`.
#
# **Output.** `edges_typed.parquet` (`source, target, type, weight, provenance`), `results/06_scientific_graph.json`.

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
from collections import defaultdict  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

path = os.path.join(sk.WORK, "corpus_enriched.parquet")
df = pd.read_parquet(path) if os.path.exists(path) else sk.load_corpus(max_papers=1500 if sk.QUICK else None)
df["arxiv_id"] = df["arxiv_id"].astype(str)
prev = os.path.join(sk.RESULTS, "02_embedding_comparison.json")
model = json.load(open(prev, encoding="utf-8"))["recommendation"]["model"] if os.path.exists(prev) else "bge-small"
emb_path = os.path.join(sk.WORK, f"emb_{model}.npy")
X = np.load(emb_path).astype(np.float32) if os.path.exists(emb_path) and len(np.load(emb_path, mmap_mode="r")) == len(df) \
    else sk.encode(sk.load_encoder(model), sk.paper_texts(df), batch_size=128 if sk.ON_KAGGLE else 16)

# %%
oa = df.get("openalex_id", pd.Series([""] * len(df))).astype(str).str.rsplit("/", n=1).str[-1]
row_of = {o: i for i, o in enumerate(oa) if o}
refs = [str(r).split() if isinstance(r, str) else list(r) if r is not None else [] for r in df.get("references", [[]] * len(df))]
refs = [[x.rsplit("/", 1)[-1] for x in r] for r in refs]

edges = []
for i, r in enumerate(refs):
    for w in r:
        j = row_of.get(w)
        if j is not None and j != i:
            edges.append((i, j, "cites", 1.0, "openalex:references"))
inv = defaultdict(list)
for i, r in enumerate(refs):
    for w in set(r):
        inv[w].append(i)
shared = defaultdict(int)
for papers in inv.values():
    if 1 < len(papers) <= 200:
        for a in range(len(papers)):
            for b in range(a + 1, len(papers)):
                shared[(papers[a], papers[b])] += 1
edges += [(a, b, "coupling", float(n), "openalex:shared_references") for (a, b), n in shared.items() if n >= 2]
K = 6
top = sk.topk(X, X, K + 1)
sims = X @ X.T if len(X) <= 5000 else None
for i in range(len(X)):
    for j in top[i][1:]:
        if i < j:
            s = float(sims[i, j]) if sims is not None else float(X[i] @ X[j])
            edges.append((i, int(j), "similar", round(s, 4), f"model:{sk.MODELS[model]['name']}"))
E = pd.DataFrame(edges, columns=["source", "target", "type", "weight", "provenance"])
E["source"] = df["arxiv_id"].to_numpy()[E["source"]]
E["target"] = df["arxiv_id"].to_numpy()[E["target"]]
E.to_parquet(os.path.join(sk.WORK, "edges_typed.parquet"), index=False)

# %% [markdown]
# ## How often does "similar" coincide with a real citation or shared references?

# %%
def keyset(t):
    sub = E[E["type"] == t]
    return {tuple(sorted(p)) for p in zip(sub["source"], sub["target"])}


sim_k, cite_k, coup_k = keyset("similar"), keyset("cites"), keyset("coupling")
overlap = {"similar_edges": len(sim_k), "cites_edges": len(cite_k), "coupling_edges": len(coup_k),
           "similar_that_cite": len(sim_k & cite_k), "similar_that_couple": len(sim_k & coup_k),
           "share_similar_backed_by_references": round(len(sim_k & (cite_k | coup_k)) / max(1, len(sim_k)), 4)}
print(overlap)
sk.save_result("06_scientific_graph", {"model": model, "overlap": overlap,
                                       "edge_counts": E["type"].value_counts().to_dict(),
                                       "note": "Ship edges_typed.parquet with a release to let the map style "
                                               "citations, coupling and similarity differently."})
