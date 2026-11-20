"""Road facts from the federal Highway Performance Monitoring System (HPMS).

    python -m pipeline hpms --region shreveport
    python -m pipeline hpms --region ar

Each state DOT reports its roads to the Federal Highway Administration every
year: who maintains each road, its functional class, surface type, posted
speed limit, traffic, lane width, shoulders, and (on sampled roads) measured
roughness (IRI). FHWA publishes it as public domain data at geo.dot.gov.

This downloads the sections inside the region's box, for each of the region's
states, and caches them under data/raw/hpms/. `score` then matches them to candidate roads.
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.parse
import urllib.request

from .config import Region, load_region
from .fetch import USER_AGENT

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass

YEAR = 2024
SERVICE = "https://geo.dot.gov/server/rest/services/Hosted/HPMS_FULL_{st}_{year}/FeatureServer/0/query"
FIELDS = [
    "f_system", "ownership", "surface_type", "iri", "speed_limit", "aadt",
    "through_lanes", "lane_width", "shoulder_type", "routesigning", "routenumber",
]
PAGE = 2000
# Pages fetched at once. The server is public and returns errors when busy
# (Virginia and Pennsylvania failed at 6), so keep this low.
WORKERS = 3

# HPMS Field Manual code tables (only the values we use).
OWNER_STATE = {1}                 # State Highway Agency
OWNER_COUNTY = {2}                # County Highway Agency
OWNER_CITY = {3, 4}               # Town or township, city or municipal
SURFACE_UNPAVED = {1}             # 1 = unpaved


def _get(url: str) -> dict:
    for attempt in range(9):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.load(resp)
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
            wait = min(120, 10 * 2 ** attempt)  # 10 s, 20 s, 40 s, ... up to 2 minutes
            print(f"    retry {attempt + 1} in {wait}s: {e}")
            time.sleep(wait)
    raise RuntimeError(f"HPMS request failed: {url[:120]}")


def cache_path(region: Region, st: str):
    return region.raw_dir / "hpms" / f"{st}_{YEAR}_{region.slug}.geojson"


def download(region: Region, states: list[str] | None = None) -> None:
    """Federal road sections for `states` (postal codes; default: the region's states)."""
    if states is None:
        states = region.state_codes
    if not states:
        print("  hpms: region lists no US states; skipped")
        return
    w, s, e, n = region.bbox
    for st in states:
        dest = cache_path(region, st)
        if dest.exists():
            print(f"  {st}: cached")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        base = dict(
            where="1=1", geometry=f"{w},{s},{e},{n}", geometryType="esriGeometryEnvelope",
            inSR=4326, spatialRel="esriSpatialRelIntersects",
        )
        url = SERVICE.format(st=st, year=YEAR)
        count = _get(url + "?" + urllib.parse.urlencode({**base, "returnCountOnly": "true", "f": "json"})).get("count")
        if not isinstance(count, int):
            raise RuntimeError(f"HPMS {st}: no section count")

        def page(offset: int) -> list:
            q = dict(
                base, outSR=4326, outFields=",".join(FIELDS), returnGeometry="true", geometryPrecision=6,
                orderByFields="objectid", resultOffset=offset, resultRecordCount=PAGE, f="geojson",
            )
            d = _get(url + "?" + urllib.parse.urlencode(q))
            return [f for f in d.get("features", []) if f.get("geometry")]

        offsets = list(range(0, count, PAGE))
        print(f"  {st}: {count} sections in {len(offsets)} pages")
        feats: list = []
        with ThreadPoolExecutor(WORKERS) as pool:
            for i, batch in enumerate(pool.map(page, offsets), 1):
                feats += batch
                if i % 20 == 0:
                    print(f"  {st}: {len(feats)} sections")
        part = dest.with_suffix(".part")
        part.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
        part.replace(dest)
        print(f"  {st}: {len(feats)} sections saved")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="shreveport")
    args = ap.parse_args()
    region = load_region(args.region)
    download(region)


if __name__ == "__main__":
    main()
