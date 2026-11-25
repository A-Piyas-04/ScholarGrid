"""External bundle verification and import (the Kaggle hand-off contract)."""
from __future__ import annotations

import json
import os
import shutil
import zipfile

import numpy as np
import pytest
from conftest import make_config

from scholargrid.release import current_release, list_releases
from scholargrid.release_import import import_bundle, verify_bundle, write_checksums
from scholargrid.runner import run


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("rel")
    cfg = make_config(tmp)
    run(cfg)
    return cfg, cfg.processed_dir


def _copy(src, dst):
    shutil.copytree(src, dst)
    return str(dst)


def test_verify_passes_and_checksums_detect_tampering(built, tmp_path):
    cfg, bundle = built
    d = _copy(bundle, tmp_path / "b")
    rep = verify_bundle(cfg, d)
    assert rep.ok, rep.errors
    sums = write_checksums(d)
    assert "papers.parquet" in sums and "embedder/embedder_meta.json" in sums
    assert verify_bundle(cfg, d).info["checksums"] == "verified"
    with open(os.path.join(d, "growth.json"), "a", encoding="utf-8") as fh:
        fh.write(" ")
    bad = verify_bundle(cfg, d, check_embedder=False)
    assert not bad.ok and any("checksum" in e for e in bad.errors)


def test_verify_catches_contract_breaks(built, tmp_path):
    cfg, bundle = built
    d = _copy(bundle, tmp_path / "b")
    emb = np.load(os.path.join(d, "embeddings.npy"))
    np.save(os.path.join(d, "embeddings.npy"), emb[:-3])
    rep = verify_bundle(cfg, d, check_embedder=False)
    assert not rep.ok and any("shape" in e for e in rep.errors)

    d2 = _copy(bundle, tmp_path / "c")
    with open(os.path.join(d2, "clusters.json"), encoding="utf-8") as fh:
        clusters = json.load(fh)
    clusters.pop(next(iter(clusters)))
    with open(os.path.join(d2, "clusters.json"), "w", encoding="utf-8") as fh:
        json.dump(clusters, fh)
    rep2 = verify_bundle(cfg, d2, check_embedder=False)
    assert not rep2.ok and any("cluster ids" in e for e in rep2.errors)

    d3 = _copy(bundle, tmp_path / "d")
    os.remove(os.path.join(d3, "sparse.json"))
    assert not verify_bundle(cfg, d3, check_embedder=False).ok


def test_import_from_zip_and_activate(built, tmp_path):
    cfg, bundle = built
    d = _copy(bundle, tmp_path / "kaggle_release")
    write_checksums(d)
    zpath = tmp_path / "release.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        for root, _, files in os.walk(d):
            for f in files:
                full = os.path.join(root, f)
                zf.write(full, os.path.join("kaggle_release", os.path.relpath(full, d)))
    rid = import_bundle(cfg, str(zpath), release_id="2099.01.01", activate=True)
    assert rid == "2099.01.01" and rid in list_releases(cfg) and current_release(cfg) == rid
    with open(os.path.join(cfg.releases_dir, rid, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    assert manifest["import_check"]["ok"] and manifest["release"] == rid
    assert os.path.exists(os.path.join(cfg.releases_dir, rid, "problems.parquet")) or not cfg["extract"]["enabled"]
    assert verify_bundle(cfg, os.path.join(cfg.releases_dir, rid), check_embedder=False).ok
    with pytest.raises(ValueError):
        import_bundle(cfg, str(zpath), release_id="2099.01.01")


def test_zip_with_path_traversal_is_rejected(built, tmp_path):
    cfg, _ = built
    zpath = tmp_path / "evil.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("../escape.txt", "x")
    with pytest.raises(ValueError):
        import_bundle(cfg, str(zpath))
