"""One region per US state (plus DC), and a one-shot command to process one.

    python -m pipeline states                        write regions/states/<abbr>.toml for every state
    python -m pipeline state --region ar             fetch, overture, hpms, score, export for Arkansas
    python -m pipeline state --region ar --cleanup   ...then delete Arkansas's raw inputs

Each state file uses that state's Geofabrik extract. The box in the table
below is approximate and generous; after the extract downloads, `state`
replaces it with the box in the extract's own header, so elevation and land
cover tiles match the state.

Legal default speed limits are copied from regions/shreveport.toml only for
Texas, Louisiana, and Arkansas, the states researched so far. Every other
state uses the speed_estimates table, and the app labels those "estimated".
Per-state runs have no home point, so roads get no home_mi.
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import threading
import time
import tomllib
from pathlib import Path

from .config import (
    DATA_DIR, REGIONS_DIR, STATE_CODES, STATE_REGIONS_DIR, Region, hand_written_regions, load_region,
)

GEOFABRIK = "https://download.geofabrik.de/north-america/us/{slug}-latest.osm.pbf"
RESEARCHED_DEFAULTS = ("Texas", "Louisiana", "Arkansas")

# name: (main time zone, approximate box: west, south, east, north)
STATES = {
    "Alabama": ("America/Chicago", (-88.6, 30.1, -84.8, 35.1)),
    "Alaska": ("America/Anchorage", (-179.2, 51.2, -129.9, 71.5)),
    "Arizona": ("America/Phoenix", (-114.9, 31.3, -109.0, 37.1)),
    "Arkansas": ("America/Chicago", (-94.7, 33.0, -89.6, 36.6)),
    "California": ("America/Los_Angeles", (-124.5, 32.5, -114.1, 42.1)),
    "Colorado": ("America/Denver", (-109.1, 36.9, -102.0, 41.1)),
    "Connecticut": ("America/New_York", (-73.8, 40.9, -71.7, 42.1)),
    "Delaware": ("America/New_York", (-75.8, 38.4, -75.0, 39.9)),
    "District of Columbia": ("America/New_York", (-77.2, 38.8, -76.9, 39.0)),
    "Florida": ("America/New_York", (-87.7, 24.4, -79.9, 31.1)),
    "Georgia": ("America/New_York", (-85.7, 30.3, -80.8, 35.1)),
    "Hawaii": ("Pacific/Honolulu", (-160.3, 18.9, -154.7, 22.3)),
    "Idaho": ("America/Boise", (-117.3, 41.9, -111.0, 49.1)),
    "Illinois": ("America/Chicago", (-91.6, 36.9, -87.0, 42.6)),
    "Indiana": ("America/Indiana/Indianapolis", (-88.2, 37.7, -84.7, 41.8)),
    "Iowa": ("America/Chicago", (-96.7, 40.3, -90.1, 43.6)),
    "Kansas": ("America/Chicago", (-102.1, 36.9, -94.5, 40.1)),
    "Kentucky": ("America/New_York", (-89.6, 36.4, -81.9, 39.2)),
    "Louisiana": ("America/Chicago", (-94.1, 28.9, -88.8, 33.1)),
    "Maine": ("America/New_York", (-71.1, 42.9, -66.9, 47.5)),
    "Maryland": ("America/New_York", (-79.5, 37.9, -75.0, 39.8)),
    "Massachusetts": ("America/New_York", (-73.6, 41.2, -69.9, 42.9)),
    "Michigan": ("America/Detroit", (-90.5, 41.6, -82.1, 48.3)),
    "Minnesota": ("America/Chicago", (-97.3, 43.4, -89.4, 49.4)),
    "Mississippi": ("America/Chicago", (-91.7, 30.1, -88.0, 35.1)),
    "Missouri": ("America/Chicago", (-95.8, 35.9, -89.0, 40.7)),
    "Montana": ("America/Denver", (-116.1, 44.3, -104.0, 49.1)),
    "Nebraska": ("America/Chicago", (-104.1, 39.9, -95.3, 43.1)),
    "Nevada": ("America/Los_Angeles", (-120.1, 35.0, -114.0, 42.1)),
    "New Hampshire": ("America/New_York", (-72.6, 42.6, -70.6, 45.4)),
    "New Jersey": ("America/New_York", (-75.6, 38.9, -73.8, 41.4)),
    "New Mexico": ("America/Denver", (-109.1, 31.3, -103.0, 37.1)),
    "New York": ("America/New_York", (-79.8, 40.4, -71.8, 45.1)),
    "North Carolina": ("America/New_York", (-84.4, 33.8, -75.4, 36.6)),
    "North Dakota": ("America/Chicago", (-104.1, 45.9, -96.5, 49.1)),
    "Ohio": ("America/New_York", (-84.9, 38.4, -80.5, 42.4)),
    "Oklahoma": ("America/Chicago", (-103.1, 33.6, -94.4, 37.1)),
    "Oregon": ("America/Los_Angeles", (-124.7, 41.9, -116.4, 46.3)),
    "Pennsylvania": ("America/New_York", (-80.6, 39.7, -74.6, 42.3)),
    "Rhode Island": ("America/New_York", (-71.9, 41.1, -71.1, 42.1)),
    "South Carolina": ("America/New_York", (-83.4, 32.0, -78.5, 35.3)),
    "South Dakota": ("America/Chicago", (-104.1, 42.4, -96.4, 46.0)),
    "Tennessee": ("America/Chicago", (-90.4, 34.9, -81.6, 36.7)),
    "Texas": ("America/Chicago", (-106.7, 25.8, -93.5, 36.6)),
    "Utah": ("America/Denver", (-114.1, 36.9, -109.0, 42.1)),
    "Vermont": ("America/New_York", (-73.5, 42.7, -71.4, 45.1)),
    "Virginia": ("America/New_York", (-83.7, 36.5, -75.2, 39.5)),
    "Washington": ("America/Los_Angeles", (-124.8, 45.5, -116.9, 49.1)),
    "West Virginia": ("America/New_York", (-82.7, 37.2, -77.7, 40.7)),
    "Wisconsin": ("America/Chicago", (-92.9, 42.4, -86.2, 47.4)),
    "Wyoming": ("America/Denver", (-111.1, 40.9, -104.0, 45.1)),
}


def geofabrik_slug(name: str) -> str:
    return name.lower().replace(" ", "-")


# ---------- writing the region files ------------------------------------------

def _toml_value(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        if "\\" in v or '"' in v:
            if "'" in v or "\n" in v:
                raise ValueError(f"can't write {v!r} as TOML")
            return f"'{v}'"  # literal string, no escapes (regexes)
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_toml_value(x) for x in v) + "]"
    raise TypeError(type(v))


def _fmt_bbox(bbox) -> str:
    return "[" + ", ".join(f"{x:g}" for x in bbox) + "]"


def state_toml(name: str, template: dict) -> str:
    abbr = STATE_CODES[name]
    tz, bbox = STATES[name]
    lines = [
        f"# {name}, one state as its own region. Written by `python -m pipeline states`;",
        "# rerunning that command overwrites this file.",
        "",
        f"slug = {_toml_value(abbr.lower())}",
        f"name = {_toml_value(name)}",
        f"area = {_toml_value(name)}",
        f"timezone = {_toml_value(tz)}",
        'units = "imperial"',
        'country = "US"',
        f"states = {_toml_value([name])}",
        "",
        "# west, south, east, north (degrees). `state` replaces this with the extract's header box.",
        f"bbox = {_fmt_bbox(bbox)}",
        "",
        "# No home point: per-state runs skip the Local list and home_mi.",
        "",
        f"osm_extracts = [{_toml_value(GEOFABRIK.format(slug=geofabrik_slug(name)))}]",
        "",
        f"dem = {_toml_value(template['dem'])}",
        f"landcover = {_toml_value(template.get('landcover', 'esa_worldcover_2021'))}",
    ]
    sd = template.get("speed_defaults", {}).get(name)
    if name in RESEARCHED_DEFAULTS and sd:
        lines += ["", "# Legal default for roads with no posted sign (copied from regions/shreveport.toml).",
                  f"[speed_defaults.{name}]"]
        lines += [f"{k} = {_toml_value(v)}" for k, v in sd.items()]
    else:
        lines += ["", "# No researched legal default for this state yet: unposted roads use the",
                  "# estimates below and are labeled \"estimated\" in the app."]
    lines += ["", "# Last-resort estimates by road type (mph).", "[speed_estimates]"]
    lines += [f"{k} = {_toml_value(v)}" for k, v in template.get("speed_estimates", {}).items()]
    return "\n".join(lines) + "\n"


def write_state_files() -> list[Path]:
    with (REGIONS_DIR / "shreveport.toml").open("rb") as f:
        template = tomllib.load(f)
    STATE_REGIONS_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for name in STATES:
        path = STATE_REGIONS_DIR / f"{STATE_CODES[name].lower()}.toml"
        path.write_text(state_toml(name, template), encoding="utf-8")
        written.append(path)
    print(f"wrote {len(written)} region files to {STATE_REGIONS_DIR}")
    return written


def bbox_from_extract(region: Region) -> Region:
    """Use the box from the downloaded extract's header, saving it to the region file."""
    import osmium

    from .fetch import osm_paths

    paths = [p for p in osm_paths(region) if p.exists()]
    if not paths or region.source is None:
        return region
    boxes = []
    for p in paths:
        reader = osmium.io.Reader(str(p), osmium.osm.osm_entity_bits.NOTHING)
        try:
            box = reader.header().box()
        finally:
            reader.close()
        if box.valid():
            boxes.append((box.bottom_left.lon, box.bottom_left.lat, box.top_right.lon, box.top_right.lat))
    if not boxes:
        return region
    new = (
        math.floor(min(b[0] for b in boxes) * 100) / 100,
        math.floor(min(b[1] for b in boxes) * 100) / 100,
        math.ceil(max(b[2] for b in boxes) * 100) / 100,
        math.ceil(max(b[3] for b in boxes) * 100) / 100,
    )
    if tuple(region.bbox) == new:
        return region
    text = region.source.read_text(encoding="utf-8")
    text, count = re.subn(r"(?m)^bbox = \[.*\]$", f"bbox = {_fmt_bbox(new)}", text)
    if count != 1:
        print(f"  bbox: could not update {region.source.name}; keeping {list(region.bbox)}")
        return region
    region.source.write_text(text, encoding="utf-8")
    print(f"  bbox: {list(region.bbox)} -> {list(new)} (from the extract header)")
    return load_region(region.slug)


