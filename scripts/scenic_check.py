"""Check the Scenic score against known scenic roads and dull areas (plan 11.65).

    python scripts/scenic_check.py [--cells ../sunday-line-data/cells] [--tune N]

Reads the published road squares, measures the roads on the check list
(pipeline/scenic_refs.toml) once (cached in <data>/scenic_cache.json), then
prints old and new scores for each entry. --tune N tries N random weight sets
near the ones in pipeline/scoring.toml and prints the best.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import tomllib
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from pipeline.config import DATA_DIR  # noqa: E402
from pipeline.scenic import DemTiles, LandTiles, combine, load_weights, measure, old_parts, parts_from  # noqa: E402

TUNABLE = ["w_forest", "w_water", "w_big_water", "w_terrain", "w_overlook", "w_open", "w_protected", "w_byway", "w_built", "view_built_share"]
SCENIC_TARGET, SCENIC_CEILING, DULL_TARGET = 75, 92, 20
# Each weight stays in a sensible range, so the tuner can't drop a part
# (lakes and rivers still count) or let one part make every road scenic.
BOUNDS = {"w_water": (0.2, 0.6), "view_built_share": (0.2, 0.6), "w_built": (0.3, 0.8),
          "w_forest": (0.45, 0.7), "w_open": (0.3, 0.6), "w_byway": (0.2, 0.5)}
DEFAULT_BOUNDS = (0.15, 0.85)
SAMPLE_SEED = 11


def inside(pt, bbox):
    return bbox[0] <= pt[0] <= bbox[2] and bbox[1] <= pt[1] <= bbox[3]


def load_sample(cells: Path, n: int):
    """A fixed random sample of roads from every square, for the overall spread."""
    rng = random.Random(SAMPLE_SEED)
    pool = []
    for f in sorted(cells.glob("*.json")):
        pool += json.loads(f.read_text(encoding="utf-8"))["roads"]
    pool = list({r["id"]: r for r in pool}.values())
    return rng.sample(pool, min(n, len(pool)))


def load_refs(cells: Path):
    refs = tomllib.loads((REPO / "pipeline" / "scenic_refs.toml").read_text(encoding="utf-8"))
    groups = {("scenic", r["label"]): [] for r in refs["scenic"]} | {("dull", d["label"]): [] for d in refs["dull"]}
    for f in sorted(cells.glob("*.json")):
        for road in json.loads(f.read_text(encoding="utf-8"))["roads"]:
            for r in refs["scenic"]:
                if r["name"] in road["name"] and inside(road["start"], r["bbox"]):
                    groups[("scenic", r["label"])].append(road)
            for d in refs["dull"]:
                if inside(road["start"], d["bbox"]):
                    groups[("dull", d["label"])].append(road)
    # The same road can sit in two squares.
    return {k: list({r["id"]: r for r in v}.values()) for k, v in groups.items()}


def scores(groups, raws, wt, sc1):
    out = {}
    for key, roads in groups.items():
        if not roads:
            continue
        new = np.array([combine({**old_parts(r, sc1), **parts_from(raws[r["id"]], wt)}, wt) for r in roads])
        old = np.array([r["scores"]["scenic"] for r in roads], dtype=float)
        ln = np.array([r["length_m"] for r in roads], dtype=float)
        out[key] = (len(roads), float((old * ln).sum() / ln.sum()), float((new * ln).sum() / ln.sum()), float(np.percentile(new, 90)))
    return out


def spread(sample, raws, wt, sc1):
    """Share of the sample at Scenic 50 and up (the Scenic list), old and new."""
    if not sample:
        return 0.0, 0.0
    new = np.array([combine({**old_parts(r, sc1), **parts_from(raws[r["id"]], wt)}, wt) for r in sample])
    old = np.array([r["scores"]["scenic"] for r in sample])
    return float((old >= 50).mean()), float((new >= 50).mean())


def loss(res, share=(0.0, 0.0)):
    total = 0.0
    for (kind, _), (_, _, mean, p90) in res.items():
        if kind == "scenic":
            total += max(0.0, SCENIC_TARGET - mean) ** 2 + max(0.0, mean - SCENIC_CEILING) ** 2
        else:
            total += max(0.0, mean - DULL_TARGET) ** 2 + 0.5 * max(0.0, p90 - 40) ** 2
    old, new = share
    # The Scenic list may grow a little, not balloon.
    total += 200000 * max(0.0, new - old - 0.06) ** 2
    return total / len(res)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cells", type=Path, default=REPO.parent / "sunday-line-data" / "cells")
    ap.add_argument("--tune", type=int, default=0)
    ap.add_argument("--sample", type=int, default=1500)
    args = ap.parse_args()
    wt = load_weights()
    sc1 = tomllib.loads((REPO / "pipeline" / "scoring.toml").read_text(encoding="utf-8"))["scenery"]

    groups = load_refs(args.cells)
    sample = load_sample(args.cells, args.sample)
    cache_path = DATA_DIR / "scenic_cache.json"
    raws = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    todo = list({r["id"]: r for r in [r for roads in groups.values() for r in roads] + sample if r["id"] not in raws}.values())
    if todo:
        dem, land = DemTiles(DATA_DIR / "raw" / "dem"), LandTiles(DATA_DIR / "raw" / "landcover")
        todo.sort(key=lambda r: (int(r["start"][1]), int(r["start"][0])))
        for i, r in enumerate(todo):
            raws[r["id"]] = measure(r["line"], dem, land, wt)
            if i % 200 == 0:
                print(f"measured {i}/{len(todo)}", flush=True)
        cache_path.write_text(json.dumps(raws))

    if args.tune:
        best, best_loss = dict(wt), loss(scores(groups, raws, wt, sc1), spread(sample, raws, wt, sc1))
        rng = random.Random(7)
        for _ in range(args.tune):
            trial = dict(best)
            for k in rng.sample(TUNABLE, 3):
                lo, hi = BOUNDS.get(k, DEFAULT_BOUNDS)
                trial[k] = round(min(hi, max(lo, trial[k] + rng.gauss(0, 0.08))), 2)
            l = loss(scores(groups, raws, trial, sc1), spread(sample, raws, trial, sc1))
            if l < best_loss:
                best, best_loss = trial, l
        print("best weights:", {k: best[k] for k in TUNABLE}, f"loss {best_loss:.1f}")
        wt = best

    res = scores(groups, raws, wt, sc1)
    share = spread(sample, raws, wt, sc1)
    print(f"\nloss {loss(res, share):.1f}; sample of {len(sample)} roads at Scenic 50+: old {share[0]:.0%}, new {share[1]:.0%}")
    for kind in ("scenic", "dull"):
        print(f"\n{kind.upper():40s} roads   old   new   new p90")
        for (k, label), (n, old, new, p90) in res.items():
            if k == kind:
                print(f"{label:40s} {n:5d} {old:5.0f} {new:5.0f} {p90:7.0f}")
    missing = [label for (k, label), roads in groups.items() if not roads]
    if missing:
        print("\nno roads matched:", ", ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
