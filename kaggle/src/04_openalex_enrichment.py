# %% [markdown]
# # 04 · OpenAlex enrichment
#
# **Goal.** Add carefully matched scholarly metadata to the corpus: citations, references (for foundations and the
# citation graph), venues, author ids. Uses the app's own matcher (`scholargrid.enrich`), which matches by DOI
# (arXiv DOI `10.48550/arXiv.<id>`) and only falls back to fuzzy title matching when asked.
#
# **Kaggle setup.** Internet on. OpenAlex needs no key. Set `OPENALEX_MAILTO` in Kaggle *Secrets* to join the polite
# pool (faster, kinder); the address is never written to the outputs. ~50 papers per request: 50k papers ≈ 1,000
# requests ≈ 15–30 minutes.
#
# **Checks.** Match rate overall and for papers older than 3 months (new papers are often not indexed yet);
# reference coverage for papers older than 6 months; a sample of matches is re-checked by title similarity so wrong
# matches are caught, not hidden.
#
# **Output.** `corpus_enriched.parquet` (corpus + `openalex_id, cited_by_count, references, reference_count, venue,
# venue_type, author_ids, topic`), `results/04_openalex_enrichment.json`.

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

try:
    from kaggle_secrets import UserSecretsClient  # type: ignore

    os.environ.setdefault("OPENALEX_MAILTO", UserSecretsClient().get_secret("OPENALEX_MAILTO"))
except Exception:
    pass

corpus = sk.load_corpus(max_papers=200 if sk.QUICK else None)
cfg = sk.sg_config({"enrich": {"openalex": True, "title_fallback": False}}, name="enrich")
from scholargrid.enrich import enrich, match_stats  # noqa: E402

with sk.timer("enrich"):
    enriched = enrich(corpus.copy(), cfg)
stats = match_stats(enriched)
print(stats)

# %% [markdown]
# ## Spot-check matches by title similarity

# %%
from rapidfuzz import fuzz  # noqa: E402

check = {"sampled": 0, "low_similarity": 0}
if "openalex_title" in enriched.columns:
    s = enriched[enriched["openalex_title"].astype(str) != ""].sample(min(300, len(enriched)), random_state=1)
    sims = [fuzz.token_set_ratio(a, b) for a, b in zip(s["title"], s["openalex_title"])]
    check = {"sampled": len(sims), "low_similarity": int(sum(x < 80 for x in sims))}
print(check)

# %%
enriched.to_parquet(os.path.join(sk.WORK, "corpus_enriched.parquet"), index=False)
cov = {"with_citations": int((enriched["cited_by_count"] > 0).sum()),
       "with_references": int((enriched["reference_count"] > 0).sum()) if "reference_count" in enriched else 0,
       "median_citations": float(np.median(enriched["cited_by_count"])) if "cited_by_count" in enriched else 0}
sk.save_result("04_openalex_enrichment", {"match": stats, "coverage": cov, "title_check": check,
                                          "n_papers": len(enriched)})
