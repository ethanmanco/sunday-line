"""Print and save the top candidate roads for a region."""
from __future__ import annotations

import json
import re
from collections import Counter

from .config import Region, load_scoring

DEFAULT_MIN_LENGTH_M = 3000  # matches the app's default minimum-length filter

WEIGHT_SETS = {
    "Recommended: Twisty and Speed combined, plus Pavement": dict(combine="geometric", twisty=28, speed=28, pavement=16, flow=12, elevation=10, quiet=4, scenic=2),
    "Same weights, simply added": dict(twisty=28, speed=28, pavement=16, flow=12, elevation=10, quiet=4, scenic=2),
    "Pavement first (combined)": dict(combine="geometric", twisty=25, speed=25, pavement=30, flow=10, elevation=10),
    "Track purist (combined)": dict(combine="geometric", twisty=35, speed=35, pavement=10, flow=10, elevation=10),
}


def speed_text(r: dict) -> str:
    u = r["speed_units"]
    lo, hi = r["speed_min"], r["speed_max"]
    if lo is None:
        return "unknown"
    base = f"{lo} {u}" if lo == hi else f"{lo} to {hi} {u}"
    return {
        "posted": f"{base} posted",
        "partly_default": f"{base} (part posted, part state default)",
        "state_default": f"{base} state default",
        "partly_estimated": f"{base} (part posted, part estimated from similar roads)",
        "estimated": f"about {base} (estimated from similar roads)",
    }.get(r["speed_source"], base)


def surface_text(r: dict) -> str:
    if r.get("surface_check"):
        return r["surface_check"]
    if r["surface"] == "paved":
        return "paved (tagged)"
    p = r.get("surface_p_unpaved")
    if p is None:
        return "not tagged, no clear photo"
    return f"looks paved in photos ({1 - p:.0%})"


def length_text(r: dict, imperial: bool) -> str:
    if imperial:
        return f"{r['length_m'] / 1609.344:.1f} mi"
    return f"{r['length_m'] / 1000:.1f} km"


def maplink(r: dict) -> str:
    lon, lat = r["mid"]
    return f"[map](https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=13/{lat}/{lon})"


def drivers_table(rows: list[dict], imperial: bool) -> str:
    lines = [
        "| # | Road | Near | Length | Overall | Twisty | Speed | Pavement | Flow | Elev | Speed limit | Surface | Map |",
        "|---|------|------|--------|---------|--------|-------|------|------|--------|-------------|---------|-----|",
    ]
    for i, r in enumerate(rows, 1):
        lines.append(
            f"| {i} | {r['name']} | {r['near'] or ''} | {length_text(r, imperial)} | "
            f"**{r['score_overall']}** | {r['score_twisty']} | {r['score_speed']} | {r['score_pavement']} | "
            f"{r['score_flow']} | {r['score_elevation']} | {speed_text(r)} | {surface_text(r)} | {maplink(r)} |"
        )
    return "\n".join(lines)


def scenic_table(rows: list[dict], imperial: bool) -> str:
    lines = [
        "| # | Road | Near | Length | Scenic | Forest | Water | Overall | Speed limit | Map |",
        "|---|------|------|--------|--------|--------|-------|---------|-------------|-----|",
    ]
    for i, r in enumerate(rows, 1):
        sc = r["scenery"]
        lines.append(
            f"| {i} | {r['name']} | {r['near'] or ''} | {length_text(r, imperial)} | **{r['score_scenic']}** | "
            f"{sc['forest'] * 100:.0f}% | {max(sc['water'], sc['wetland'] * 0.5) * 100:.0f}% | "
            f"{r['score_overall']} | {speed_text(r)} | {maplink(r)} |"
        )
    return "\n".join(lines)


def gravel_table(rows: list[dict], imperial: bool) -> str:
    lines = [
        "| # | Road | Near | Length | Twisty | Flow | How we know it's gravel | Map |",
        "|---|------|------|--------|--------|------|-------------------------|-----|",
    ]
    for i, r in enumerate(rows, 1):
        if r["surface"] == "unpaved":
            how = "tagged in OpenStreetMap"
        else:
            how = f"aerial photos ({(r.get('surface_p_unpaved') or 0):.0%} sure)"
        lines.append(
            f"| {i} | {r['name']} | {r['near'] or ''} | {length_text(r, imperial)} | {r['score_twisty']} | "
            f"{r['score_flow']} | {how} | {maplink(r)} |"
        )
    return "\n".join(lines)