# ---------- disk use ---------------------------------------------------------------

def dir_size(path: Path) -> int:
    total = 0
    try:
        with os.scandir(path) as it:
            for entry in it:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        total += dir_size(Path(entry.path))
                    else:
                        total += entry.stat(follow_symlinks=False).st_size
                except OSError:
                    pass
    except OSError:
        pass
    return total


class DiskWatch:
    """Samples the data folder's size in the background and keeps the peak."""

    def __init__(self, path: Path, every: float = 5.0):
        path.mkdir(parents=True, exist_ok=True)
        self.path, self.every = path, every
        self.start = self.peak = dir_size(path)
        self.min_free = shutil.disk_usage(path).free
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.wait(self.every):
            self.sample()

    def sample(self):
        self.peak = max(self.peak, dir_size(self.path))
        self.min_free = min(self.min_free, shutil.disk_usage(self.path).free)

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._t.join()
        self.sample()


# ---------- cleanup -----------------------------------------------------------------

def sweep_tmp() -> int:
    """Delete node caches left by earlier runs.

    On Windows the OSM reader can keep its node cache open until the process
    ends, so a run can't always delete its own; the next run removes them.
    Files still open by a live process can't be deleted on Windows and are skipped.
    """
    freed = 0
    mine = f".{os.getpid()}."
    for p in (DATA_DIR / "tmp").glob("*.nodecache"):
        if mine in p.name:
            continue
        try:
            size = p.stat().st_size
            p.unlink()
            freed += size
        except OSError:
            pass
    if freed:
        print(f"  tmp: removed {freed / 1e9:.2f} GB of node caches left by earlier runs")
    return freed


