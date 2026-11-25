"""Road IDs that changed between data releases (plan 11.81).

A road's ID comes from the OSM nodes at its two ends, so when a rebuild joins,
splits or trims a road (new road rules, OSM edits), its ID changes. Old links,
reviews, flags and spots would then point at nothing. Each release records
where every vanished road went: the new road that shares the most of its OSM
ways. The site redirects old links with this (moved.json), and the database
moves members' data across (supabase road_moves).
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Iterable

# The new road must hold at least this share of the old road's OSM ways.
MIN_SHARE = 0.3


def find_moves(old: dict[str, list[int]], new: dict[str, list[int]], min_share: float = MIN_SHARE) -> dict[str, str]:
    """For each old road ID missing from `new`, the new road sharing the most of its ways."""
    by_way: dict[int, list[str]] = {}
    for rid, ways in new.items():
        for w in set(ways):
            by_way.setdefault(w, []).append(rid)
    out: dict[str, str] = {}
    for rid, ways in old.items():
        if rid in new:
            continue
        mine = set(ways)
        if not mine:
            continue
        votes: Counter[str] = Counter()
        for w in mine:
            for n in by_way.get(w, ()):
                votes[n] += 1
        if not votes:
            continue
        best, shared = max(votes.items(), key=lambda kv: (kv[1], kv[0]))
        if shared / len(mine) >= min_share:
            out[rid] = best
    return out


def merge_moves(earlier: dict[str, str], found: dict[str, str], live: set[str]) -> dict[str, str]:
    """Earlier moves plus new ones, each followed to a road that exists now. Moves that lead nowhere are dropped."""
    merged = {**earlier, **found}
    out: dict[str, str] = {}
    for a, b in merged.items():
        if a in live:
            continue
        hops = 0
        while b not in live and b in merged and hops < 20:
            b = merged[b]
            hops += 1
        if b in live:
            out[a] = b
    return out


def ways_of(cell_files: Iterable[Path], skip: set[str] | None = None) -> dict[str, list[int]]:
    """Road ID -> OSM way IDs from road square files (leaving out IDs in `skip`)."""
    out: dict[str, list[int]] = {}
    for f in cell_files:
        if f.name.startswith("names-"):
            continue
        for r in json.loads(f.read_text(encoding="utf-8"))["roads"]:
            if skip is None or r["id"] not in skip:
                out[r["id"]] = r.get("osm_way_ids") or []
    return out
