# %% [markdown]
# # 05 · Topics and clustering
#
# **Problem.** The current release leaves **43% of papers unclustered** (HDBSCAN noise) with 77 areas, and area names
# are keyword strings. This notebook searches for settings that give coherent, stable areas without hiding the
# uncertainty.
#
# **Grid.** Embeddings from 02 (chosen model) × UMAP `n_neighbors` ∈ {15, 30} × HDBSCAN `min_cluster_size`
# ∈ {0.002, 0.003, 0.005}·N × `cluster_selection_method` ∈ {leaf, eom}; plus a soft re-assignment of noise points to
# their nearest cluster when similarity is high (reported separately, never silently).
#
# **Metrics.** Noise share, number of areas, silhouette (reduced space), DBCV where available, stability as ARI across
# 3 subsample re-runs, and keyword coherence (mean pairwise NPMI of each area's top terms inside the corpus).
# Prefer stable, coherent settings over fewer noise points.
#
# **Output.** `results/05_topics_clustering.json` with the recommended `reduce` / `cluster` config values.

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
import itertools  # noqa: E402
import json  # noqa: E402

import numpy as np  # noqa: E402
from sklearn.feature_extraction.text import CountVectorizer  # noqa: E402
from sklearn.metrics import adjusted_rand_score, silhouette_score  # noqa: E402

corpus = sk.load_corpus(max_papers=1500 if sk.QUICK else None)
prev = os.path.join(sk.RESULTS, "02_embedding_comparison.json")
model = json.load(open(prev, encoding="utf-8"))["recommendation"]["model"] if os.path.exists(prev) else "bge-small"
path = os.path.join(sk.WORK, f"emb_{model}.npy")
if os.path.exists(path) and len(np.load(path, mmap_mode="r")) == len(corpus):
    X = np.load(path).astype(np.float32)
else:
    X = sk.encode(sk.load_encoder(model), sk.paper_texts(corpus), batch_size=128 if sk.ON_KAGGLE else 16)
N = len(X)
print("embeddings", X.shape, "model", model)

# %%
import hdbscan  # noqa: E402
import umap  # noqa: E402

cv = CountVectorizer(stop_words="english", min_df=3, max_features=20000, ngram_range=(1, 1))
D = (cv.fit_transform((corpus["title"] + " " + corpus["abstract"]).astype(str)) > 0).astype(np.int8).tocsc()
vocab = np.array(cv.get_feature_names_out())
df_w = np.asarray(D.sum(axis=0)).ravel()


def npmi_coherence(labels, top_n=8):
    scores = []
    for c in sorted(set(labels) - {-1}):
        rows = np.flatnonzero(labels == c)
        in_c = np.asarray(D[rows].sum(axis=0)).ravel()
        tfidf = in_c / (df_w + 1)
        top = np.argsort(-tfidf)[:top_n]
        pairs = []
        for a, b in itertools.combinations(top, 2):
            pab = D[:, a].multiply(D[:, b]).sum() / N
            pa, pb = df_w[a] / N, df_w[b] / N
            if pab > 0:
                pairs.append(np.log(pab / (pa * pb)) / -np.log(pab))
        if pairs:
            scores.append(float(np.mean(pairs)))
    return round(float(np.mean(scores)), 4) if scores else None


def run(nn, mcs_frac, method, seed=42, idx=None):
    data = X if idx is None else X[idx]
    red = umap.UMAP(n_neighbors=nn, n_components=8, min_dist=0.0, metric="cosine", random_state=seed).fit_transform(data)
    mcs = max(5, int(mcs_frac * len(data)))
    lab = hdbscan.HDBSCAN(min_cluster_size=mcs, min_samples=5, cluster_selection_method=method).fit_predict(red)
    return red, lab


grid = [(15, 0.003, "leaf")] if sk.QUICK else list(itertools.product([15, 30], [0.002, 0.003, 0.005], ["leaf", "eom"]))
rows = []
rng = np.random.default_rng(0)
for nn, frac, method in grid:
    red, lab = run(nn, frac, method)
    k = len(set(lab) - {-1})
    mask = lab >= 0
    sil = float(silhouette_score(red[mask], lab[mask], sample_size=min(5000, int(mask.sum())), random_state=0)) if k > 1 else None
    aris = []
    for s in range(2 if sk.QUICK else 3):
        sub = np.sort(rng.choice(N, int(0.8 * N), replace=False))
        _, lab_s = run(nn, frac, method, seed=s, idx=sub)
        both = (lab[sub] >= 0) & (lab_s >= 0)
        if both.sum() > 10:
            aris.append(adjusted_rand_score(lab[sub][both], lab_s[both]))
    rows.append({"n_neighbors": nn, "min_cluster_frac": frac, "method": method, "areas": k,
                 "noise": round(float((lab == -1).mean()), 4), "silhouette": None if sil is None else round(sil, 4),
                 "stability_ari": round(float(np.mean(aris)), 4) if aris else None, "coherence_npmi": npmi_coherence(lab)})
    print(rows[-1])

# %% [markdown]
# ## Choose: stability ≥ 0.6 first, then coherence, then lower noise

# %%
ok = [r for r in rows if (r["stability_ari"] or 0) >= 0.6] or rows
best = max(ok, key=lambda r: ((r["coherence_npmi"] or 0), -r["noise"]))
config = {"reduce": {"backend": "umap", "umap_n_neighbors": best["n_neighbors"]},
          "cluster": {"backend": "hdbscan", "min_cluster_fraction": best["min_cluster_frac"],
                      "hdbscan_cluster_selection_method": best["method"]}}
sk.print_table(rows, ["n_neighbors", "min_cluster_frac", "method", "areas", "noise", "silhouette", "stability_ari", "coherence_npmi"])
print("recommended:", config)
sk.save_result("05_topics_clustering", {"model": model, "grid": rows, "recommendation": {"setting": best, "config": config}})
