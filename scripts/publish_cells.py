"""Publish the road squares to the sunday-line-data repo (GitHub Pages).

    python scripts/publish_cells.py [--repo ../sunday-line-data] [--no-push]

The squares (public/data/us/cells, about 200 MB) are too big for Vercel's
static files, so the app loads them from GitHub Pages (docs/plan.md 11.31).
Run this after `python -m pipeline tiles`, then commit the small files left in
public/data/us (index.json, road-cells.json, top.json, blocks/) to this repo.

Each publish replaces the data repo's history with one commit, so the repo
stays about one copy of the data in size. Push as ethanmanco.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CELLS = REPO / "public" / "data" / "us" / "cells"


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "core.autocrlf=false", *args], cwd=repo, check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, default=REPO.parent / "sunday-line-data")
    ap.add_argument("--no-push", action="store_true")
    args = ap.parse_args()
    dest: Path = args.repo
    if not (dest / ".git").exists():
        print(f"{dest} is not a checkout of ethanmanco/sunday-line-data", file=sys.stderr)
        return 1
    files = sorted(CELLS.glob("*.json"))
    if not files:
        print(f"no squares in {CELLS}; run `python -m pipeline tiles` first", file=sys.stderr)
        return 1
    generated = json.loads((CELLS.parent / "index.json").read_text(encoding="utf-8")).get("generated") or dt.date.today().isoformat()

    out = dest / "cells"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    for f in files:
        shutil.copy2(f, out / f.name)
    (dest / ".nojekyll").touch()

    git(dest, "checkout", "-q", "--orphan", "publish")
    git(dest, "add", "-A")
    git(dest, "commit", "-q", "-m", f"Road squares ({len(files)} files, generated {generated})")
    git(dest, "branch", "-q", "-D", "main")
    git(dest, "branch", "-q", "-m", "main")
    size = sum(f.stat().st_size for f in files) / 1e6
    print(f"{len(files)} squares, {size:.0f} MB, committed in {dest}")
    if not args.no_push:
        git(dest, "push", "-q", "--force", "origin", "main")
        print("pushed; GitHub Pages updates in a minute or two")
    return 0


if __name__ == "__main__":
    sys.exit(main())
