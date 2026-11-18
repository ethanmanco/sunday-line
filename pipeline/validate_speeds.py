"""Internal accuracy check: our speed limits vs state DOT speed-limit data.

    python -m pipeline.validate_speeds --region shreveport

The DOT data is read for comparison only. Its terms do not allow
redistribution, so it is cached in data/raw/validation (never committed) and
nothing from it is written into candidates or the app. Only summary accuracy
numbers are printed.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from collections import Counter

import numpy as np
import shapely
from pyproj import Transformer
from shapely.strtree import STRtree

from .build import utm_epsg
from .config import load_region
from .fetch import USER_AGENT

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass

SOURCES = {
    "Texas": ("https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Speed_Limits/FeatureServer/0", "SPD_LMT"),
    "Louisiana": ("https://maps.dotd.la.gov/gdw/rest/services/RAOV/SpeedLimits/FeatureServer/0", "SpeedLimit"),
}


def fetch_layer(state, url, field, bbox, cache_dir):
    path = cache_dir / f"{state.lower()}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({
            "geometry": ",".join(map(str, bbox)), "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects", "outFields": field, "outSR": 4326,
            "resultOffset": offset, "resultRecordCount": 1000, "f": "json",
        })
        req = urllib.request.Request(f"{url}/query?{q}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as resp:
            d = json.load(resp)
        batch = d.get("features", [])
        feats += [{"v": f["attributes"][field], "paths": f["geometry"]["paths"]} for f in batch if f.get("geometry")]
        if not d.get("exceededTransferLimit") and len(batch) < 1000:
            break
        offset += len(batch)
        time.sleep(1)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(feats), encoding="utf-8")
    return feats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="shreveport")
    args = ap.parse_args()
    region = load_region(args.region)
    cx = (region.bbox[0] + region.bbox[2]) / 2
    cy = (region.bbox[1] + region.bbox[3]) / 2
    tr = Transformer.from_crs(4326, utm_epsg(cx, cy), always_xy=True)
    roads = [f["properties"] | {"coords": f["geometry"]["coordinates"]} for f in
             json.loads((region.out_dir / "candidates.geojson").read_text(encoding="utf-8"))["features"]]

    for state, (url, field) in SOURCES.items():
        feats = fetch_layer(state, url, field, region.bbox, region.raw_dir / "validation")
        lines, vals = [], []
        for f in feats:
            try:
                v = int(float(f["v"]))
            except (TypeError, ValueError):
                continue
            for path in f["paths"]:
                p = np.array(path)
                x, y = tr.transform(p[:, 0], p[:, 1])
                lines.append(shapely.LineString(np.column_stack([x, y])))
                vals.append(v)
        tree = STRtree(lines)
        stats = Counter()
        diffs = []
        for r in roads:
            if r["state"] != state:
                continue
            c = np.array(r["coords"])
            x, y = tr.transform(c[:, 0], c[:, 1])
            idx = np.linspace(0, len(c) - 1, min(len(c), 12)).astype(int)
            pts = shapely.points(np.column_stack([x[idx], y[idx]]))
            hits = tree.query(pts, predicate="dwithin", distance=15)
            if hits.shape[1] < len(idx) * 0.6:
                continue  # not on a road the DOT layer covers
            dot = Counter(vals[j] for j in hits[1])
            dot_v = dot.most_common(1)[0][0]
            ours = r["speed_min"]
            kind = "posted (OSM)" if r["speed_source"] == "posted" else "state default"
            stats[(kind, "total")] += 1
            stats[(kind, "match")] += int(ours == dot_v)
            stats[(kind, "ours_higher")] += int(ours > dot_v)
            stats[(kind, "gate_agrees")] += int((ours >= 40) == (dot_v >= 40))
            diffs.append((kind, ours - dot_v))
        print(f"\n{state}: {len(lines)} DOT speed segments in the region")
        for kind in ("posted (OSM)", "state default"):
            n = stats[(kind, "total")]
            if not n:
                continue
            d = np.array([x for k, x in diffs if k == kind])
            print(
                f"  {kind}: {n} candidate roads matched. Exact match {stats[(kind, 'match')] / n:.0%}, "
                f"ours higher {stats[(kind, 'ours_higher')] / n:.0%} (median gap {np.median(d):+.0f} mph), "
                f"40 mph gate agrees {stats[(kind, 'gate_agrees')] / n:.0%}"
            )


if __name__ == "__main__":
    main()
