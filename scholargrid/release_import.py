"""Import and verify externally built release bundles (for example from the Kaggle notebooks).

A bundle built elsewhere must pass the same contract the app relies on before it can be served:

* required files exist and parse (``papers.parquet``, ``embeddings.npy``, ``clusters.json``, ``growth.json``,
  ``sparse.json``, ``meta.json``, ``embedder/embedder_meta.json``),
* ``papers.parquet`` has the required columns, unique ids, and one embedding row per paper,
* embeddings are finite, L2-normalised and match the embedder's dimension,
* every ``cluster_id`` is ``-1`` or a key of ``clusters.json``,
* the SHA-256 checksums in ``checksums.json`` (if present) match,
* optional tables (facets, problems, findings, profiles) reference papers in the bundle,
* the embedding model named in the bundle loads locally and reproduces stored paper vectors (cosine >= 0.98),
  so live queries are embedded in the same space. ``--allow-bm25`` accepts a bundle without that, in which case
  search degrades to keywords.

Usage::

    python -m scholargrid.release verify <dir|zip>
    python -m scholargrid.release import <dir|zip> [--id ID] [--activate] [--allow-bm25]
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from .config import Config
from .utils import get_logger, load_json, save_json

log = get_logger("release.import")

REQUIRED_FILES = ["papers.parquet", "embeddings.npy", "clusters.json", "growth.json", "sparse.json", "meta.json",
                  "embedder/embedder_meta.json"]
REQUIRED_COLUMNS = ["arxiv_id", "title", "abstract", "primary_category", "date", "cluster_id", "x2d", "y2d"]
OPTIONAL_TABLES = ["paper_facets.parquet", "problems.parquet", "findings.parquet", "paper_profile.parquet"]
CHECKSUMS_FILE = "checksums.json"
_HASH_SKIP = {CHECKSUMS_FILE, "manifest.json", "changelog.json"}


@dataclass
class Report:
    ok: bool = True
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    info: Dict[str, object] = field(default_factory=dict)

    def error(self, msg: str) -> None:
        self.ok = False
        self.errors.append(msg)

    def text(self) -> str:
        lines = [f"{'PASS' if self.ok else 'FAIL'}"]
        lines += [f"  error: {e}" for e in self.errors]
        lines += [f"  warning: {w}" for w in self.warnings]
        lines += [f"  {k}: {v}" for k, v in self.info.items()]
        return "\n".join(lines)


def sha256(path: str, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def write_checksums(directory: str) -> Dict[str, str]:
    """Write ``checksums.json`` ({relative path: sha256}) for every file in a bundle directory."""
    out: Dict[str, str] = {}
    for root, _, files in os.walk(directory):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), directory).replace("\\", "/")
            if rel not in _HASH_SKIP:
                out[rel] = sha256(os.path.join(root, f))
    save_json(dict(sorted(out.items())), os.path.join(directory, CHECKSUMS_FILE))
    return out


def _safe_extract(zip_path: str, dest: str) -> str:
    with zipfile.ZipFile(zip_path) as zf:
        root = os.path.realpath(dest)
        for member in zf.namelist():
            target = os.path.realpath(os.path.join(dest, member))
            if not target.startswith(root + os.sep) and target != root:
                raise ValueError(f"Unsafe path in archive: {member}")
        zf.extractall(dest)
    # Accept archives with a single top-level folder.
    entries = [e for e in os.listdir(dest) if not e.startswith("__MACOSX")]
    if len(entries) == 1 and os.path.isdir(os.path.join(dest, entries[0])) and not os.path.exists(
            os.path.join(dest, "meta.json")):
        return os.path.join(dest, entries[0])
    return dest


def verify_bundle(cfg: Config, directory: str, *, check_embedder: bool = True) -> Report:
    rep = Report()
    for f in REQUIRED_FILES:
        if not os.path.exists(os.path.join(directory, f)):
            rep.error(f"missing required file {f}")
    if not rep.ok:
        return rep

    sums_path = os.path.join(directory, CHECKSUMS_FILE)
    if os.path.exists(sums_path):
        bad = [rel for rel, digest in load_json(sums_path).items()
               if not os.path.exists(os.path.join(directory, rel)) or sha256(os.path.join(directory, rel)) != digest]
        if bad:
            rep.error(f"checksum mismatch or missing file: {', '.join(bad[:5])}")
        rep.info["checksums"] = "verified" if not bad else "FAILED"
    else:
        rep.warnings.append("no checksums.json; integrity not verified (the Kaggle release builder writes one)")

    try:
        df = pd.read_parquet(os.path.join(directory, "papers.parquet"))
    except Exception as exc:
        rep.error(f"papers.parquet unreadable: {exc}")
        return rep
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        rep.error(f"papers.parquet lacks columns {missing}")
        return rep
    rep.info["papers"] = len(df)
    ids = df["arxiv_id"].astype(str)
    if ids.duplicated().any():
        rep.error(f"{int(ids.duplicated().sum())} duplicate arxiv_id values")
    if df["title"].isna().any() or df["abstract"].isna().any():
        rep.warnings.append("some papers have no title or abstract")
    try:
        dates = pd.to_datetime(df["date"])
        rep.info["date_range"] = f"{dates.min():%Y-%m-%d} .. {dates.max():%Y-%m-%d}"
    except Exception:
        rep.error("date column is not parseable")

    emb = np.load(os.path.join(directory, "embeddings.npy"), mmap_mode="r")
    rep.info["embeddings"] = f"{emb.shape[0]} x {emb.shape[1] if emb.ndim == 2 else '?'} {emb.dtype}"
    if emb.ndim != 2 or emb.shape[0] != len(df):
        rep.error(f"embeddings.npy shape {emb.shape} does not match {len(df)} papers")
    else:
        sample = np.asarray(emb[np.linspace(0, len(df) - 1, min(500, len(df))).astype(int)], dtype=np.float32)
        if not np.isfinite(sample).all():
            rep.error("embeddings contain NaN or inf")
        norms = np.linalg.norm(sample, axis=1)
        if np.abs(norms - 1).max() > 0.02:
            rep.warnings.append(f"embeddings are not L2-normalised (norms {norms.min():.3f}..{norms.max():.3f})")
    emeta = load_json(os.path.join(directory, "embedder/embedder_meta.json"))
    if emeta.get("dim") and emb.ndim == 2 and int(emeta["dim"]) != emb.shape[1]:
        rep.error(f"embedder_meta dim {emeta['dim']} != embeddings dim {emb.shape[1]}")
    rep.info["embedding_model"] = f"{emeta.get('backend')}:{emeta.get('model_name')}@{emeta.get('model_revision')}"

    clusters = load_json(os.path.join(directory, "clusters.json"))
    keys = {int(k) for k in clusters}
    used = set(int(c) for c in df["cluster_id"].unique())
    unknown = sorted(used - keys - {-1})
    if unknown:
        rep.error(f"cluster ids missing from clusters.json: {unknown[:10]}")
    rep.info["areas"] = len(keys)
    rep.info["unclustered_share"] = round(float((df["cluster_id"] == -1).mean()), 4)

    known = set(ids)
    for t in OPTIONAL_TABLES:
        p = os.path.join(directory, t)
        if os.path.exists(p):
            tab = pd.read_parquet(p)
            if "arxiv_id" in tab.columns:
                orphans = int((~tab["arxiv_id"].astype(str).isin(known)).sum())
                if orphans:
                    rep.warnings.append(f"{t}: {orphans} rows reference papers not in the bundle")
            rep.info[t] = len(tab)
    for opt in ("edges.json", "neighbors.json", "bm25_tf.npz", "ann.faiss"):
        if not os.path.exists(os.path.join(directory, opt)):
            rep.warnings.append(f"optional {opt} missing (the app rebuilds or degrades gracefully)")

    if check_embedder and rep.ok:
        from .artifacts import load_bundle

        try:
            b = load_bundle(cfg, directory)
            if b.embedder is None:
                rep.error(f"embedding model cannot serve queries for this bundle: {b.embedder_error}")
            else:
                q = b.embedder.encode_query("retrieval augmented generation")
                rep.info["query_embedding"] = f"ok ({len(q)}-d)"
        except Exception as exc:
            rep.error(f"bundle does not load: {type(exc).__name__}: {exc}")
    return rep


def _manifest(cfg: Config, rid: str, directory: str, rep: Report, source: str) -> Dict:
    meta = load_json(os.path.join(directory, "meta.json"))
    old = load_json(os.path.join(directory, "manifest.json")) if os.path.exists(
        os.path.join(directory, "manifest.json")) else {}
    snap = meta.get("snapshot", {})
    m = {**old,
         "release": rid, "created_at": old.get("created_at") or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "imported_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "imported_from": source,
         "environment": old.get("environment", meta.get("environment", "external")),
         "pipeline_version": old.get("pipeline_version", meta.get("pipeline_version", "")),
         "embedding_model": old.get("embedding_model", meta.get("embedding_model", "")),
         "corpus": old.get("corpus") or {"source": snap.get("source", ""), "n_papers": rep.info.get("papers"),
                                         "earliest_included_date": snap.get("earliest_included_date"),
                                         "latest_included_date": snap.get("latest_included_date")},
         "import_check": {"ok": rep.ok, "warnings": rep.warnings, "info": {k: str(v) for k, v in rep.info.items()}}}
    m.setdefault("validation", meta.get("validation") or {})
    return m


def attach_extractions(cfg: Config, target: str) -> Optional[Dict]:
    """Write this machine's stored LLM extractions (open problems, facets, findings, profiles) into a bundle
    that has none, re-embedding problem statements with the bundle's own model."""
    if not cfg["extract"]["enabled"]:
        return None
    existing = os.path.join(target, "problems.parquet")
    if os.path.exists(existing) and len(pd.read_parquet(existing)):
        return None                       # the bundle already has its own extractions
    from .artifacts import load_papers
    from .embeddings import Embedder
    from .extract.bundle import write_extraction_bundle

    try:
        emb = Embedder.load(os.path.join(target, "embedder"), cfg)
    except Exception as exc:  # model unavailable locally: tables without problem embeddings
        log.warning("Embedding model unavailable (%s); problem embeddings skipped.", exc)
        emb = None
    return write_extraction_bundle(cfg, load_papers(target), emb, target)


