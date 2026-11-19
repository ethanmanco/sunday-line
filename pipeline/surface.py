"""Paved or gravel? Read the road surface from aerial photos where the map doesn't say.

    python -m pipeline surface --region shreveport

Most rural roads here have no surface tag in OpenStreetMap, and many untagged
county roads are gravel. For each candidate road this samples small clips of
USDA NAIP aerial imagery (public domain, about 1 m per pixel, with an infrared
band) along the road, measures the color of the non-vegetated pixels at the
centerline (asphalt is dark gray, gravel is light tan or white), and trains a
classifier on the roads whose surface IS tagged in OpenStreetMap. It reports
its own cross-validated accuracy and writes a paved/unpaved probability for
every road to data/out/<region>/surface_pred.json, which `score` then uses.
"""
from __future__ import annotations

import argparse
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rasterio

from .config import REVIEW_DIR, load_region
from .fetch import USER_AGENT

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass

NAIP = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
HALF_DEG = 0.00012     # clip half-width in degrees of latitude (about 13 m)
SIZE = 24              # pixels per side, so about 1.1 m per pixel
POINTS_PER_ROAD = 6
FEATURES = ["bright", "red_blue", "green_blue", "ndvi", "bright_sd", "open_share", "usable_share"]


def clip(lon: float, lat: float) -> np.ndarray | None:
    dx = HALF_DEG / np.cos(np.radians(lat))
    q = urllib.parse.urlencode(dict(
        bbox=f"{lon - dx},{lat - HALF_DEG},{lon + dx},{lat + HALF_DEG}", bboxSR=4326,
        size=f"{SIZE},{SIZE}", format="tiff", pixelType="U8", compression="LZ77",
        interpolation="RSP_NearestNeighbor", f="image",
    ))
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{NAIP}?{q}", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
            with rasterio.MemoryFile(body) as mem, mem.open() as ds:
                if ds.count < 4:
                    return None
                return ds.read().astype(np.float32)
        except (urllib.error.URLError, TimeoutError, rasterio.errors.RasterioIOError):
            time.sleep(3 * (attempt + 1))
    return None


def point_features(a: np.ndarray) -> dict | None:
    """Color of the open (non-vegetated) ground at the center of a clip."""
    r, g, b, n = a
    yy, xx = np.mgrid[:SIZE, :SIZE]
    center = (yy - SIZE / 2 + 0.5) ** 2 + (xx - SIZE / 2 + 0.5) ** 2 <= 8 ** 2  # about 9 m radius
    ndvi = (n - r) / (n + r + 1e-6)
    bright = (r + g + b) / 3
    open_ground = center & (ndvi < 0.12) & (bright > 30)
    k = int(open_ground.sum())
    if k < 6:
        return None  # tree canopy or shadow over the road
    return {
        "bright": float(np.median(bright[open_ground])),
        "red_blue": float(np.median((r - b)[open_ground])),
        "green_blue": float(np.median((g - b)[open_ground])),
        "ndvi": float(np.median(ndvi[open_ground])),
        "bright_sd": float(np.std(bright[open_ground])),
        "open_share": k / float(center.sum()),
    }


def sample_points(coords: list, n: int) -> list[tuple[float, float]]:
    c = np.array(coords)
    seg = np.hypot(np.diff(c[:, 0]) * np.cos(np.radians(c[0, 1])), np.diff(c[:, 1]))
    cum = np.concatenate([[0], np.cumsum(seg)])
    # Skip the ends, where roads meet junctions.
    d = np.linspace(cum[-1] * 0.08, cum[-1] * 0.92, n)
    return [(float(np.interp(x, cum, c[:, 0])), float(np.interp(x, cum, c[:, 1]))) for x in d]


def road_features(points: list[dict | None]) -> dict | None:
    good = [p for p in points if p]
    if len(good) < 2:
        return None
    out = {k: float(np.median([p[k] for p in good])) for k in FEATURES if k != "usable_share"}
    out["usable_share"] = len(good) / len(points)
    return out


