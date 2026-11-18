"""Find and score candidate roads for a region.

Writes data/out/<region>/candidates.geojson and candidates.csv.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import pickle
import re
import time
from collections import Counter

import numpy as np
import shapely
import shapely.prepared
from pyproj import Transformer
from shapely.strtree import STRtree

from . import geometry as g
from .chains import build_chains
from .config import DATA_DIR, Region, load_scoring
from .dem import Dem
from .landcover import Landcover
from . import drive
from .fetch import osm_paths
from .osm_read import read_extracts

KMH_PER_MPH = 1.609344


# ---------- helpers ----------------------------------------------------------

def utm_epsg(lon: float, lat: float) -> int:
    zone = int((lon + 180) // 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def parse_maxspeed(value: str | None, imperial: bool) -> list[float]:
    """Return posted speeds in the region's units. Bare numbers are km/h (OSM rule)."""
    if not value:
        return []
    out = []
    for part in value.split(";"):
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh|kph)?\s*$", part.strip(), re.I)
        if not m:
            continue
        v = float(m.group(1))
        mph = (m.group(2) or "").lower() == "mph"
        kmh = v * KMH_PER_MPH if mph else v
        out.append(round(kmh / KMH_PER_MPH) if imperial else round(kmh))
    return out


def surface_score(tags: dict, highway: str, cfg: dict) -> tuple[float, str]:
    s = tags.get("surface")
    if s is None:
        if highway == "unclassified":
            return cfg["untagged_minor"], "untagged"
        return cfg["untagged_major"], "untagged"
    if s in cfg["paved_values"]:
        return cfg["paved"], "paved"
    return cfg["unpaved"], "unpaved"


def quiet_score(tags: dict, highway: str, cfg: dict) -> float:
    v = cfg.get(highway, 50)
    try:
        if int(tags.get("lanes", "2").split(";")[0]) > 2:
            v -= cfg["more_than_two_lanes_penalty"]
    except ValueError:
        pass
    return float(v)


def is_numbered(tags: dict, sd: dict | None) -> bool:
    ref = tags.get("ref", "").split(";")[0].strip()
    return bool(sd and ref and re.match(sd.get("numbered_ref", r"^\S+ ?\d"), ref))


def overall_score(f: dict, ow: dict) -> float:
    """Weighted overall score.

    With combine = "geometric", Twisty and Speed share one weight through their
    geometric mean, so a road has to be good at both: a twisty road you must
    crawl through, or a fast road with no corners, can't coast on one of them.
    """
    if ow.get("combine") == "geometric":
        core = (ow["twisty"] + ow["speed"]) * float(np.sqrt(f["twisty"] * f["speed"]))
    else:
        core = ow["twisty"] * f["twisty"] + ow["speed"] * f["speed"]
    rest = sum(ow[k] * f[k] for k in ("scenic", "flow", "elevation", "quiet", "surface"))
    return (core + rest) / sum(ow[k] for k in ("twisty", "speed", "scenic", "flow", "elevation", "quiet", "surface"))


def default_limit(tags: dict, highway: str, sd: dict | None, state: str | None,
                  typical: dict, region: Region) -> tuple[float, str]:
    """Best guess for a road with no posted limit in OpenStreetMap.

    Numbered state and US routes: the limit most similar routes in the same
    state are posted at in OpenStreetMap (state DOTs usually post these below
    the legal maximum). Other roads: the state's legal default.
    """
    if sd:
        if is_numbered(tags, sd):
            t = typical.get((state, highway)) or typical.get((state, "*"))
            if t:
                return t, "estimated"
            return sd["numbered"], "state_default"
        return sd["unnumbered"], "state_default"
    return region.speed_estimates.get(highway, 35), "estimated"