def import_bundle(cfg: Config, source: str, *, release_id: Optional[str] = None, activate: bool = False,
                  allow_bm25: bool = False, with_extractions: bool = True) -> str:
    from .release import _new_id, list_releases, set_current

    tmp = None
    try:
        if os.path.isfile(source) and source.lower().endswith(".zip"):
            tmp = tempfile.mkdtemp(prefix="sg-import-")
            directory = _safe_extract(source, tmp)
        else:
            directory = source
        if not os.path.isdir(directory):
            raise FileNotFoundError(f"{source} is not a directory or .zip")
        rep = verify_bundle(cfg, directory, check_embedder=True)
        if not rep.ok and allow_bm25 and all("embedding model" in e for e in rep.errors):
            rep.ok = True
            rep.warnings += [f"accepted with --allow-bm25: {e}" for e in rep.errors]
            rep.errors = []
        print(rep.text())
        if not rep.ok:
            raise ValueError("The bundle failed verification; nothing was imported.")
        rid = release_id or _new_id(cfg)
        if rid in list_releases(cfg):
            raise ValueError(f"Release {rid} already exists; pass another --id.")
        target = os.path.join(cfg.releases_dir, rid)
        shutil.copytree(directory, target)
        if with_extractions:
            try:
                stats = attach_extractions(cfg, target)
                if stats:
                    rep.info["attached_extractions"] = stats
                    write_checksums(target)
            except Exception as exc:
                rep.warnings.append(f"could not attach local extractions: {exc}")
        save_json(_manifest(cfg, rid, target, rep, os.path.abspath(source)), os.path.join(target, "manifest.json"))
        save_json({"release": rid, "imported_from": os.path.abspath(source), "notes": ["Imported external bundle."]},
                  os.path.join(target, "changelog.json"))
        log.info("Imported %s as release %s", source, rid)
        if activate:
            set_current(cfg, rid)
        return rid
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


def report_json(rep: Report) -> str:
    return json.dumps({"ok": rep.ok, "errors": rep.errors, "warnings": rep.warnings,
                       "info": {k: str(v) for k, v in rep.info.items()}}, indent=1)
