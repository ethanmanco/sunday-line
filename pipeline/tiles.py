"""Combine every processed state into the files the web app reads.

    python -m pipeline tiles

Reads data/out/<region>/export.json for every region that has one and writes
public/data/us/:

  index.json        which 1-degree squares have roads, plus the data's extent
  top.json          the top 2 roads per square, light (whole-country view)
  blocks/<lat>_<lon>.json  the top roads per square in each 5-degree block, light (region view)
  cells/<lat>_<lon>.json   every road in that square, in full (zoomed in)
  road-cells.json   road ID -> square, so a shared road link finds its file

The app loads only the squares in view, so the whole country never has to
download at once. A road belongs to the square holding the middle of its
bounding box. Roads near state lines can appear in two state extracts; the
copy with the higher Overall score wins.
"""
from __future__ import annotations

import json
import math
from datetime import date
from pathlib import Path

from .config import DATA_DIR

REPO = Path(__file__).resolve().parents[1]
OUT = DATA_DIR / "out"
DEST = REPO / "public" / "data" / "us"

# Per square, the roads that show when zoomed out (region view, then whole country).
BLOCK = {"drivers": 6, "scenic": 1, "gravel": 1}
TOP = {"drivers": 2}
OVERVIEW_FIELDS = ("id", "name", "ref", "near", "state", "status", "category", "excluded", "length_m", "scores", "speed", "start", "end", "bbox")
# Fields that only made sense for one region.
DROP = ("home_mi",)


def cell_key(road: dict) -> str:
    w, s, e, n = road["bbox"]
    return f"{math.floor((s + n) / 2)}_{math.floor((w + e) / 2)}"


