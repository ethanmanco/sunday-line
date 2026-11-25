"""Scenic score v2 (plan 11.65): a separate pass over finished exports.

The first scenic score (build.py) only looked for trees, water, protected land
and scenic byways near the road, so a road on an ocean cliff with no trees, a
red rock canyon, or an alpine pass above the tree line scored low. This pass
keeps those and adds what the land around the road looks like:

- Terrain: how much the land rises and falls within about 1.5 km (USGS 3DEP).
- Overlook: how far the road sits above the land around it (views).
- Big water: open water filling a good part of the land within 1 km, scaled by
  how much of the land within 3 km is water, so the ocean, the Great Lakes and
  big lakes count far more than a small lake, and a pond hardly at all.
- Open country: desert, rock, grassland, shrubs, snow (ESA WorldCover), which
  counts only where the land rises and falls (canyons, buttes, hills), so flat
  farmland and prairie don't.
- Built-up land (buildings and pavement) along the road takes points away.

Each part is a 0 to 1 share; they combine so that any one striking thing
makes a road scenic and more of them add up with diminishing returns:
scenic = 1 - product(1 - weight * part), then the built-up penalty.

    python -m pipeline.scenic apply --out E:/sunday-line-data/out [--states al,ar]
    python -m pipeline.scenic road <encoded polyline>       (features for one line)

`apply` rewrites scores.scenic (and nudges overall by its small Scenic weight)
in each out/<state>/export.json, keeping the first score as scores.scenic_v1
so the pass can run again from the original.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import tomllib
from collections import OrderedDict
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from .config import DATA_DIR

HERE = Path(__file__).resolve().parent

# ESA WorldCover classes.
TREE, SHRUB, GRASS, CROP, BUILT, BARE, SNOW, WATER, WETLAND, MANGROVE, MOSS = 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100
OPEN = (SHRUB, GRASS, BARE, SNOW, MOSS)
WC_PIX = 1 / 12000   # degrees
WC_BLOCK = 3         # read at about 30 m

M_PER_DEG = 111_320.0


def load_weights() -> dict:
    with open(HERE / "scoring.toml", "rb") as f:
        return tomllib.load(f)["scenic_v2"]


def decode_polyline(s: str) -> np.ndarray:
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
    return np.array(out, dtype=float)


def resample(ll: np.ndarray, step_m: float, max_pts: int) -> np.ndarray:
    """Points every step_m along the line (at most max_pts, spread evenly)."""
    if len(ll) < 2:
        return ll
    lat0 = math.radians(float(ll[:, 1].mean()))
    xy = np.column_stack([ll[:, 0] * M_PER_DEG * math.cos(lat0), ll[:, 1] * M_PER_DEG])
    seg = np.hypot(*np.diff(xy, axis=0).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = cum[-1]
    n = int(min(max_pts, max(2, total // step_m + 1)))
    at = np.linspace(0, total, n)
    return np.column_stack([np.interp(at, cum, ll[:, 0]), np.interp(at, cum, ll[:, 1])])


class DemTiles:
    """USGS 1 arc-second tiles, a few kept in memory at a time."""

    def __init__(self, tile_dir: Path, keep: int = 16, fetch_missing: bool = False):
        self.dir = tile_dir
        self.keep = keep
        self.fetch_missing = fetch_missing
        self.cache: OrderedDict[str, tuple[np.ndarray, rasterio.Affine] | None] = OrderedDict()

    def tile(self, lon: float, lat: float):
        top, left = math.floor(lat) + 1, math.floor(lon)
        name = (f"n{top:02d}" if top >= 0 else f"s{-top:02d}") + (f"w{-left:03d}" if left < 0 else f"e{left:03d}")
        if name in self.cache:
            self.cache.move_to_end(name)
            return self.cache[name]
        path = self.dir / f"USGS_1_{name}.tif"
        if not path.exists() and self.fetch_missing:
            # A state run's cleanup can remove border tiles a neighbor still needs.
            from .fetch import USGS_1AS, _download

            _download(USGS_1AS.format(name=name), path)
        val = None
        if path.exists():
            with rasterio.open(path) as ds:
                arr = ds.read(1).astype(np.float32)
                if ds.nodata is not None:
                    arr[arr == ds.nodata] = np.nan
                arr[arr < -1000] = np.nan
                val = (arr, ds.transform)
        self.cache[name] = val
        while len(self.cache) > self.keep:
            self.cache.popitem(last=False)
        return val

    def around(self, lon: float, lat: float, radius_m: float, stride: int = 3):
        """Elevation at the point and the land within radius_m (clipped at tile edges)."""
        t = self.tile(lon, lat)
        if t is None:
            return None
        arr, tr = t
        col, row = (lon - tr.c) / tr.a, (lat - tr.f) / tr.e
        r, c = int(row), int(col)
        ry = max(1, int(radius_m / (abs(tr.e) * M_PER_DEG)))
        rx = max(1, int(radius_m / (tr.a * M_PER_DEG * math.cos(math.radians(lat)))))
        if not (0 <= r < arr.shape[0] and 0 <= c < arr.shape[1]):
            return None
        here = arr[r, c]
        win = arr[max(r - ry, 0) : r + ry + 1 : stride, max(c - rx, 0) : c + rx + 1 : stride]
        win = win[np.isfinite(win)]
        if not np.isfinite(here) or win.size < 9:
            return None
        return float(here), win


class LandTiles:
    """ESA WorldCover 10 m, read around each road at about 30 m."""

    def __init__(self, tile_dir: Path, fetch_missing: bool = False):
        self.dir = tile_dir
        self.fetch_missing = fetch_missing
        self.tried: set[tuple[int, int]] = set()
        self.paths = {}
        for p in tile_dir.glob("ESA_WorldCover_10m_2021_v200_*_Map.tif"):
            key = p.name.split("_")[5]  # N36W123
            lat = int(key[1:3]) * (1 if key[0] == "N" else -1)
            lon = int(key[4:7]) * (-1 if key[3] == "W" else 1)
            self.paths[(lat, lon)] = p
        self.open: OrderedDict[Path, rasterio.DatasetReader] = OrderedDict()

    def _fetch(self, la: int, lo: int):
        """Download a tile a state run's cleanup removed (ocean tiles don't exist)."""
        from .fetch import WORLDCOVER, _download

        self.tried.add((la, lo))
        name = (f"N{la:02d}" if la >= 0 else f"S{-la:02d}") + (f"E{lo:03d}" if lo >= 0 else f"W{-lo:03d}")
        path = self.dir / f"ESA_WorldCover_10m_2021_v200_{name}_Map.tif"
        if _download(WORLDCOVER.format(name=name), path) == "missing" and not path.exists():
            self.paths.pop((la, lo), None)
            return None
        self.paths[(la, lo)] = path
        return path

    def _ds(self, p: Path):
        if p in self.open:
            self.open.move_to_end(p)
            return self.open[p]
        ds = rasterio.open(p)
        self.open[p] = ds
        while len(self.open) > 8:
            self.open.popitem(last=False)[1].close()
        return ds

    def window(self, w: float, s: float, e: float, n: float):
        """Class grid (about 30 m cells, top-left at (w, n)) for the box; 0 where no data."""
        cell = WC_PIX * WC_BLOCK
        cols, rows = int(math.ceil((e - w) / cell)), int(math.ceil((n - s) / cell))
        out = np.zeros((rows, cols), np.uint8)
        for la in range(int(math.floor(s / 3) * 3), int(math.floor(n / 3) * 3) + 1, 3):
            for lo in range(int(math.floor(w / 3) * 3), int(math.floor(e / 3) * 3) + 1, 3):
                p = self.paths.get((la, lo))
                if (p is None or not p.exists()) and self.fetch_missing and (la, lo) not in self.tried:
                    p = self._fetch(la, lo)
                if p is None:
                    continue
                ds = self._ds(p)
                b = ds.bounds
                iw, is_, ie, in_ = max(w, b.left), max(s, b.bottom), min(e, b.right), min(n, b.top)
                if iw >= ie or is_ >= in_:
                    continue
                win = from_bounds(iw, is_, ie, in_, ds.transform).round_offsets().round_lengths()
                h, wd = int(win.height) // WC_BLOCK, int(win.width) // WC_BLOCK
                if h == 0 or wd == 0:
                    continue
                arr = ds.read(1, window=win, out_shape=(h, wd), resampling=rasterio.enums.Resampling.mode)
                r0 = int(round((n - in_) / cell))
                c0 = int(round((iw - w) / cell))
                hh, ww = min(h, rows - r0), min(wd, cols - c0)
                if hh > 0 and ww > 0:
                    out[r0 : r0 + hh, c0 : c0 + ww] = arr[:hh, :ww]
        return out


def box_share(mask: np.ndarray, rows: np.ndarray, cols: np.ndarray, ry: int, rx: int, valid: np.ndarray) -> np.ndarray:
    """Share of `mask` among valid cells in a (2ry+1) x (2rx+1) box around each cell."""
    def integral(a):
        s = np.zeros((a.shape[0] + 1, a.shape[1] + 1), np.int32)
        s[1:, 1:] = np.cumsum(np.cumsum(a, axis=0, dtype=np.int32), axis=1, dtype=np.int32)
        return s

    sm, sv = integral(mask.astype(np.uint8)), integral(valid.astype(np.uint8))
    r0 = np.clip(rows - ry, 0, mask.shape[0]); r1 = np.clip(rows + ry + 1, 0, mask.shape[0])
    c0 = np.clip(cols - rx, 0, mask.shape[1]); c1 = np.clip(cols + rx + 1, 0, mask.shape[1])
    m = sm[r1, c1] - sm[r0, c1] - sm[r1, c0] + sm[r0, c0]
    v = sv[r1, c1] - sv[r0, c1] - sv[r1, c0] + sv[r0, c0]
    return np.where(v > 0, m / np.maximum(v, 1), 0.0)


def clamp01(x):
    return np.clip(x, 0.0, 1.0)


def measure(line: str, dem: DemTiles, land: LandTiles, wt: dict) -> dict:
    ll = decode_polyline(line)
    pts = resample(ll, 60, 300)
    lat = float(pts[:, 1].mean())

    # Land cover around the road.
    margin = 3100 / M_PER_DEG
    mlon = margin / math.cos(math.radians(lat))
    w, s = pts[:, 0].min() - mlon, pts[:, 1].min() - margin
    e, n = pts[:, 0].max() + mlon, pts[:, 1].max() + margin
    grid = land.window(w, s, e, n)
    cell = WC_PIX * WC_BLOCK
    rows = ((n - pts[:, 1]) / cell).astype(int).clip(0, grid.shape[0] - 1)
    cols = ((pts[:, 0] - w) / cell).astype(int).clip(0, grid.shape[1] - 1)
    valid = grid > 0

    def rad(m):
        ry = max(1, int(round(m / (cell * M_PER_DEG))))
        rx = max(1, int(round(m / (cell * M_PER_DEG * math.cos(math.radians(lat))))))
        return ry, rx

    water = grid == WATER
    water_1k = box_share(water, rows, cols, *rad(1000), valid)
    water_3k = box_share(water, rows, cols, *rad(3000), valid)
    open_300 = box_share(np.isin(grid, OPEN), rows, cols, *rad(300), valid)
    built_150 = box_share(grid == BUILT, rows, cols, *rad(150), valid)
    covered = bool(valid.any())

    # Terrain around the road, every ~240 m.
    relief, above = [], []
    for lon, la in pts[::4]:
        got = dem.around(lon, la, wt["relief_radius_m"])
        if got is None:
            continue
        here, win = got
        relief.append(float(np.percentile(win, 98) - np.percentile(win, 2)))
        above.append(here - float(np.percentile(win, 10)))
    return {
        "relief": relief or [0.0], "above": above or [0.0],
        "water_1k": water_1k.tolist() if covered else [0.0],
        "water_3k": water_3k.tolist() if covered else [0.0],
        "open": float(open_300.mean()) if covered else 0.0,
        "built": float(built_150.mean()) if covered else 0.0,
    }


def parts_from(raw: dict, wt: dict) -> dict:
    """The 0 to 1 parts from the measurements around one road."""
    lo, hi = wt["relief_m"]
    alo, ahi = wt["above_m"]
    olo, ohi = wt["open_relief_m"]
    vlo, vhi = wt["vast_water_share"]
    relief, above = np.array(raw["relief"]), np.array(raw["above"])
    return {
        "rugged": float(clamp01((relief - olo) / (ohi - olo)).mean()),
        "terrain": float(clamp01((relief - lo) / (hi - lo)).mean()),
        "overlook": float(clamp01((above - alo) / (ahi - alo)).mean()),
        "big_water": float(((np.array(raw["water_1k"]) >= wt["big_water_share"])
                            * clamp01((np.array(raw["water_3k"]) - vlo) / (vhi - vlo))).mean()),
        "open": raw["open"],
        "built": raw["built"],
    }


def old_parts(road: dict, sc1: dict) -> dict:
    """Forest, water and protected shares from the first pass (protected isn't
    stored, so it's worked back out of the first score)."""
    sc = road["scenery"]
    forest, water, wetland = sc.get("forest", 0.0), sc.get("water", 0.0), sc.get("wetland", 0.0)
    water_eff = min(1.0, max(water, wetland * sc1["wetland_weight"]))
    byway = 1.0 if sc.get("byway") else 0.0
    s1 = road["scores"].get("scenic_v1", road["scores"]["scenic"]) / 100
    if s1 < 0.995:
        rest = s1 - sc1["w_forest"] * forest - sc1["w_water"] * water_eff - sc1["byway_bonus"] * byway
        protected = float(np.clip(rest / sc1["w_protected"], 0, 1))
        if protected < 0.08:
            protected = 0.0
    else:
        protected = 1.0 if "protected" in sc.get("tags", []) else 0.0
    return {"forest": forest, "water": water_eff, "protected": protected, "byway": byway}


def combine(parts: dict, wt: dict) -> float:
    def any_of(terms):
        return 1.0 - float(np.prod([1.0 - min(t, 0.99) for t in terms]))

    penalty = wt["w_built"] * min(1.0, parts["built"] / wt["built_full"])
    land = any_of([
        wt["w_forest"] * parts["forest"],
        wt["w_water"] * parts["water"],
        wt["w_terrain"] * parts["terrain"],
        wt["w_open"] * parts["open"] * parts["rugged"],
        wt["w_protected"] * parts["protected"],
        wt["w_byway"] * parts["byway"],
    ]) * (1.0 - penalty)
    # An ocean or a long view stays a view from a town, so buildings take less off.
    view = any_of([
        wt["w_big_water"] * parts["big_water"],
        wt["w_overlook"] * parts["overlook"],
    ]) * (1.0 - penalty * wt["view_built_share"])
    return 100.0 * (1.0 - (1.0 - land) * (1.0 - view))


def new_tags(parts: dict) -> list[str]:
    return [t for t, v in (
        ("forest", parts["forest"] > 0.4), ("water", parts["water"] > 0.25), ("coast", parts["big_water"] > 0.25),
        ("mountains", parts["terrain"] > 0.45), ("views", parts["overlook"] > 0.4),
        ("open country", parts["open"] * parts["rugged"] > 0.3), ("protected", parts["protected"] > 0.3),
        ("byway", parts["byway"] > 0)) if v]


def apply_state(path: Path, raw: Path, wt: dict, sc1: dict, overall_w: float, force: bool = False) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("scenic_version") == wt["version"] and not force:
        return -1  # done already (11.82)
    dem, land = DemTiles(raw / "dem", fetch_missing=True), LandTiles(raw / "landcover", fetch_missing=True)
    roads = data["roads"]
    # Nearby roads together so tiles stay in memory.
    order = sorted(range(len(roads)), key=lambda i: (math.floor(roads[i]["start"][1]), math.floor(roads[i]["start"][0])))
    for i in order:
        r = roads[i]
        parts = {**old_parts(r, sc1), **parts_from(measure(r["line"], dem, land, wt), wt)}
        s = r["scores"]
        s.setdefault("scenic_v1", s["scenic"])
        s.setdefault("overall_v1", s["overall"])
        new = round(combine(parts, wt))
        s["scenic"] = new
        s["overall"] = int(round(min(100, max(0, s["overall_v1"] + overall_w * (new - s["scenic_v1"])))))
        sc = r["scenery"]
        sc.update({k: round(parts[k], 2) for k in ("big_water", "terrain", "overlook", "open", "rugged", "built", "protected")})
        sc["tags"] = new_tags(parts)
    data["scenic_version"] = wt["version"]
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)
    return len(roads)


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("apply")
    a.add_argument("--out", type=Path, default=DATA_DIR / "out")
    a.add_argument("--raw", type=Path, default=DATA_DIR / "raw")
    a.add_argument("--states", default="")
    a.add_argument("--force", action="store_true", help="redo states already at this version")
    r = sub.add_parser("road")
    r.add_argument("line")
    r.add_argument("--raw", type=Path, default=DATA_DIR / "raw")
    args = ap.parse_args()
    wt = load_weights()
    with open(HERE / "scoring.toml", "rb") as f:
        cfg = tomllib.load(f)
    if args.cmd == "road":
        raw = measure(args.line, DemTiles(args.raw / "dem"), LandTiles(args.raw / "landcover"), wt)
        print(parts_from(raw, wt))
        return 0
    states = [s for s in args.states.split(",") if s] or sorted(p.name for p in args.out.iterdir() if (p / "export.json").exists())
    for st in states:
        t0 = time.time()
        n = apply_state(args.out / st / "export.json", args.raw, wt, cfg["scenery"], cfg["overall"]["scenic"], args.force)
        print(f"{st}: " + ("done already" if n < 0 else f"{n} roads, {time.time() - t0:.0f}s"), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
