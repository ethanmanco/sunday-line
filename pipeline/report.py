"""Print and save the top candidate roads for a region."""
from __future__ import annotations

import json

from .config import Region

DEFAULT_MIN_LENGTH_M = 3000  # matches the app's default minimum-length filter


def speed_text(r: dict) -> str:
    u = r["speed_units"]
    lo, hi = r["speed_min"], r["speed_max"]
    if lo is None:
        return "unknown"
    base = f"{lo} {u}" if lo == hi else f"{lo} to {hi} {u}"
    if r["speed_estimated"] == "all":
        return f"about {base} (estimated)"
    if r["speed_estimated"] == "partial":
        return f"{base} (partly estimated)"
    return f"{base} posted"


def length_text(r: dict, imperial: bool) -> str:
    if imperial:
        return f"{r['length_m'] / 1609.344:.1f} mi"
    return f"{r['length_m'] / 1000:.1f} km"


def table(rows: list[dict], imperial: bool) -> str:
    lines = [
        "| # | Road | Near | Length | Overall | Twisty | Scenic | Elev | Flow | Surface | Speed limit | Map |",
        "|---|------|------|--------|---------|--------|--------|------|------|---------|-------------|-----|",
    ]
    for i, r in enumerate(rows, 1):
        lon, lat = r["mid"]
        link = f"[map](https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=13/{lat}/{lon})"
        lines.append(
            f"| {i} | {r['name']} | {r['near'] or ''} | {length_text(r, imperial)} | "
            f"**{r['score_overall']}** | {r['score_twisty']} | {r['score_scenic']} | "
            f"{r['score_elevation']} | {r['score_flow']} | {r['surface']} | {speed_text(r)} | {link} |"
        )
    return "\n".join(lines)


def report(region: Region, top: int = 20) -> str:
    path = region.out_dir / "candidates.geojson"
    fc = json.loads(path.read_text(encoding="utf-8"))
    roads = [f["properties"] for f in fc["features"]]
    roads.sort(key=lambda r: -r["score_overall"])
    total = len(roads)
    roads = [r for r in roads if r["length_m"] >= DEFAULT_MIN_LENGTH_M]
    imperial = region.units == "imperial"
    near = [r for r in roads if r["home_km"] <= region.home_radius_km]
    md = (
        f"# Top candidate roads: {region.name}\n\n"
        f"{total} candidates found; {len(roads)} are at least 3 km (1.9 mi), the app's default "
        f"minimum length, and only those are ranked here. "
        f"Scoring version {roads[0]['scoring_version'] if roads else '-'}.\n"
        f"Map data © OpenStreetMap contributors.\n\n"
        f"## Top {top} in the region\n\n{table(roads[:top], imperial)}\n\n"
        f"## Top 10 within {region.home_radius_km:.0f} km of Shreveport\n\n{table(near[:10], imperial)}\n"
    )
    (region.out_dir / "top.md").write_text(md, encoding="utf-8")
    print(md)
    return md