def rescore(r: dict, w: dict) -> float:
    from .build import overall_score
    f = {k: r[f"score_{k}"] for k in ("twisty", "speed", "scenic", "flow", "elevation", "quiet", "surface", "pavement")}
    return overall_score(f, w)


def report(region: Region, top: int = 20) -> str:
    cfg = load_scoring()
    path = region.out_dir / "candidates.geojson"
    fc = json.loads(path.read_text(encoding="utf-8"))
    roads = [f["properties"] for f in fc["features"]]
    imperial = region.units == "imperial"
    total = len(roads)
    long_enough = [r for r in roads if r["length_m"] >= DEFAULT_MIN_LENGTH_M]
    drivers = sorted((r for r in long_enough if r["drivers_road"]), key=lambda r: -r["score_overall"])
    scenic = sorted(long_enough, key=lambda r: (-r["score_scenic"], -r["score_overall"]))
    local = [r for r in drivers if r.get("home_mi") is not None and r["home_mi"] <= region.local_radius_mi]
    gravel = sorted((r for r in long_enough if r.get("gravel_road") and r.get("checked") != "rough"),
                    key=lambda r: -(r["score_twisty"] + r["score_flow"] / 3))
    cat = cfg["categories"]
    unit = "mph" if imperial else "km/h"
    left_out = len(long_enough) - len(drivers)
    reasons = Counter(
        re.sub(r" \(.*\)$", "", w) for r in long_enough for w in r["not_drivers_road_because"]
    )

    alt = []
    first = next(iter(WEIGHT_SETS.values()))
    base_ids = [r["id"] for r in sorted(drivers, key=lambda r: -rescore(r, first))[:top]]
    for name, w in WEIGHT_SETS.items():
        ranked = sorted(drivers, key=lambda r: -rescore(r, w))[:top]
        same = len(set(base_ids) & {r["id"] for r in ranked})
        top5 = ", ".join(f"{r['name']} ({rescore(r, w):.0f})" for r in ranked[:5])
        wtxt = " / ".join(f"{k} {v}" for k, v in w.items() if v and k != "combine")
        alt.append(f"- **{name}** ({wtxt}): {same} of {top} same roads as the recommended list. Top 5: {top5}")

    md = (
        f"# Top candidate roads: {region.name}\n\n"
        f"Scoring version {cfg['version']}. Map data © OpenStreetMap contributors. "
        f"Land cover © ESA WorldCover 2021 (CC BY 4.0). Elevation: USGS 3DEP. Aerial photos: USDA NAIP.\n\n"
        f"{total} candidates found; {len(long_enough)} are at least 1.9 mi (3 km), the app's default minimum. "
        f"**Driver's roads** must be paved, have a speed limit of at least {cat['min_speed']} {unit} on "
        f"{cat['min_speed_share'] * 100:.0f}% of their length, not run through a neighborhood, and not sit inside "
        f"a park, fee area, or off-road park; {left_out} long-enough candidates are left out of that list.\n\n"
        f"## Driver's roads: top {top}\n\n{drivers_table(drivers[:top], imperial)}\n\n"
        + (f"## Local: driver's roads within {region.local_radius_mi:.0f} miles of {region.home_name}\n\n"
           f"{drivers_table(local[:10], imperial)}\n\n" if region.home else "")
        + f"## Most scenic (any speed)\n\n{scenic_table(scenic[:10], imperial)}\n\n"
        f"## Gravel / rally (off by default in the app)\n\n{gravel_table(gravel[:10], imperial)}\n\n"
        f"## Why candidates were left out of Driver's roads\n\n"
        + "\n".join(f"- {why}: {n}" for why, n in reasons.most_common())
        + "\n\n## Other weightings, for comparison\n\n" + "\n".join(alt) + "\n"
    )
    (region.out_dir / "top.md").write_text(md, encoding="utf-8")
    print(md)
    return md
