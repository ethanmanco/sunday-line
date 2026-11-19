"""Score one road line on request (docs/plan.md 11.27).

    python -m pipeline.score_line "<encoded polyline>"

For roads people draw or pick off the map that aren't in the scored data.
Everything is fetched for just that road's corridor, from public sources:

- OpenStreetMap (Overpass API): road class, posted limits, surface, lanes,
  stop signs, signals, rail crossings, side roads, woods and water nearby.
- Federal road data (HPMS 2024, geo.dot.gov): who maintains it, pavement
  roughness, traffic, unpaved sections, and posted limits FHWA has.
- Elevation (public Terrarium terrain tiles): climb and descent.

Then the pipeline's own formulas: the same drive model for Twisty and Speed,
and the same Pavement, Flow, Elevation, Quiet, and Overall. Scenery is a rough
version (map data instead of satellite land cover); the result says so.
Speeds from the drive model are a scoring tool only and are never returned.
"""
from __future__ import annotations

import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

import numpy as np
import shapely
from pyproj import Transformer
from shapely.strtree import STRtree

from . import drive, geometry as g, hpms
from .build import (
    default_limit, overall_score, parse_maxspeed, pavement_score, quiet_score, resample, state_route_ref,
    surface_score, utm_epsg,
)
from .config import STATE_CODES, load_region, load_scoring

USER_AGENT = "SundayLine-road-scorer/1.0 (+https://sundayline.app)"
OVERPASS = "https://overpass-api.de/api/interpreter"
TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
# USGS 3D Elevation Program, the same bare-earth data the pipeline uses.
USGS_SAMPLES = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"
ROAD_CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
                "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
                "living_street", "service", "road", "track")
MATCH_M = 25        # a line point belongs to the nearest OSM road this close
NODE_M = 15         # stop signs, signals, and crossings this close count
MAX_KM = 120        # longer lines are too much for one request


def decode_polyline(s: str) -> list[tuple[float, float]]:
    out, i, lat, lon = [], 0, 0, 0
    while i < len(s):
        for k in (0, 1):
            shift = result = 0
            while True:
                b = ord(s[i]) - 63
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


def _get(url: str, data: bytes | None = None, timeout: int = 120) -> bytes:
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - network: retry, then give up
            if attempt == 3:
                raise RuntimeError(f"fetch failed: {url[:80]} ({e})") from e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("unreachable")


def overpass(query: str) -> dict:
    return json.loads(_get(OVERPASS, urllib.parse.urlencode({"data": query}).encode()))


# ---------- elevation ----------------------------------------------------------