def _decode(line: str) -> list[tuple[float, float]]:
    out, i, lat, lon = [], 0, 0, 0
    while i < len(line):
        for k in range(2):
            shift = result = 0
            while True:
                b = ord(line[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if result & 1 else result >> 1
            if k == 0:
                lat += d
            else:
                lon += d
        out.append((lon / 1e5, lat / 1e5))
    return out


def _encode(coords: list[tuple[float, float]]) -> str:
    def enc(v: int) -> str:
        v = ~(v << 1) if v < 0 else v << 1
        s = ""
        while v >= 0x20:
            s += chr((0x20 | (v & 0x1F)) + 63)
            v >>= 5
        return s + chr(v + 63)

    out, plat, plon = "", 0, 0
    for lon, lat in coords:
        la, lo = round(lat * 1e5), round(lon * 1e5)
        out += enc(la - plat) + enc(lo - plon)
        plat, plon = la, lo
    return out


def _thin(coords: list[tuple[float, float]], keep: int = 12) -> list[tuple[float, float]]:
    """Every nth point (plus the ends): plenty for a zoomed-out map."""
    if len(coords) <= keep:
        return coords
    step = (len(coords) - 1) / (keep - 1)
    return [coords[round(i * step)] for i in range(keep)]


def _light(r: dict, key: str) -> dict:
    """A road with just what the map and the list need; the full road loads on tap."""
    light = {k: r[k] for k in OVERVIEW_FIELDS if k in r}
    sp = r.get("speed") or {}
    light["speed"] = {k: sp.get(k) for k in ("min", "max", "units", "source")}
    light["line"] = _encode(_thin(_decode(r["line"])))
    light["cell"] = key
    light["light"] = True
    return light


def _stretch_model() -> dict:
    """The constants the app needs to score a stretch of a road the same way
    the pipeline scores the whole road (docs/plan.md 11.26)."""
    from .config import load_scoring

    cfg = load_scoring()
    d = cfg["drive"]
    return {
        "reference": {k: d["reference"][k] for k in ("mean_lat_g", "braking_ms_per_km", "transitions_per_km")},
        "twisty_mix": {k: d["twisty_mix"][k] for k in ("cornering", "braking", "transitions")},
        "track_ratio_scale": d["track_ratio_scale"],
        "speed": {k: d["speed"][k] for k in ("zero_at_mph", "full_at_mph")},
        "elevation_scale": cfg["elevation"]["scale"],
        "overall": dict(cfg["overall"]),
    }


def low_overall(r: dict, min_overall: float) -> bool:
    """A driver's road scoring under the minimum Overall moves to All (11.35).
    Applied here too, so exports built before the rule follow it. A road a
    person checked as good stays."""
    return r["category"] == "drivers" and r["scores"]["overall"] < min_overall and r.get("checked") != "good"


def tiles() -> None:
    from .config import load_scoring

    min_overall = load_scoring()["categories"]["min_overall"]
    exports = sorted(OUT.glob("*/export.json"))
    if not exports:
        raise SystemExit("No data/out/<region>/export.json files yet. Run export for a region first.")
    best: dict[str, dict] = {}
    region_of: dict[str, str] = {}
    regions, scoring, licenses = [], set(), set()
    for f in exports:
        data = json.loads(f.read_text(encoding="utf-8"))
        regions.append(f.parent.name)
        scoring.add(data.get("scoring_version"))
        licenses.add(data.get("license", ""))
        for r in data["roads"]:
            for k in DROP:
                r.pop(k, None)
            if low_overall(r, min_overall):
                r["category"] = "other"
                r["excluded"] = [*r["excluded"], f"overall score under {min_overall}"]
            old = best.get(r["id"])
            if old is None or r["scores"]["overall"] > old["scores"]["overall"]:
                best[r["id"]] = r
                region_of[r["id"]] = f.parent.name

    cells: dict[str, list[dict]] = {}
    for r in best.values():
        cells.setdefault(cell_key(r), []).append(r)

    (DEST / "cells").mkdir(parents=True, exist_ok=True)
    for old in (DEST / "cells").glob("*.json"):
        old.unlink()
    blocks: dict[str, list[dict]] = {}
    top, road_cells, counts = [], {}, {}
    w = s = math.inf
    e = n = -math.inf
    for key, roads in sorted(cells.items()):
        roads.sort(key=lambda r: -r["scores"]["overall"])
        (DEST / "cells" / f"{key}.json").write_text(json.dumps({"roads": roads}, separators=(",", ":")), encoding="utf-8")
        counts[key] = len(roads)
        for r in roads:
            road_cells[r["id"]] = key
            bw, bs, be, bn = r["bbox"]
            w, s, e, n = min(w, bw), min(s, bs), max(e, be), max(n, bn)
        lat, lon = (int(x) for x in key.split("_"))
        block = f"{lat // 5 * 5}_{lon // 5 * 5}"
        taken: dict[str, int] = {}
        for r in roads:
            c = r["category"]
            if taken.get(c, 0) >= BLOCK.get(c, 0):
                continue
            light = _light(r, key)
            blocks.setdefault(block, []).append(light)
            if taken.get(c, 0) < TOP.get(c, 0):
                top.append(light)
            taken[c] = taken.get(c, 0) + 1

    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "blocks").mkdir(exist_ok=True)
    for old in (DEST / "blocks").glob("*.json"):
        old.unlink()
    for b, roads in blocks.items():
        (DEST / "blocks" / f"{b}.json").write_text(json.dumps({"roads": roads}, separators=(",", ":")), encoding="utf-8")
    (DEST / "top.json").write_text(json.dumps({"roads": top}, separators=(",", ":")), encoding="utf-8")
    old_overview = DEST / "overview.json"
    if old_overview.exists():
        old_overview.unlink()
    (DEST / "road-cells.json").write_text(json.dumps(road_cells, separators=(",", ":")), encoding="utf-8")
    _names(best, region_of, road_cells)
    index = {
        "version": 1,
        "generated": date.today().isoformat(),
        "scoring_version": sorted(v for v in scoring if v)[-1] if any(scoring) else None,
        "license": " ".join(sorted(x for x in licenses if x)),
        "units": "imperial",
        "regions": regions,
        "bbox": [round(w, 4), round(s, 4), round(e, 4), round(n, 4)],
        "roads": len(best),
        "cells": counts,
        "blocks": sorted(blocks),
        "stretch": _stretch_model(),
    }
    (DEST / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    size = sum(p.stat().st_size for p in DEST.rglob("*.json")) / 1e6
    print(f"{len(best)} roads in {len(cells)} squares from {len(regions)} region(s); top {len(top)}, blocks {len(blocks)}; {size:.1f} MB")


def _names(best: dict[str, dict], region_of: dict[str, str], road_cells: dict[str, str]) -> None:
    """Road names for the search box (11.79), one file per state next to the
    squares (published with them to GitHub Pages): [id, name, near, lng, lat,
    overall, square]. The app loads only the states it needs and searches on
    the device."""
    by: dict[str, list] = {}
    for rid, r in best.items():
        lng, lat = r["start"]
        by.setdefault(region_of[rid].upper(), []).append(
            [rid, r["name"], r.get("near") or "", round(lng, 4), round(lat, 4), r["scores"]["overall"], road_cells[rid]]
        )
    for st, rows in by.items():
        rows.sort(key=lambda x: -x[5])
        (DEST / "cells" / f"names-{st}.json").write_text(json.dumps({"roads": rows}, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    tiles()