def typical_numbered_limits(osm, state_of, sd_all: dict, imperial: bool, min_km: float = 20) -> dict:
    """Most common posted limit on numbered routes, per state and road class (length weighted)."""
    from collections import defaultdict
    acc = defaultdict(Counter)
    for way in osm.ways.values():
        tags = way["tags"]
        speeds = parse_maxspeed(tags.get("maxspeed"), imperial)
        if not speeds:
            continue
        lon, lat = way["lonlat"][len(way["lonlat"]) // 2]
        state = state_of(lon, lat)
        if not is_numbered(tags, sd_all.get(state)):
            continue
        ll = way["lonlat"]
        km = float(np.hypot(np.diff(ll[:, 0]) * 94.5, np.diff(ll[:, 1]) * 111.3).sum())
        acc[(state, way["highway"])][min(speeds)] += km
        acc[(state, "*")][min(speeds)] += km
    return {k: c.most_common(1)[0][0] for k, c in acc.items() if sum(c.values()) >= min_km}


def resample(xy: np.ndarray, cum: np.ndarray, every: float) -> tuple[np.ndarray, np.ndarray]:
    total = cum[-1]
    n = max(2, int(total // every) + 1)
    d = np.linspace(0, total, n)
    x = np.interp(d, cum, xy[:, 0])
    y = np.interp(d, cum, xy[:, 1])
    return d, np.column_stack([x, y])


# ---------- main ---------------------------------------------------------------

def load_osm(region: Region):
    cache = DATA_DIR / "cache" / f"osm_{region.slug}.pkl"
    sources = osm_paths(region)
    newest = max(p.stat().st_mtime for p in sources)
    if cache.exists() and cache.stat().st_mtime > newest:
        with cache.open("rb") as f:
            return pickle.load(f)
    data = read_extracts(sources, region.bbox, DATA_DIR / "tmp", states=tuple(region.speed_defaults))
    cache.parent.mkdir(parents=True, exist_ok=True)
    with cache.open("wb") as f:
        pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
    return data


def build(region: Region) -> list[dict]:
    t0 = time.time()
    cfg = load_scoring()
    imperial = region.units == "imperial"
    osm = load_osm(region)
    print(f"osm loaded: {len(osm.ways)} ways ({time.time() - t0:.0f}s)")

    cx = (region.bbox[0] + region.bbox[2]) / 2
    cy = (region.bbox[1] + region.bbox[3]) / 2
    epsg = utm_epsg(cx, cy)
    fwd = Transformer.from_crs(4326, epsg, always_xy=True)
    inv = Transformer.from_crs(epsg, 4326, always_xy=True)

    def proj(lonlat: np.ndarray) -> np.ndarray:
        x, y = fwd.transform(lonlat[:, 0], lonlat[:, 1])
        return np.column_stack([x, y])

    way_xy = {}

    def xy_of(wid):
        if wid not in way_xy:
            way_xy[wid] = proj(osm.ways[wid]["lonlat"])
        return way_xy[wid]

    chains = build_chains(osm.ways, xy_of)
    print(f"chains: {len(chains)} ({time.time() - t0:.0f}s)")

    # Node degree among drivable roads, for junction counting.
    refs = np.frombuffer(osm.drivable_refs, dtype=np.int64)
    uniq, counts = np.unique(refs, return_counts=True)

    def degree(nodes: np.ndarray) -> np.ndarray:
        pos = np.searchsorted(uniq, nodes)
        pos = np.clip(pos, 0, len(uniq) - 1)
        found = uniq[pos] == nodes
        return np.where(found, counts[pos], 0)

    c_cand = cfg["candidate"]
    bands = cfg["curvature"]["bands"]
    pieces = []
    for ch in chains:
        if len(ch.nodes) < 3:
            continue
        xy = proj(ch.lonlat)
        cum = g.cumulative(xy)
        if cum[-1] < c_cand["min_length_m"]:
            continue
        dpos, lens, w, radii, turn = g.curvature_profile(xy, c_cand, bands)
        for a, b in g.split_at_straights(lens, w, c_cand["straight_split_m"]):
            # Map the piece back to the nearest original mapped points.
            oa = int(np.clip(np.searchsorted(cum, dpos[a], side="right") - 1, 0, len(cum) - 2))
            ob = int(np.clip(np.searchsorted(cum, dpos[b], side="left"), oa + 1, len(cum) - 1))
            length = float(cum[ob] - cum[oa])
            wc = float((lens[a:b] * w[a:b]).sum())
            if length < c_cand["min_length_m"] or wc < c_cand["min_weighted_curve_m"]:
                continue
            pieces.append((ch, xy, cum, oa, ob, length, wc))
    print(f"pieces passing curvature: {len(pieces)} ({time.time() - t0:.0f}s)")

    # Scenery indexes in projected meters.
    def to_proj(geom):
        return shapely.transform(geom, lambda c: proj(c))

    trees = {}
    for kind in ("forest", "water", "wetland", "protected"):
        geoms = [to_proj(geom) for (k, _), geom in osm.scenery.items() if k == kind]
        if kind == "water":
            geoms += [to_proj(line) for line in osm.rivers.values()]
        trees[kind] = STRtree(geoms) if geoms else None
        print(f"  scenery {kind}: {len(geoms)} shapes")

    places = list(osm.places.values())
    place_xy = proj(np.array([[p[2], p[3]] for p in places])) if places else np.zeros((0, 2))
    home_xy = proj(np.array([region.home]))[0]

    state_geoms = {name: shapely.prepared.prep(geom) for name, geom in osm.states.items()}
    print(f"  states: {sorted(state_geoms)}")

    # If exactly one configured state's outline could not be built (coastal
    # outlines are often incomplete in extracts), it is "everything else".
    missing = [name for name in region.speed_defaults if name not in state_geoms]
    fallback_state = missing[0] if len(missing) == 1 else None
    if fallback_state:
        print(f"  {fallback_state}: outline not built, used for roads outside the other states")

    def state_of(lon, lat):
        pt = shapely.Point(lon, lat)
        for name, geom in state_geoms.items():
            if geom.contains(pt):
                return name
        return fallback_state

    typical = typical_numbered_limits(osm, state_of, region.speed_defaults, imperial)
    print(f"  typical posted limits on numbered routes: {typical}")

    dem = Dem(region.raw_dir / "dem")
    land = Landcover(region.raw_dir / "landcover", region.bbox)
    if not land.covered:
        land = None
        print("  no land cover tiles; forest and water from OpenStreetMap only")
    else:
        print(f"land cover loaded ({time.time() - t0:.0f}s)")
    sc = cfg["scenery"]
    fl = cfg["flow"]
    roads = []
    for ch, xy, cum, oa, ob, length, wc in pieces:
        pxy = xy[oa : ob + 1]
        pcum = cum[oa : ob + 1] - cum[oa]
        nodes = ch.nodes[oa : ob + 1]
        seg_way = ch.seg_way[oa:ob]
        seg_len = g.seg_lengths(pxy)
        km = length / 1000.0

        mid_ll = ch.lonlat[(oa + ob) // 2]
        state = state_of(mid_ll[0], mid_ll[1])
        sd = region.speed_defaults.get(state) if state else None

        # Per-segment tag factors, length weighted
        surf_vals, surf_kinds, quiet_vals = [], Counter(), []
        speed_by_val = Counter()
        untagged_len = 0.0
        seg_limit = np.zeros(len(seg_len))
        src_len = Counter()
        class_len = Counter()
        names, refs_c = Counter(), Counter()
        bridge = np.zeros(len(seg_len), dtype=bool)
        byway_len = 0.0
        byway_name = None
        for i, (wid, L) in enumerate(zip(seg_way, seg_len)):
            way = osm.ways[int(wid)]
            tags, hw = way["tags"], way["highway"]
            s, kind = surface_score(tags, hw, cfg["surface"])
            surf_vals.append(s)
            surf_kinds[kind] += L
            quiet_vals.append(quiet_score(tags, hw, cfg["quiet"]))
            class_len[hw] += L
            speeds = parse_maxspeed(tags.get("maxspeed"), imperial)
            if speeds:
                for v in speeds:
                    speed_by_val[v] += L
                seg_limit[i] = min(speeds)
            else:
                untagged_len += L
                seg_limit[i], src = default_limit(tags, hw, sd, state, typical, region)
                src_len[src] += L
            if tags.get("bridge") not in (None, "no"):
                bridge[i] = True
            if int(wid) in osm.byway_members:
                byway_len += L
                byway_name = byway_name or osm.byway_names.get(int(wid))
            if tags.get("name"):
                names[tags["name"]] += L
            if tags.get("ref"):
                refs_c[tags["ref"].split(";")[0]] += L
        total_len = seg_len.sum()
        surface = float(np.dot(surf_vals, seg_len) / total_len)
        quiet = float(np.dot(quiet_vals, seg_len) / total_len)
        surface_label = surf_kinds.most_common(1)[0][0]
        paved = surf_kinds["unpaved"] < 0.2 * total_len

        # Speed limits: posted (OpenStreetMap) first, then the state's legal default.
        main_class = class_len.most_common(1)[0][0]
        share_untagged = untagged_len / total_len
        by_val = Counter()
        for v, L in zip(seg_limit, seg_len):
            by_val[int(v)] += L
        shown = [v for v, L in by_val.items() if L >= min(200, 0.1 * total_len)] or [int(seg_limit[0])]
        speed_min, speed_max = min(shown), max(shown)
        main_src = src_len.most_common(1)[0][0] if src_len else "posted"
        if share_untagged <= 0.25:
            speed_source = "posted"
        elif share_untagged < 0.75:
            speed_source = "partly_default" if main_src == "state_default" else "partly_estimated"
        else:
            speed_source = main_src
        share_40 = float(seg_len[seg_limit >= cfg["categories"]["min_speed"]].sum() / total_len)

        # Driving model: how hard the road works a car at legal speeds.
        unit = drive.MPH if imperial else 1 / 3.6

        def limit_at(dd, seg_limit=seg_limit, pcum=pcum):
            i = np.clip(np.searchsorted(pcum, dd, side="right") - 1, 0, len(seg_limit) - 1)
            return seg_limit[i] * unit

        dm = drive.analyze(pxy, limit_at, c_cand, bands, cfg["drive"])
        ds = drive.scores(dm, cfg["drive"])
        twisty, speed_score = ds["twisty"], ds["speed"]

        # Interruptions (interior nodes only)
        interior = nodes[1:-1]
        deg = degree(interior)
        junction = deg >= 3
        weight_sum = float(junction.sum()) * fl["junction"]
        n_stop = n_signals = 0
        for k, nid in enumerate(interior):
            sig = osm.signals.get(int(nid))
            if not sig:
                continue
            kind, extra = sig
            if kind == "stop" and junction[k] and extra.get("stop") != "all":
                continue  # likely the side road's stop sign
            weight_sum += fl[kind]
            n_stop += kind == "stop"
            n_signals += kind == "signals"
        flow = g.decay(weight_sum / km, fl["scale"])

        # Elevation
        ev = cfg["elevation"]
        d, sxy = resample(pxy, pcum, ev["sample_every_m"])
        lon, lat = inv.transform(sxy[:, 0], sxy[:, 1])
        elev = dem.sample(np.column_stack([lon, lat]))
        seg_idx = np.clip(np.searchsorted(pcum, d, side="right") - 1, 0, len(bridge) - 1)
        elev[bridge[seg_idx]] = np.nan
        good = ~np.isnan(elev)
        if good.sum() >= 2:
            elev = np.interp(d, d[good], elev[good])
            k = 5
            if len(elev) > k:
                kernel = np.ones(k) / k
                padded = np.pad(elev, (k // 2, k // 2), mode="edge")
                elev_s = np.convolve(padded, kernel, mode="valid")
            else:
                elev_s = elev
            dz = np.diff(elev_s)
            climb = float(dz[dz > 0].sum())
            descent = float(-dz[dz < 0].sum())
            elevation = g.saturate((climb + descent) / km, ev["scale"])
            step = max(1, len(d) // 100)
            profile = [[round(float(d[i])), round(float(elev_s[i]), 1)] for i in range(0, len(d), step)]
            if profile[-1][0] != round(float(d[-1])):
                profile.append([round(float(d[-1])), round(float(elev_s[-1]), 1)])
            elev_range = (float(elev_s.min()), float(elev_s.max()))
        else:
            climb = descent = 0.0
            elevation = 0.0
            profile = []
            elev_range = (None, None)

        # Scenery
        d2, pts_xy = resample(pxy, pcum, sc["sample_every_m"])
        pts = shapely.points(pts_xy)

        def share(kind, dist):
            t = trees.get(kind)
            if t is None:
                return 0.0
            if dist == 0:
                hits = t.query(pts, predicate="intersects")
            else:
                hits = t.query(pts, predicate="dwithin", distance=dist)
            return len(np.unique(hits[0])) / len(pts) if hits.size else 0.0

        def hits(kind, dist):
            t = trees.get(kind)
            mask = np.zeros(len(pts), dtype=bool)
            if t is not None:
                found = t.query(pts, predicate="dwithin", distance=dist)
                mask[np.unique(found[0])] = True
            return mask

        if land is not None:
            plon, plat = inv.transform(pts_xy[:, 0], pts_xy[:, 1])
            pll = np.column_stack([plon, plat])
            # Forest: average tree cover around the road (satellite land cover).
            forest = float(land.window_means(pll, sc["forest_within_m"], "tree").mean())
            near_water = land.window_means(pll, sc["water_within_m"], "water") >= sc["water_min_share"]
            near_wet = land.window_means(pll, sc["water_within_m"], "wetland") >= sc["wetland_min_share"]
            water = float((near_water | hits("water", sc["water_within_m"])).mean())
            wetland = float((near_wet | hits("wetland", sc["water_within_m"])).mean())
        else:
            forest = share("forest", sc["forest_within_m"])
            water = share("water", sc["water_within_m"])
            wetland = share("wetland", sc["water_within_m"])
        protected = share("protected", 0)
        water_eff = min(1.0, max(water, wetland * sc["wetland_weight"]))
        byway = byway_len / total_len >= sc["byway_min_share"]
        scenic_raw = (
            sc["w_forest"] * forest
            + sc["w_water"] * water_eff
            + sc["w_protected"] * protected
            + (sc["byway_bonus"] if byway else 0.0)
        )
        scenic = 100.0 * min(1.0, scenic_raw)

        ow = cfg["overall"]
        overall = overall_score(
            dict(twisty=twisty, speed=speed_score, scenic=scenic, flow=flow,
                 elevation=elevation, quiet=quiet, surface=surface), ow)
        # Driver's roads: the main list. Everything else still appears in the
        # Most Scenic list and in search, just not ranked as a driver's road.
        cat = cfg["categories"]
        excluded_because = []
        if share_40 < cat["min_speed_share"]:
            excluded_because.append(f"speed limit under {cat['min_speed']} {'mph' if imperial else 'km/h'}")
        if not paved:
            excluded_because.append("unpaved")

        # Naming and location
        name = names.most_common(1)[0][0] if names else None
        ref = refs_c.most_common(1)[0][0] if refs_c else None
        if c_cand["require_name"] and not name and not ref:
            continue  # unnamed ways are often private, military, or logging roads
        if name and ref and ref not in name:
            display = f"{name} ({ref})"
        else:
            display = name or ref or "Unnamed road"
        mid = pxy[len(pxy) // 2]
        near = None
        if len(place_xy):
            dist = np.hypot(*(place_xy - mid).T)
            # Prefer a town or city within 15 km, else the closest place.
            order = np.argsort(dist)
            near = places[order[0]][0]
            for j in order[:30]:
                if places[j][1] in ("city", "town") and dist[j] < 15000:
                    near = places[j][0]
                    break
        mid_lon, mid_lat = inv.transform(mid[0], mid[1])
        lonlat = ch.lonlat[oa : ob + 1]
        rid = hashlib.sha1(f"osm:{nodes[0]}:{nodes[-1]}".encode()).hexdigest()[:12]
        scenery_tags = [
            t for t, v in (("forest", forest > 0.4), ("water", water_eff > 0.25),
                           ("protected", protected > 0.3), ("byway", byway)) if v
        ]
        roads.append({
            "id": rid,
            "name": display,
            "osm_name": name,
            "ref": ref,
            "near": near,
            "highway": main_class,
            "length_m": round(length),
            "score_overall": round(overall),
            "drivers_road": not excluded_because,
            "not_drivers_road_because": excluded_because,
            "score_twisty": round(twisty),
            "score_speed": round(speed_score),
            "drive": {
                "avg_lateral_g": round(dm["mean_lat_g"], 3),
                "hard_cornering_share": round(dm["hard_share"], 2),
                "braking_per_km": round(dm["braking_ms_per_km"], 1),
                "esses_per_km": round(dm["transitions_per_km"], 2),
                "legal_avg_speed": round(ds["avg_mph"] if imperial else dm["avg_speed_ms"] * 3.6),
            },
            "score_scenic": round(scenic),
            "score_elevation": round(elevation),
            "score_flow": round(flow),
            "score_quiet": round(quiet),
            "score_surface": round(surface),
            "curve_m_per_km": round(wc / km),
            "climb_m": round(climb),
            "descent_m": round(descent),
            "elev_min_m": None if elev_range[0] is None else round(elev_range[0]),
            "elev_max_m": None if elev_range[1] is None else round(elev_range[1]),
            "interruptions": {
                "junctions": int(junction.sum()), "stops": n_stop, "signals": n_signals,
                "per_km": round(weight_sum / km, 2),
            },
            "scenery": {
                "forest": round(forest, 2), "water": round(water, 2), "wetland": round(wetland, 2),
                "protected": round(protected, 2), "byway": byway_name if byway else None,
            },
            "scenery_tags": scenery_tags,
            "surface": surface_label,
            "paved": bool(paved),
            "speed_min": speed_min,
            "speed_max": speed_max,
            "speed_units": "mph" if imperial else "km/h",
            "speed_source": speed_source,
            "speed_default_note": sd.get("source") if sd and speed_source != "posted" else None,
            "state": state,
            "osm_way_ids": sorted({int(x) for x in seg_way}),
            "mid": [round(mid_lon, 5), round(mid_lat, 5)],
            "home_km": round(float(np.hypot(*(mid - home_xy))) / 1000, 1),
            "elev_profile": profile,
            "geometry": [[round(x, 6), round(y, 6)] for x, y in lonlat],
            "scoring_version": cfg["version"],
            "status": "candidate",
            "source": "osm",
        })
    roads.sort(key=lambda r: -r["score_overall"])
    write_outputs(region, roads)
    print(f"candidates: {len(roads)} ({time.time() - t0:.0f}s)")
    return roads


def write_outputs(region: Region, roads: list[dict]) -> None:
    out = region.out_dir
    out.mkdir(parents=True, exist_ok=True)
    features = []
    for r in roads:
        props = {k: v for k, v in r.items() if k != "geometry"}
        features.append({
            "type": "Feature",
            "id": r["id"],
            "properties": props,
            "geometry": {"type": "LineString", "coordinates": r["geometry"]},
        })
    fc = {
        "type": "FeatureCollection",
        "attribution": "© OpenStreetMap contributors. Derived data under the ODbL 1.0.",
        "license": "ODbL-1.0",
        "features": features,
    }
    (out / "candidates.geojson").write_text(json.dumps(fc), encoding="utf-8")
    cols = [
        "id", "name", "near", "highway", "length_m", "score_overall", "score_twisty",
        "score_scenic", "score_elevation", "score_flow", "score_quiet", "score_surface",
        "curve_m_per_km", "climb_m", "surface", "speed_min", "speed_max", "speed_source",
        "score_speed", "drivers_road",
        "home_km", "mid",
    ]
    with (out / "candidates.csv").open("w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(cols)
        for r in roads:
            wr.writerow([r[c] if c != "mid" else f"{r['mid'][1]},{r['mid'][0]}" for c in cols])