def _tile(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def usgs_elevations(lonlat: np.ndarray) -> np.ndarray | None:
    """Bare-earth meters above sea level at each point (USGS 3DEP), in batches."""
    out = np.full(len(lonlat), np.nan)
    for start in range(0, len(lonlat), 400):
        chunk = lonlat[start:start + 400]
        geom = {"points": [[round(float(a), 6), round(float(b), 6)] for a, b in chunk], "spatialReference": {"wkid": 4326}}
        q = dict(geometry=json.dumps(geom), geometryType="esriGeometryMultipoint", returnFirstValueOnly="true",
                 interpolation="RSP_BilinearInterpolation", f="json")
        try:
            d = json.loads(_get(USGS_SAMPLES, urllib.parse.urlencode(q).encode(), timeout=90))
        except (RuntimeError, ValueError):
            return None
        for smp in d.get("samples", []):
            try:
                out[start + int(smp["locationId"])] = float(smp["value"])
            except (KeyError, ValueError, TypeError):
                continue
    return out if np.isfinite(out).sum() >= 2 else None


def elevations(lonlat: np.ndarray, z: int = 13) -> np.ndarray | None:
    """Meters above sea level: USGS bare earth, or Terrarium tiles if USGS is down."""
    usgs = usgs_elevations(lonlat)
    if usgs is not None:
        return usgs
    return terrarium_elevations(lonlat, z)


def terrarium_elevations(lonlat: np.ndarray, z: int = 13) -> np.ndarray | None:
    """Meters above sea level at each point, from Terrarium tiles (about 15 m pixels at z13)."""
    from PIL import Image

    tiles: dict[tuple[int, int], np.ndarray] = {}
    out = np.full(len(lonlat), np.nan)
    for i, (lon, lat) in enumerate(lonlat):
        fx, fy = _tile(lon, lat, z)
        key = (int(fx), int(fy))
        if key not in tiles:
            try:
                png = _get(TERRAIN.format(z=z, x=key[0], y=key[1]), timeout=60)
                tiles[key] = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"), dtype=np.float64)
            except RuntimeError:
                return None
        px = tiles[key]
        h, w = px.shape[:2]
        cx = min(w - 1, int((fx - key[0]) * w))
        cy = min(h - 1, int((fy - key[1]) * h))
        r, gg, b = px[cy, cx]
        out[i] = r * 256 + gg + b / 256 - 32768
    return out


# ---------- federal road data ------------------------------------------------

def hpms_sections(state_code: str, bbox: tuple[float, float, float, float]) -> list[dict]:
    w, s, e, n = bbox
    q = dict(
        where="1=1", geometry=f"{w},{s},{e},{n}", geometryType="esriGeometryEnvelope", inSR=4326, outSR=4326,
        spatialRel="esriSpatialRelIntersects", outFields=",".join(hpms.FIELDS), returnGeometry="true",
        geometryPrecision=6, resultRecordCount=2000, f="geojson",
    )
    url = hpms.SERVICE.format(st=state_code, year=hpms.YEAR) + "?" + urllib.parse.urlencode(q)
    try:
        d = json.loads(_get(url))
    except (RuntimeError, ValueError):
        return []
    return [f for f in d.get("features", []) if f.get("geometry")]


# ---------- scoring ----------------------------------------------------------

def score_line(encoded: str) -> dict:
    cfg = load_scoring()
    lonlat = np.array(decode_polyline(encoded), dtype=float)
    if len(lonlat) < 2:
        raise ValueError("line has fewer than 2 points")
    mid_lon, mid_lat = lonlat[len(lonlat) // 2]
    epsg = utm_epsg(mid_lon, mid_lat)
    fwd = Transformer.from_crs(4326, epsg, always_xy=True)
    inv = Transformer.from_crs(epsg, 4326, always_xy=True)
    x, y = fwd.transform(lonlat[:, 0], lonlat[:, 1])
    pxy = np.column_stack([x, y])
    seg = np.hypot(*np.diff(pxy, axis=0).T)
    keep = np.concatenate([[True], seg > 0.5])
    pxy = pxy[keep]
    pcum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(pxy, axis=0).T))])
    length = float(pcum[-1])
    if length < 500:
        raise ValueError("too short to score (under 500 m)")
    if length > MAX_KM * 1000:
        raise ValueError(f"too long to score (over {MAX_KM} km)")
    km = length / 1000

    # One Overpass request: roads, the nodes that interrupt them, scenery, and the state.
    pad = 0.004  # about 400 m
    w, s, e, n = lonlat[:, 0].min() - pad, lonlat[:, 1].min() - pad, lonlat[:, 0].max() + pad, lonlat[:, 1].max() + pad
    bb = f"{s},{w},{n},{e}"
    q = f"""[out:json][timeout:90];
(
  way["highway"~"^({'|'.join(ROAD_CLASSES)})$"]({bb});
  node["highway"~"^(traffic_signals|stop|give_way)$"]({bb});
  node["railway"="level_crossing"]({bb});
)->.roads;
.roads out geom tags;
(
  way["natural"~"^(wood|water|wetland)$"]({bb});
  way["landuse"="forest"]({bb});
  relation["natural"~"^(wood|water|wetland)$"]({bb});
  relation["landuse"="forest"]({bb});
);
out geom tags;
is_in({mid_lat},{mid_lon})->.a;
area.a["boundary"="administrative"]["admin_level"="4"];
out tags;"""
    osm = overpass(q)["elements"]

    def proj(coords):
        xs, ys = fwd.transform([c["lon"] for c in coords], [c["lat"] for c in coords])
        return np.column_stack([xs, ys])

    ways, nodes, scenery, state = [], [], [], None
    for el in osm:
        t = el.get("tags", {})
        if el["type"] == "area":
            state = t.get("name", state)
            continue
        if el["type"] == "node":
            kind = {"traffic_signals": "signals", "stop": "stop", "give_way": "yield"}.get(t.get("highway", ""))
            if t.get("railway") == "level_crossing":
                kind = "rail"
            if kind:
                xs, ys = fwd.transform([el["lon"]], [el["lat"]])
                nodes.append((kind, t, xs[0], ys[0]))
        elif el["type"] == "way" and "highway" in t and "geometry" in el:
            ways.append((el["id"], t, shapely.LineString(proj(el["geometry"]))))
        elif "geometry" in el or "members" in el:
            kind = "water" if t.get("natural") == "water" else "wetland" if t.get("natural") == "wetland" else "forest"
            parts = []
            if el["type"] == "way" and len(el.get("geometry", [])) >= 4:
                parts.append(el["geometry"])
            for m in el.get("members", []):
                if m.get("role") in ("outer", "") and len(m.get("geometry", [])) >= 4:
                    parts.append(m["geometry"])
            for p in parts:
                try:
                    poly = shapely.Polygon(proj(p))
                    if poly.is_valid and poly.area > 0:
                        scenery.append((kind, poly))
                except (ValueError, shapely.errors.GEOSException):
                    continue
    if not ways:
        raise ValueError("no mapped road found along this line")

    # Which OSM road each stretch of the line is on.
    d, sxy = resample(pxy, pcum, 20.0)
    tree = STRtree([w_[2] for w_ in ways])
    pts = shapely.points(sxy[:, 0], sxy[:, 1])
    idx = [tree.query_nearest(p, max_distance=MATCH_M) for p in pts]
    match = [int(i[0]) if len(i) else -1 for i in idx]
    on_road = np.array([m >= 0 for m in match])
    if on_road.mean() < 0.6:
        raise ValueError("most of this line isn't on a mapped road")
    tags_at = [ways[m][1] if m >= 0 else {} for m in match]
    class_at = [t.get("highway", "unclassified") for t in tags_at]
    main_class = Counter(c for c, ok in zip(class_at, on_road) if ok).most_common(1)[0][0]
    main_tags = Counter(json.dumps(t, sort_keys=True) for t, ok in zip(tags_at, on_road) if ok).most_common(1)[0][0]
    main_tags = json.loads(main_tags)

    # State and its rules.
    code = STATE_CODES.get(state or "", None)
    region = None
    if code:
        try:
            region = load_region(code.lower())
        except FileNotFoundError:
            region = None
    imperial = True
    sd = region.speed_defaults.get(state) if region else None

    # Federal road data along the line.
    hp = hpms_sections(code, (w, s, e, n)) if code else []
    hp_lines = []
    for f in hp:
        geom = f["geometry"]
        lines = geom["coordinates"] if geom["type"] == "MultiLineString" else [geom["coordinates"]]
        for ln in lines:
            if len(ln) >= 2:
                xs, ys = fwd.transform([c[0] for c in ln], [c[1] for c in ln])
                hp_lines.append((f["properties"], shapely.LineString(np.column_stack([xs, ys]))))
    hp_at: list[dict | None] = [None] * len(pts)
    if hp_lines:
        htree = STRtree([h[1] for h in hp_lines])
        for k, p in enumerate(pts):
            near = htree.query_nearest(p, max_distance=MATCH_M)
            if len(near):
                hp_at[k] = hp_lines[int(near[0])][0]

    # Speed limits along the line: OSM posted, then FHWA posted, then the state's rules.
    limits = np.zeros(len(pts))
    posted = np.zeros(len(pts), dtype=bool)
    src = Counter()
    for k in range(len(pts)):
        sp = parse_maxspeed(tags_at[k].get("maxspeed"), imperial)
        hpl = (hp_at[k] or {}).get("speed_limit")
        if sp:
            limits[k], posted[k] = min(sp), True
            src["posted"] += 1
        elif hpl and hpl > 0:
            limits[k], posted[k] = float(hpl), True
            src["posted"] += 1
        else:
            if region is not None:
                v, why = default_limit(tags_at[k], class_at[k], sd, state, {}, region)
            else:
                v, why = {"primary": 55, "secondary": 50, "tertiary": 45}.get(class_at[k], 35), "estimated"
            limits[k] = v
            src[why] += 1

    def limit_at(dd):
        i = np.clip(np.searchsorted(d, dd, side="right") - 1, 0, len(limits) - 1)
        return limits[i] * drive.MPH

    dm = drive.analyze(pxy, limit_at, cfg["candidate"], cfg["curvature"]["bands"], cfg["drive"])
    ds = drive.scores(dm, cfg["drive"])
    twisty, speed_score = ds["twisty"], ds["speed"]

    # Flow: side roads (other roads crossing or meeting the line) and signs along it.
    fl = cfg["flow"]
    line = shapely.LineString(pxy)
    inner = line.buffer(NODE_M)
    ends = shapely.MultiPoint([pxy[0], pxy[-1]]).buffer(60)
    matched = {match[k] for k in range(len(match)) if match[k] >= 0}
    junction_pts = []
    for j, (_, t, wl) in enumerate(ways):
        if j in matched or t.get("highway") in ("service", "track"):
            continue
        hit = wl.intersection(inner)
        # A road running along the line (the same road in pieces) isn't a side road.
        if hit.is_empty or hit.length > 3 * NODE_M:
            continue
        c = hit.centroid
        if ends.contains(c) or any(c.distance(p) < 40 for p in junction_pts):
            continue
        junction_pts.append(c)
    n_stop = sum(1 for kind, t, nx, ny in nodes if kind == "stop" and t.get("stop") != "minor" and inner.contains(shapely.Point(nx, ny)))
    n_signals = sum(1 for kind, _, nx, ny in nodes if kind == "signals" and inner.contains(shapely.Point(nx, ny)))
    n_rail = sum(1 for kind, _, nx, ny in nodes if kind == "rail" and inner.contains(shapely.Point(nx, ny)))
    n_yield = sum(1 for kind, _, nx, ny in nodes if kind == "yield" and inner.contains(shapely.Point(nx, ny)))
    weight = len(junction_pts) * fl["junction"] + n_stop * fl["stop"] + n_signals * fl["signals"] + n_rail * fl["rail"] + n_yield * fl["yield"]
    flow = g.decay(weight / km, fl["scale"])

    # Elevation.
    ev = cfg["elevation"]
    ed, exy = resample(pxy, pcum, ev["sample_every_m"])
    elon, elat = inv.transform(exy[:, 0], exy[:, 1])
    elev = elevations(np.column_stack([elon, elat]))
    climb = descent = 0.0
    profile_ft: list[int] = []
    elevation = 0.0
    if elev is not None:
        # Bridges: bare-earth elevation dips into the creek below the road (the pipeline drops them too).
        bridges = [ways[j][2] for j in matched if ways[j][1].get("bridge", "no") not in ("no", "")]
        if bridges:
            btree = STRtree(bridges)
            epts = shapely.points(exy[:, 0], exy[:, 1])
            for k, p in enumerate(epts):
                if len(btree.query(p, predicate="dwithin", distance=MATCH_M)):
                    elev[k] = np.nan
    if elev is not None and np.isfinite(elev).sum() >= 2:
        good = np.isfinite(elev)
        elev = np.interp(ed, ed[good], elev[good])
        k5 = 5
        padded = np.pad(elev, (k5 // 2, k5 // 2), mode="edge")
        elev_s = np.convolve(padded, np.ones(k5) / k5, mode="valid") if len(elev) > k5 else elev
        dz = np.diff(elev_s)
        climb, descent = float(dz[dz > 0].sum()), float(-dz[dz < 0].sum())
        elevation = g.saturate((climb + descent) / km, ev["scale"])
        step = max(1, len(elev_s) // 60)
        profile_ft = [round(float(v) * 3.28084) for v in elev_s[::step]]

    # Pavement, surface, quiet.
    owners = Counter((h or {}).get("ownership") for h in hp_at if h)
    owner = owners.most_common(1)[0][0] if owners else None
    hp_unpaved = sum(1 for h in hp_at if h and h.get("surface_type") in hpms.SURFACE_UNPAVED) > 0.3 * len(pts)
    aadts = [h["aadt"] for h in hp_at if h and h.get("aadt")]
    iris = [h["iri"] for h in hp_at if h and h.get("iri")]
    ref = (main_tags.get("ref") or "").split(";")[0].strip()
    state_ref = bool(ref and state_route_ref([code] if code else []).match(ref))
    tagged_paved = main_tags.get("surface") in cfg["surface"]["paved_values"]
    pavement, pavement_why = pavement_score(
        cfg["pavement"], state=state, owner=owner, state_ref=state_ref, hp_unpaved=hp_unpaved,
        aadt=float(np.median(aadts)) if aadts else None, iri=float(np.median(iris)) if iris else None,
        tagged_paved=tagged_paved, p_unpaved=None, photo_used=False, verdict=None,
    )
    surface, surface_label = surface_score(main_tags, main_class, cfg["surface"])
    if hp_unpaved:
        surface, surface_label = cfg["surface"]["unpaved"], "unpaved"
    quiet = quiet_score(main_tags, main_class, cfg["quiet"])

    # Scenery (rough): share of the line near woods and near water.
    sc = cfg["scenery"]
    sd_, sxy2 = resample(pxy, pcum, sc["sample_every_m"])
    spts = shapely.points(sxy2[:, 0], sxy2[:, 1])

    def near(kind: str, dist: float) -> float:
        polys = [p for k, p in scenery if k == kind]
        if not polys:
            return 0.0
        st = STRtree(polys)
        return float(np.mean([len(st.query(p, predicate="dwithin", distance=dist)) > 0 for p in spts]))

    forest = near("forest", sc["forest_within_m"])
    water = near("water", sc["water_within_m"])
    wetland = near("wetland", sc["water_within_m"])
    water_eff = min(1.0, max(water, wetland * sc["wetland_weight"]))
    scenic = 100.0 * min(1.0, sc["w_forest"] * forest + sc["w_water"] * water_eff)

    overall = overall_score(dict(twisty=twisty, speed=speed_score, scenic=scenic, flow=flow, elevation=elevation,
                                 quiet=quiet, surface=surface, pavement=pavement), cfg["overall"])
    smin, smax = int(limits.min()), int(limits.max())
    posted_share = float(posted.mean())
    return {
        "scores": {k: round(float(v)) for k, v in dict(
            overall=overall, twisty=twisty, speed=speed_score, pavement=pavement, flow=flow,
            elevation=elevation, scenic=scenic, quiet=quiet, surface=surface).items()},
        "details": {
            "miles": round(km / 1.609344, 1),
            "state": state,
            "road_class": main_class,
            "speed_limit": f"{smin} mph" if smin == smax else f"{smin} to {smax} mph",
            "speed_limit_posted_share": round(posted_share, 2),
            "pavement_why": pavement_why,
            "surface": surface_label,
            "climb_ft": round(climb * 3.28084),
            "descent_ft": round(descent * 3.28084),
            "profile_ft": profile_ft,
            "junctions": len(junction_pts),
            "stops": n_stop,
            "signals": n_signals,
            "forest": round(forest, 2),
            "water": round(water, 2),
            "bins": dm.get("bins"),
            "scoring_version": cfg["version"],
            "note": "Scored on request from OpenStreetMap, federal road data, and USGS elevation. Scenery is estimated from map data.",
        },
    }


if __name__ == "__main__":
    print(json.dumps(score_line(sys.argv[1]), indent=2))
