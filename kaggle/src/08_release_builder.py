# %% [markdown]
# # 08 · Release builder
#
# **Goal.** Build a complete, validated release bundle **with the app's own pipeline**, using the settings the earlier
# notebooks justified, so the local app can import it unchanged:
#
# ```
# python -m scholargrid.release import scholargrid_release_<id>.zip --activate
# ```
#
# The import re-checks everything (schema, checksums, one vector per paper, cluster ids, and that the embedding model
# loads locally and reproduces stored vectors), then attaches this machine's stored LLM extractions (open problems,
# facets) and serves it.
#
# **Settings come from** `results/02` (model), `03` (search fusion / re-rank), `05` (reduction / clustering). Any
# result file that is missing keeps the current defaults, and the choice is printed.
#
# **Kaggle setup.** GPU, internet on (repo clone, model download, OpenAlex), the arXiv snapshot dataset attached.
# A 50k build takes roughly 20–40 minutes on a T4.

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
import shutil  # noqa: E402


def load(name):
    p = os.path.join(sk.RESULTS, f"{name}.json")
    if not os.path.exists(p):
        p = sk.find_input(f"{name}.json", must=False) or ""
    return json.load(open(p, encoding="utf-8")) if p else {}


r02, r03, r05 = load("02_embedding_comparison"), load("03_hybrid_retrieval"), load("05_topics_clustering")
model = (r03.get("recommendation", {}).get("config", {}).get("embedding_model")
         or r02.get("recommendation", {}).get("model") or "bge-small")
over = sk.embedding_overrides(model)
if r03.get("recommendation"):
    over["search"] = r03["recommendation"]["config"]["search"]
if r05.get("recommendation"):
    over = sk.deep_merge(over, r05["recommendation"]["config"])
PROFILE = os.environ.get("SG_PROFILE", "dev")
if sk.ON_KAGGLE and not sk.QUICK:
    over["data"] = {"source": "kaggle", "kaggle_json": sk.find_input("arxiv-metadata-oai-snapshot.json"),
                    "profile": PROFILE, "date_start": os.environ.get("SG_DATE_START", "2023-01-01")}
else:  # local smoke test: a small synthetic corpus, CPU-friendly backends
    over = sk.deep_merge(over, {"data": {"source": "synthetic", "profile": "custom", "max_papers": 400,
                                         "date_start": "2022-01-01", "date_end": "2025-12-31"},
                                "enrich": {"openalex": False}, "reduce": {"backend": "pca"},
                                "landscape": {"backend": "pca"}, "cluster": {"backend": "kmeans"},
                                "sparse": {"min_corpus_size": 100}, "growth": {"min_papers_per_period": 10}})
print("model:", model, "\noverrides:", json.dumps(over, indent=1, default=str)[:1500])
cfg = sk.sg_config(over, name="release")

# %%
from scholargrid.pipeline import STAGES, run  # noqa: E402

stages = [s for s in STAGES if s not in ("fulltext", "extract")]
with sk.timer("pipeline"):
    meta, report = run(cfg, stages=stages)
from scholargrid.release import current_release  # noqa: E402

rid = current_release(cfg)
assert rid, "publish did not produce a release"
src = os.path.join(cfg.releases_dir, rid)

# %% [markdown]
# ## Package: checksums, verification, zip

# %%
bundle = os.path.join(sk.WORK, f"scholargrid_release_{rid}")
if os.path.exists(bundle):
    shutil.rmtree(bundle)
shutil.copytree(src, bundle)
for heavy in ("papers.csv",):
    p = os.path.join(bundle, heavy)
    if os.path.exists(p):
        os.remove(p)
results_dir = os.path.join(bundle, "experiments")
os.makedirs(results_dir, exist_ok=True)
for f in os.listdir(sk.RESULTS):
    if f.endswith(".json"):
        shutil.copy2(os.path.join(sk.RESULTS, f), results_dir)
sk.write_checksums(bundle)
from scholargrid.release_import import verify_bundle  # noqa: E402

rep = verify_bundle(cfg, bundle, check_embedder=True)
print(rep.text())
zip_path = shutil.make_archive(bundle, "zip", root_dir=sk.WORK, base_dir=os.path.basename(bundle))
print("bundle:", zip_path, f"{os.path.getsize(zip_path) / 1e6:.0f} MB")
sk.save_result("08_release_builder", {"release": rid, "model": model, "overrides": over, "verify_ok": rep.ok,
                                      "verify": {"errors": rep.errors, "warnings": rep.warnings,
                                                 "info": {k: str(v) for k, v in rep.info.items()}},
                                      "validation_gates": (report.get("gates") or {}), "zip": os.path.basename(zip_path)})

# %% [markdown]
# **Next (on your computer):** download the zip from the notebook's *Output* tab, then run
# `python -m scholargrid.release import <zip> --activate` and restart `python -m scholargrid.api`.
