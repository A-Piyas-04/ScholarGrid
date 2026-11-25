# %% [markdown]
# # 07 · Trends and investigation leads
#
# **Goal.** Evidence-backed growth estimates with honest uncertainty, and research *leads* (never "proven gaps").
#
# **Trends.** Uses `scholargrid.growth.compute_growth` (Poisson bootstrap intervals, minimum counts, stability across
# windows) on the clusters from a pipeline run of the chosen settings, then **back-tests**: estimate growth with data
# up to month *t − 6* and check whether the direction held over the next 6 months. A trend signal that does not
# back-test better than chance should not be shown as a trend.
#
# **Leads.** For each area: share of papers whose authors state open problems (needs the local extraction, so here
# only the structural signals), recent-share, citation velocity, and how many leads survive the novelty filter.
# Leads stay labelled *leads to investigate*; sparse regions and missing coverage are not evidence of novelty.
#
# **Output.** `results/07_trends_and_leads.json` (gate pass rates, back-test accuracy, recommended `growth` settings).

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
import pandas as pd  # noqa: E402

corpus = sk.load_corpus(max_papers=3000 if sk.QUICK else None)
cl_col = "cluster_id" if "cluster_id" in corpus.columns else None
if cl_col is None:
    from sklearn.cluster import KMeans

    X = sk.encode(sk.load_encoder("bge-small"), sk.paper_texts(corpus), batch_size=128 if sk.ON_KAGGLE else 16)
    corpus["cluster_id"] = KMeans(n_clusters=20, n_init=4, random_state=0).fit_predict(X)
labels = corpus["cluster_id"].to_numpy()
corpus["date"] = pd.to_datetime(corpus["date"])
if "year_month" not in corpus:
    corpus["year_month"] = corpus["date"].dt.strftime("%Y-%m")
cfg = sk.sg_config({}, name="trends")
from scholargrid.growth import compute_growth  # noqa: E402

growth = compute_growth(corpus, labels, cfg)
rel = sum(1 for g in growth["clusters"].values() if g.get("reliable"))
print("areas with a reliable trend:", rel, "of", len(growth["clusters"]))

# %% [markdown]
# ## Back-test: does the 6-month direction persist?

# %%
ref = corpus["date"].max()
cut = ref - pd.DateOffset(months=6)
past = corpus[corpus["date"] <= cut]
g_past = compute_growth(past, past["cluster_id"].to_numpy(), cfg)
hits, total = 0, 0
for cid, g in g_past["clusters"].items():
    w = (g.get("windows") or {}).get("6") or {}
    if not g.get("reliable") or w.get("direction") in (None, "no clear change"):
        continue
    later = corpus[(corpus["date"] > cut) & (corpus["cluster_id"] == int(cid))]
    before = corpus[(corpus["date"] > cut - pd.DateOffset(months=6)) & (corpus["date"] <= cut) & (corpus["cluster_id"] == int(cid))]
    share_later = len(later) / max(1, (corpus["date"] > cut).sum())
    share_before = len(before) / max(1, ((corpus["date"] > cut - pd.DateOffset(months=6)) & (corpus["date"] <= cut)).sum())
    went_up = share_later > share_before
    total += 1
    hits += int(went_up == (w["direction"] == "growing"))
backtest = {"directional_calls": total, "held": hits, "accuracy": round(hits / total, 3) if total else None}
print(backtest)

# %%
recent = corpus["date"] >= ref - pd.DateOffset(months=12)
leads = (pd.DataFrame({"cluster": labels, "recent": recent, "cites": corpus.get("cited_by_count", 0)})
         .groupby("cluster").agg(size=("recent", "size"), recent_share=("recent", "mean"), median_cites=("cites", "median"))
         .reset_index())
leads = leads[leads["cluster"] >= 0].sort_values("recent_share", ascending=False)
sk.save_result("07_trends_and_leads", {
    "reliable_areas": rel, "areas": len(growth["clusters"]), "backtest_6m": backtest,
    "recommendation": "Show growth only where reliable AND back-test accuracy > 0.6; otherwise counts only.",
    "lead_signals_top10": leads.head(10).to_dict(orient="records"),
    "reminder": "Leads are prompts to investigate, not evidence that a problem is unsolved."})