def input_files(region: Region) -> list[Path]:
    """Every raw input and cache a region's run uses (whether or not it exists)."""
    from . import hpms, overture
    from .fetch import dem_tile_names, osm_paths, worldcover_tile_names

    raw = region.raw_dir
    files = list(osm_paths(region))
    files += [raw / "dem" / f"USGS_1_{n}.tif" for n in dem_tile_names(region.bbox)]
    files += [raw / "landcover" / f"ESA_WorldCover_10m_2021_v200_{n}_Map.tif" for n in worldcover_tile_names(region.bbox)]
    files += [hpms.cache_path(region, st) for st in region.state_codes]
    for kind in overture.KINDS:
        p = overture.path(region, kind)
        if p is not None:
            files += [p, p.with_name(p.name + ".state")]
    files.append(DATA_DIR / "cache" / f"osm_{region.slug}.pkl")
    files.append(raw / "naip" / f"points_{region.slug}.json")
    for p in osm_paths(region):
        files += sorted((DATA_DIR / "tmp").glob(f"{p.stem}.*nodecache"))
    return files


def cleanup(region: Region) -> dict:
    """Delete a state's raw inputs, keeping files a hand-written region (regions/*.toml) also uses."""
    keep = set()
    for other in hand_written_regions():
        if other.slug != region.slug:
            keep.update(p.resolve() for p in input_files(other) if p.suffix in (".pbf", ".tif"))
    import gc

    gc.collect()  # let go of OSM reader handles so the node caches can be deleted
    removed = kept = 0
    kept_names = []
    for p in input_files(region):
        if not p.exists():
            continue
        size = p.stat().st_size
        if p.resolve() in keep:
            kept += size
            kept_names.append(p.name)
            continue
        try:
            p.unlink()
            removed += size
        except PermissionError:
            print(f"  cleanup: {p.name} is in use; the next `state` run removes it")
    ov_dir = region.raw_dir / "overture" / region.slug
    if ov_dir.exists() and not any(ov_dir.iterdir()):
        ov_dir.rmdir()
    print(f"  cleanup: removed {removed / 1e9:.2f} GB; kept {kept / 1e9:.2f} GB shared with other regions"
          + (f" ({', '.join(kept_names)})" if kept_names else ""))
    return {"removed_bytes": removed, "kept_shared_bytes": kept, "kept_shared": kept_names}


