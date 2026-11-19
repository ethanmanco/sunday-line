"""Write the road data the web app reads.

    python -m pipeline export --region shreveport

Writes data/out/<region>/export.json (then `python -m pipeline tiles` builds public/data/us): every candidate at least 3 km long,
with scores, labels, a simplified line (Google polyline encoding, 5 digits),
and a short elevation profile. This file is a derived database of
OpenStreetMap and is published under the ODbL (see the about page).
"""
from __future__ import annotations

import json
from datetime import date

import numpy as np
import shapely

from .config import Region
from .report import DEFAULT_MIN_LENGTH_M, speed_text, surface_text

FT = 3.28084


def ft(m):
    return None if m is None else round(m * FT)
PROFILE_POINTS = 48


def encode_polyline(coords) -> str:
    """Google's encoded polyline algorithm (precision 5), lat then lon."""
    out, prev = [], (0, 0)
    for lon, lat in coords:
        cur = (round(lat * 1e5), round(lon * 1e5))
        for v, p in zip(cur, prev):
            d = v - p
            d = ~(d << 1) if d < 0 else d << 1
            while d >= 0x20:
                out.append(chr((0x20 | (d & 0x1F)) + 63))
                d >>= 5
            out.append(chr(d + 63))
        prev = cur
    return "".join(out)


def category(p: dict) -> str:
    if p["drivers_road"]:
        return "drivers"
    if p.get("gravel_road"):
        return "gravel"
    # "Needs a check": the only reasons it's out are things a quick look would settle.
    if p["not_drivers_road_because"] and all("needs a check" in r for r in p["not_drivers_road_because"]):
        return "unsure"
    return "other"


def profile_ft(prof: list) -> list[int]:
    if not prof or len(prof) < 2:
        return []
    d = np.array([x for x, _ in prof], float)
    e = np.array([y for _, y in prof], float)
    xs = np.linspace(0, d[-1], PROFILE_POINTS)
    return [int(round(v * FT)) for v in np.interp(xs, d, e)]


def export(region: Region) -> None:
    fc = json.loads((region.out_dir / "candidates.geojson").read_text(encoding="utf-8"))
    imperial = region.units == "imperial"
    roads = []
    for f in fc["features"]:
        p = f["properties"]
        if p["length_m"] < DEFAULT_MIN_LENGTH_M:
            continue
        line = shapely.LineString(f["geometry"]["coordinates"]).simplify(0.00006)
        coords = list(line.coords)
        sc = p.get("scenery") or {}
        stops = p.get("interruptions") or {}
        roads.append({
            "id": p["id"],
            "name": p["name"],
            "ref": p.get("ref"),
            "near": p.get("near"),
            "state": p.get("state"),
            "status": p.get("status", "candidate"),
            "category": category(p),
            "excluded": p["not_drivers_road_because"],
            "checked": p.get("checked"),
            "length_m": p["length_m"],
            "scores": {k: p[f"score_{k}"] for k in
                       ("overall", "twisty", "speed", "pavement", "flow", "elevation", "scenic", "surface", "quiet")},
            "speed": {"min": p["speed_min"], "max": p["speed_max"], "units": p["speed_units"],
                      "source": p["speed_source"], "text": speed_text(p), "note": p.get("speed_default_note")},
            "surface": {"text": surface_text(p), "paved": p["paved"], "gravel": bool(p.get("gravel_road"))},
            "pavement": {"why": p.get("pavement_why"), "maintained_by": p.get("maintained_by"),
                         "traffic_aadt": p.get("traffic_aadt"), "iri": p.get("iri")},
            "elevation": {"climb_ft": ft(p.get("climb_m")), "descent_ft": ft(p.get("descent_m")),
                          "min_ft": ft(p.get("elev_min_m")), "max_ft": ft(p.get("elev_max_m")),
                          "profile_ft": profile_ft(p.get("elev_profile"))},
            **({"bins": p["drive_bins"]} if p.get("drive_bins") else {}),
            "scenery": {"forest": sc.get("forest", 0), "water": sc.get("water", 0),
                        "wetland": sc.get("wetland", 0), "byway": sc.get("byway"),
                        "tags": p.get("scenery_tags") or []},
            "stops": {"junctions": stops.get("junctions", 0), "stops": stops.get("stops", 0),
                      "signals": stops.get("signals", 0)},
            "start": [round(coords[0][0], 5), round(coords[0][1], 5)],
            "end": [round(coords[-1][0], 5), round(coords[-1][1], 5)],
            "bbox": [round(v, 5) for v in line.bounds],
            "line": encode_polyline(coords),
            "osm_way_ids": p.get("osm_way_ids") or [],
        })
        if "home_mi" in p:
            roads[-1]["home_mi"] = p["home_mi"]
    roads.sort(key=lambda r: -r["scores"]["overall"])
    info = {"slug": region.slug, "name": region.name, "units": region.units, "bbox": list(region.bbox), "area": region.area}
    if region.home:
        info.update(home=list(region.home), home_name=region.home_name, local_radius_mi=region.local_radius_mi)
    out = {
        "region": info,
        "scoring_version": fc["features"][0]["properties"].get("scoring_version") if fc["features"] else None,
        "generated": date.today().isoformat(),
        "license": "Derived from OpenStreetMap. Database: ODbL 1.0. (c) OpenStreetMap contributors.",
        "roads": roads,
    }
    dest = region.out_dir / "export.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    kinds = {}
    for r in roads:
        kinds[r["category"]] = kinds.get(r["category"], 0) + 1
    print(f"wrote {len(roads)} roads ({kinds}) to {dest} ({dest.stat().st_size / 1e6:.1f} MB)")
