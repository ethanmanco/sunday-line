"""Measure reference race tracks and famous roads with the driving model.

    python -m pipeline.reference

Prints each course's metrics and the track averages that set the Twisty scale
(copy those into scoring.toml [drive.reference] when they change).
"""
from __future__ import annotations

import json
import time
import tomllib
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer

from . import drive
from .build import parse_maxspeed, utm_epsg
from .chains import build_chains
from .config import DATA_DIR, load_scoring
from .fetch import USER_AGENT

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass

OVERPASS = "https://overpass-api.de/api/interpreter"
CACHE = DATA_DIR / "raw" / "reference"


def overpass(query: str, key: str) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request(OVERPASS, data=data, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = resp.read().decode("utf-8")
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504) or attempt == 5:
                raise
            time.sleep(10 * (attempt + 1))
    path.write_text(body, encoding="utf-8")
    time.sleep(2)  # be gentle with the public server
    return json.loads(body)


def slug(name: str) -> str:
    return "".join(c.lower() if c.isalnum() else "-" for c in name).strip("-")[:40]


def projector(lon, lat):
    t = Transformer.from_crs(4326, utm_epsg(lon, lat), always_xy=True)

    def proj(lonlat):
        x, y = t.transform(lonlat[:, 0], lonlat[:, 1])
        return np.column_stack([x, y])

    return proj


def track_line(name: str, bbox) -> np.ndarray | None:
    s, w, n, e = bbox
    q = f'[out:json][timeout:60];way["highway"="raceway"]({s},{w},{n},{e});out geom;'
    res = overpass(q, "track-" + slug(name))
    lines = [
        shapely.LineString([(p["lon"], p["lat"]) for p in el["geometry"]])
        for el in res["elements"]
        if el["type"] == "way" and len(el.get("geometry", [])) >= 2
    ]
    if not lines:
        return None
    # The outer edge of all the loops is the full course; pit lanes and karting
    # loops fall inside it or form separate, smaller shapes.
    faces = shapely.get_parts(shapely.polygonize(shapely.get_parts(shapely.union_all(lines))))
    if len(faces) == 0:
        return None
    outline = shapely.union_all(faces)
    polys = shapely.get_parts(outline)
    biggest = max(polys, key=lambda p: p.area)
    return np.array(biggest.exterior.coords)


def road_line(item) -> tuple[np.ndarray, list] | None:
    s, w, n, e = item["bbox"]
    q = f'[out:json][timeout:60];way["highway"]["ref"="{item["ref"]}"]({s},{w},{n},{e});out geom;'
    res = overpass(q, "road-" + slug(item["name"]))
    ways = {}
    for el in res["elements"]:
        if el["type"] != "way" or len(el.get("geometry", [])) < 2:
            continue
        ways[el["id"]] = {
            "highway": el["tags"].get("highway"),
            "nodes": np.array(el["nodes"]),
            "lonlat": np.array([(p["lon"], p["lat"]) for p in el["geometry"]]),
            "tags": el["tags"],
        }
    if not ways:
        return None
    chains = build_chains(ways, lambda wid: ways[wid]["lonlat"])
    best = max(chains, key=lambda c: len(c.nodes))
    return best, ways


def main():
    cfg = load_scoring()
    refs = tomllib.loads((Path(__file__).parent / "references.toml").read_text(encoding="utf-8"))
    cand, bands, dcfg = cfg["candidate"], cfg["curvature"]["bands"], cfg["drive"]
    cap = refs["track_speed_cap_mph"] * drive.MPH
    track_metrics = []
    print(f"Tracks, driven with a {refs['track_speed_cap_mph']} mph cap:")
    for t in refs["track"]:
        ll = track_line(t["name"], t["bbox"])
        if ll is None:
            print(f"  {t['name']}: no geometry")
            continue
        xy = projector(*ll[0])(ll)
        m = drive.analyze(xy, lambda d: np.full(len(d), cap), cand, bands, dcfg)
        track_metrics.append(m)
        print(f"  {t['name']}: {fmt(m)}")
    keys = ("mean_lat_g", "braking_ms_per_km", "transitions_per_km")
    ref = {k: float(np.mean([m[k] for m in track_metrics])) for k in keys}
    print("Track averages (Twisty 100):", {k: round(v, 3) for k, v in ref.items()})
    cfg["drive"]["reference"] = ref
    print("Roads, driven at their posted limits:")
    for r in refs["road"]:
        out = road_line(r)
        if out is None:
            print(f"  {r['name']}: no geometry")
            continue
        chain, ways = out
        xy = projector(*chain.lonlat[0])(chain.lonlat)
        cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])
        seg_limit = []
        for wid in chain.seg_way:
            v = parse_maxspeed(ways[int(wid)]["tags"].get("maxspeed"), True)
            seg_limit.append(min(v) if v else r["default_mph"])
        seg_limit = np.array(seg_limit) * drive.MPH

        def limit_at(d, cum=cum, seg_limit=seg_limit):
            i = np.clip(np.searchsorted(cum, d, side="right") - 1, 0, len(seg_limit) - 1)
            return seg_limit[i]

        m = drive.analyze(xy, limit_at, cand, bands, dcfg)
        sc = drive.scores(m, cfg["drive"])
        print(f"  {r['name']} ({m['length_m'] / 1609:.1f} mi): {fmt(m)} -> Twisty {sc['twisty']:.0f}, Speed {sc['speed']:.0f}")
    return ref


def fmt(m):
    return (
        f"{m['length_m'] / 1000:.1f} km, avg lateral {m['mean_lat_g']:.3f} g, "
        f"hard-cornering {m['hard_share'] * 100:.0f}% of time, braking {m['braking_ms_per_km']:.1f} m/s per km, "
        f"esses {m['transitions_per_km']:.2f}/km, avg {m['avg_speed_ms'] / drive.MPH:.0f} mph"
    )


if __name__ == "__main__":
    main()