# ---------- the one-shot run --------------------------------------------------------------

def run_state(slug: str, do_cleanup: bool = False) -> dict:
    from . import hpms, overture
    from .build import build
    from .export import export
    from .fetch import _download, fetch, osm_paths

    region = load_region(slug)
    sweep_tmp()
    timings: dict[str, float] = {}
    t_all = time.time()
    with DiskWatch(DATA_DIR) as disk:
        t = time.time()
        for url, path in zip(region.osm_extracts, osm_paths(region)):
            print(f"osm  {path.name}: {_download(url, path)} ({path.stat().st_size / 1e6:.0f} MB)")
        region = bbox_from_extract(region)
        fetch(region)
        timings["fetch"] = time.time() - t

        t = time.time()
        try:
            overture_ok = overture.download(region)
        except Exception as e:  # network or S3 trouble: fall back to OpenStreetMap buildings
            print(f"  overture: failed ({e}); score will use OpenStreetMap buildings")
            overture_ok = False
        timings["overture"] = time.time() - t

        t = time.time()
        hpms.download(region)
        timings["hpms"] = time.time() - t

        t = time.time()
        roads = build(region)
        timings["score"] = time.time() - t

        t = time.time()
        export(region)
        timings["export"] = time.time() - t
        inputs = sum(p.stat().st_size for p in input_files(region) if p.exists())

    result = {
        "region": region.slug,
        "bbox": list(region.bbox),
        "seconds": {k: round(v) for k, v in timings.items()},
        "total_seconds": round(time.time() - t_all),
        "data_dir": str(DATA_DIR),
        "data_dir_start_bytes": disk.start,
        "data_dir_peak_bytes": disk.peak,
        "peak_growth_bytes": disk.peak - disk.start,
        "region_inputs_bytes": inputs,
        "min_free_bytes": disk.min_free,
        "overture": overture_ok,
        "candidates": len(roads),
        "drivers_roads": sum(1 for r in roads if r["drivers_road"]),
    }
    exp = json.loads((region.out_dir / "export.json").read_text(encoding="utf-8"))
    cats: dict[str, int] = {}
    for r in exp["roads"]:
        cats[r["category"]] = cats.get(r["category"], 0) + 1
    result["exported_roads"] = len(exp["roads"])
    result["exported_by_category"] = cats
    if do_cleanup:
        t = time.time()
        result["cleanup"] = cleanup(region)
        result["seconds"]["cleanup"] = round(time.time() - t)
    result["kept_out_bytes"] = dir_size(region.out_dir)
    (region.out_dir / "run.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(
        f"{region.name}: {result['total_seconds'] / 60:.1f} min ("
        + ", ".join(f"{k} {v / 60:.1f}" for k, v in result["seconds"].items())
        + f"); data folder peak +{result['peak_growth_bytes'] / 1e9:.2f} GB; {result['candidates']} candidates, "
        f"{result['drivers_roads']} driver's roads; kept {result['kept_out_bytes'] / 1e6:.0f} MB in {region.out_dir}"
    )
    return result