def label(props: dict, verdicts: dict) -> int | None:
    v = verdicts.get(props["id"], {}).get("verdict")
    if v == "gravel":
        return 1
    if v == "good":
        return 0
    shares = props.get("surface_shares") or {}
    if shares.get("paved", 0) >= 0.8:
        return 0
    if shares.get("unpaved", 0) >= 0.8:
        return 1
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="shreveport")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    region = load_region(args.region)
    cache_path = region.raw_dir / "naip" / f"points_{region.slug}.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    feats = json.loads((region.out_dir / "candidates.geojson").read_text(encoding="utf-8"))["features"]
    jobs = {}
    for f in feats:
        for lon, lat in sample_points(f["geometry"]["coordinates"], POINTS_PER_ROAD):
            key = f"{lon:.5f},{lat:.5f}"
            if key not in cache:
                jobs[key] = (lon, lat)
    print(f"{len(feats)} roads, {len(jobs)} new image clips to fetch ({len(cache)} cached)")

    def work(item):
        key, (lon, lat) = item
        a = clip(lon, lat)
        return key, (point_features(a) if a is not None else "missing")

    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(args.workers) as ex:
        for key, val in ex.map(work, jobs.items()):
            cache[key] = val
            done += 1
            if done % 500 == 0:
                cache_path.write_text(json.dumps(cache))
                rate = done / (time.time() - t0)
                print(f"  {done}/{len(jobs)} clips ({rate:.1f}/s, about {(len(jobs) - done) / rate / 60:.0f} min left)")
    cache_path.write_text(json.dumps(cache))

    vpath = REVIEW_DIR / "verdicts.json"
    verdicts = json.loads(vpath.read_text(encoding="utf-8")) if vpath.exists() else {}
    rows, ys, ids = [], [], []
    for f in feats:
        pts = [cache.get(f"{lon:.5f},{lat:.5f}") for lon, lat in sample_points(f["geometry"]["coordinates"], POINTS_PER_ROAD)]
        pts = [p if isinstance(p, dict) else None for p in pts]
        rf = road_features(pts)
        ids.append(f["properties"]["id"])
        rows.append(rf)
        ys.append(label(f["properties"], verdicts))

    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import StratifiedKFold, cross_val_predict
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    train = [i for i, (r, y) in enumerate(zip(rows, ys)) if r is not None and y is not None]
    X = np.array([[rows[i][k] for k in FEATURES] for i in train])
    y = np.array([ys[i] for i in train])
    print(f"training roads with a surface tag and usable imagery: {len(y)} ({int(y.sum())} unpaved, {int((1 - y).sum())} paved)")
    cv = StratifiedKFold(5, shuffle=True, random_state=1)
    models = {
        "logistic": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced")),
        "boosted trees": GradientBoostingClassifier(random_state=1),
    }
    best, best_name, best_score = None, None, -1
    for name, m in models.items():
        p = cross_val_predict(m, X, y, cv=cv, method="predict_proba")[:, 1]
        pred = p >= 0.5
        acc = (pred == y).mean()
        tp = ((pred == 1) & (y == 1)).sum()
        prec = tp / max(pred.sum(), 1)
        rec = tp / max(y.sum(), 1)
        print(f"  {name}: accuracy {acc:.0%}, gravel caught {rec:.0%} (recall), flagged-as-gravel correct {prec:.0%} (precision)")
        bal = (rec + ((pred == 0) & (y == 0)).sum() / max((1 - y).sum(), 1)) / 2
        if bal > best_score:
            best, best_name, best_score = m, name, bal
    best.fit(X, y)
    out = {}
    for rid, rf in zip(ids, rows):
        if rf is None:
            out[rid] = {"p_unpaved": None, "usable_share": 0.0}
            continue
        p = float(best.predict_proba(np.array([[rf[k] for k in FEATURES]]))[0, 1])
        out[rid] = {"p_unpaved": round(p, 3), "usable_share": round(rf["usable_share"], 2)}
    meta = {"model": best_name, "balanced_accuracy": round(best_score, 3), "training_roads": len(y),
            "source": "USDA NAIP via USGS The National Map (public domain)"}
    (region.out_dir / "surface_pred.json").write_text(json.dumps({"meta": meta, "roads": out}), encoding="utf-8")
    print(f"used {best_name}; wrote predictions for {len(out)} roads")


if __name__ == "__main__":
    main()
