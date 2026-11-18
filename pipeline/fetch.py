"""Download OpenStreetMap extracts and elevation tiles for a region.

Re-runnable: a file is downloaded again only when the server has a newer copy.
Downloads go to data/raw (untrusted data, never executed).
"""
from __future__ import annotations

import email.utils
import math
import os
import shutil
import urllib.error
import urllib.request
from pathlib import Path

from .config import Region

try:  # Use the operating system's certificate store (Python's own can be stale).
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass

USER_AGENT = "sunday-line-data-pipeline/0.1 (open source road scoring)"

USGS_1AS = (
    "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1/TIFF/current/"
    "{name}/USGS_1_{name}.tif"
)


def _download(url: str, dest: Path) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    if dest.exists():
        req.add_header(
            "If-Modified-Since",
            email.utils.formatdate(dest.stat().st_mtime, usegmt=True),
        )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            tmp = dest.with_suffix(dest.suffix + ".part")
            with tmp.open("wb") as out:
                shutil.copyfileobj(resp, out, length=1 << 20)
            lm = resp.headers.get("Last-Modified")
            os.replace(tmp, dest)
            if lm:
                ts = email.utils.parsedate_to_datetime(lm).timestamp()
                os.utime(dest, (ts, ts))
            return "downloaded"
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return "up to date"
        if e.code == 404:
            return "missing"
        raise


def dem_tile_names(bbox) -> list[str]:
    """USGS tiles are named by their north-west corner, e.g. n33w094."""
    w, s, e, n = bbox
    names = []
    for top in range(math.floor(s) + 1, math.ceil(n) + 1):
        for left in range(math.floor(w), math.ceil(e)):
            ns = f"n{top:02d}" if top >= 0 else f"s{-top:02d}"
            ew = f"w{-left:03d}" if left < 0 else f"e{left:03d}"
            names.append(ns + ew)
    return names


def osm_paths(region: Region) -> list[Path]:
    return [region.raw_dir / "osm" / url.rsplit("/", 1)[1] for url in region.osm_extracts]


def dem_paths(region: Region) -> list[Path]:
    return sorted((region.raw_dir / "dem").glob("*.tif"))


def fetch(region: Region) -> None:
    for url, path in zip(region.osm_extracts, osm_paths(region)):
        status = _download(url, path)
        print(f"osm  {path.name}: {status} ({path.stat().st_size / 1e6:.0f} MB)")
    if region.dem == "usgs_3dep_1as":
        for name in dem_tile_names(region.bbox):
            path = region.raw_dir / "dem" / f"USGS_1_{name}.tif"
            status = _download(USGS_1AS.format(name=name), path)
            size = f"{path.stat().st_size / 1e6:.0f} MB" if path.exists() else "-"
            print(f"dem  {name}: {status} ({size})")
    else:
        raise SystemExit(f"Unknown DEM source {region.dem!r}")
