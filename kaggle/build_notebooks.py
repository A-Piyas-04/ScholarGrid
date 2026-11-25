"""Turn the percent-format sources in kaggle/src/*.py into Kaggle-ready notebooks in kaggle/notebooks/*.ipynb.

    python kaggle/build_notebooks.py

Sources stay the single source of truth (they run as plain scripts for local smoke tests:
``SG_QUICK=1 python kaggle/src/02_embedding_comparison.py``). A ``#BOOT#`` line is replaced with the shared bootstrap
cell from ``kaggle/boot.txt``.
"""
from __future__ import annotations

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
OUT = os.path.join(HERE, "notebooks")


def cells_from(source: str):
    parts = re.split(r"(?m)^# %%(.*)$", source)
    cells = []
    head = parts[0].strip()
    if head:
        cells.append(("code", head))
    for marker, body in zip(parts[1::2], parts[2::2]):
        body = body.strip("\n")
        if "[markdown]" in marker:
            lines = [ln[2:] if ln.startswith("# ") else ln.lstrip("#") for ln in body.splitlines()]
            cells.append(("markdown", "\n".join(lines).strip()))
        elif body.strip():
            cells.append(("code", body.strip()))
    return cells


def to_ipynb(cells) -> dict:
    nb_cells = []
    for kind, text in cells:
        lines = text.splitlines(keepends=True)
        cell = {"cell_type": kind, "metadata": {}, "source": lines}
        if kind == "code":
            cell.update(execution_count=None, outputs=[])
        nb_cells.append(cell)
    return {"cells": nb_cells, "nbformat": 4, "nbformat_minor": 5,
            "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                         "language_info": {"name": "python"},
                         "kaggle": {"accelerator": "gpu", "isInternetEnabled": True}}}


def main() -> None:
    boot = open(os.path.join(HERE, "boot.txt"), encoding="utf-8").read().rstrip("\n")
    os.makedirs(OUT, exist_ok=True)
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".py"):
            continue
        path = os.path.join(SRC, name)
        text = open(path, encoding="utf-8").read()
        if "#BOOT#" in text:
            text = text.replace("#BOOT#", boot)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
        nb = to_ipynb(cells_from(text))
        out = os.path.join(OUT, name.replace(".py", ".ipynb"))
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(nb, fh, indent=1, ensure_ascii=False)
        print(f"{name} -> notebooks/{os.path.basename(out)} ({len(nb['cells'])} cells)")


if __name__ == "__main__":
    main()
