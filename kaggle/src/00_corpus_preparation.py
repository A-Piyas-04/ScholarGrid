# %% [markdown]
# # 00 · Corpus preparation
#
# **Goal.** Freeze the paper corpus every later notebook uses, with the same cleaning and stratified sampling as the
# app's pipeline (`scholargrid.data_ingest`), so results transfer directly into a release.
#
# **Kaggle setup.** Add the dataset *Cornell-University/arxiv* (`arxiv-metadata-oai-snapshot.json`). Internet on
# (to clone the repo). No GPU needed.
#
# **Output.** `corpus.parquet` (one row per paper, the ingest schema), `corpus_manifest.json` (counts, category and
# month shares, checksum). Save the notebook output as a Kaggle dataset (e.g. `scholargrid-corpus`) and attach it
# to the next notebooks.
#
# **Scope.** Start with `SG_PROFILE=dev` (~5k papers). Move to `standard` (~50k) only after notebooks 01–03 work.

# %%
# Bootstrap (identical in every notebook): get the repo, then import the shared helpers.
import os
import sys

if os.path.isdir("/kaggle/working") and not os.path.isdir("/kaggle/working/sg/kaggle"):
    os.system("git clone --depth 1 -b upgrade-use-case https://github.com/A-Piyas-04/PaperPorteHobe.git /kaggle/working/sg")
sys.path.insert(0, "/kaggle/working/sg/kaggle" if os.path.isdir("/kaggle/working") else os.path.abspath("kaggle"))
import sg_kaggle as sk  # noqa: E402

sk.setup()
PROFILE = os.environ.get("SG_PROFILE", "dev")
DATE_START = os.environ.get("SG_DATE_START", "2023-01-01")

# %% [markdown]
# ## Build the corpus with the app's own ingest code

# %%
import hashlib  # noqa: E402

import pandas as pd  # noqa: E402

if sk.ON_KAGGLE and not sk.QUICK:
    snapshot = sk.find_input("arxiv-metadata-oai-snapshot.json")
    cfg = sk.sg_config({"data": {"source": "kaggle", "kaggle_json": snapshot, "profile": PROFILE,
                                 "date_start": DATE_START, "date_end": "auto"}}, name="corpus")
    from scholargrid.data_ingest import build_corpus

    corpus = build_corpus(cfg)
else:
    # QUICK / local: reuse the current release's papers so the downstream notebooks can be smoke-tested.
    corpus = sk.load_corpus(max_papers=2000 if sk.QUICK else None)
    keep = [c for c in ["arxiv_id", "title", "abstract", "authors", "categories", "primary_category", "date",
                        "doi", "journal_ref", "license", "year_month", "sample_weight"] if c in corpus.columns]
    corpus = corpus[keep]

corpus["arxiv_id"] = corpus["arxiv_id"].astype(str)
corpus["date"] = pd.to_datetime(corpus["date"])
assert corpus["arxiv_id"].is_unique, "duplicate ids after cleaning"
print(len(corpus), "papers")

# %% [markdown]
# ## Checks and manifest

# %%
out = os.path.join(sk.WORK, "corpus.parquet")
corpus.to_parquet(out, index=False)
digest = hashlib.sha256(open(out, "rb").read()).hexdigest()
cats = corpus["primary_category"].value_counts(normalize=True)
months = corpus["date"].dt.strftime("%Y-%m").value_counts().sort_index()
manifest = {
    "profile": PROFILE, "n_papers": len(corpus), "sha256": digest,
    "date_range": [str(corpus["date"].min().date()), str(corpus["date"].max().date())],
    "n_categories": int(corpus["primary_category"].nunique()),
    "top_category_share": round(float(cats.iloc[0]), 4), "top_categories": cats.head(10).round(4).to_dict(),
    "papers_per_month": {"min": int(months.min()), "median": int(months.median()), "max": int(months.max())},
    "missing_abstract": int(corpus["abstract"].isna().sum()),
    "abstract_chars_median": int(corpus["abstract"].astype(str).str.len().median()),
}
with open(os.path.join(sk.WORK, "corpus_manifest.json"), "w", encoding="utf-8") as fh:
    import json

    json.dump(manifest, fh, indent=1)
assert manifest["top_category_share"] < 0.6, "one category dominates; check the category filter"
sk.save_result("00_corpus_preparation", manifest)
manifest
