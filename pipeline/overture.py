"""Buildings and places from Overture Maps, cut to a region's box.

    python -m pipeline overture --region ar

Overture buildings (ODbL, including Microsoft and Google footprints) are far
more complete than OpenStreetMap's rural buildings; `score` counts homes along
each road with them. Overture places (CDLA Permissive 2.0) add off-road parks
and race tracks as points.

Only the columns `score` reads are downloaded (for buildings, just the
bounding box), which keeps a whole state to tens of megabytes instead of
gigabytes. Files go to data/raw/overture/<region>/. Uses the `overturemaps`
package (pipeline/requirements.txt); if it is missing, this step is skipped
and `score` falls back to OpenStreetMap buildings.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from .config import Region

KINDS = {
    # name: (Overture type, columns score reads)
    "buildings": ("building", ["bbox"]),
    "places": ("place", ["names", "taxonomy", "confidence", "bbox"]),
}


def region_dir(region: Region) -> Path:
    return region.raw_dir / "overture" / region.slug


def path(region: Region, kind: str) -> Path | None:
    """The file `score` should read for this region, or None.

    Older runs saved one region's files straight in data/raw/overture/; those
    are used only when their saved box matches this region's box.
    """
    p = region_dir(region) / f"{kind}.parquet"
    if p.exists():
        return p
    legacy = region.raw_dir / "overture" / f"{kind}.parquet"
    state = legacy.with_name(legacy.name + ".state")
    if legacy.exists() and state.exists():
        try:
            b = json.loads(state.read_text(encoding="utf-8"))["bbox"]
            if [b["xmin"], b["ymin"], b["xmax"], b["ymax"]] == list(region.bbox):
                return legacy
        except (KeyError, TypeError, ValueError):
            pass
    return None


def download(region: Region, kinds=("places", "buildings")) -> bool:
    """Download what's missing. Returns False if the overturemaps package isn't installed."""
    try:
        import pyarrow.parquet as pq
        from overturemaps import core
    except ImportError as e:
        print(f"  overture: skipped ({e}); score will use OpenStreetMap buildings")
        return False
    if not hasattr(core, "_prepare_query"):
        print("  overture: skipped (this overturemaps version has no _prepare_query); score will use OpenStreetMap buildings")
        return False
    for kind in kinds:
        if path(region, kind) is not None:
            print(f"  overture {kind}: cached")
            continue
        otype, cols = KINDS[kind]
        t0 = time.time()
        release = core.get_latest_release()
        prepared = core._prepare_query(otype, tuple(region.bbox), release)
        dest = region_dir(region) / f"{kind}.parquet"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if prepared is None:
            table = None
        else:
            dataset, flt = prepared
            table = dataset.to_table(columns=cols, filter=flt, use_threads=True)
        if table is None:
            print(f"  overture {kind}: nothing in the box")
            continue
        part = dest.with_suffix(".part")
        pq.write_table(table, part, compression="zstd")
        part.replace(dest)
        meta = {"release": release, "type": otype, "columns": cols, "bbox": list(region.bbox), "rows": table.num_rows}
        dest.with_name(dest.name + ".state").write_text(json.dumps(meta), encoding="utf-8")
        print(f"  overture {kind}: {table.num_rows} rows, {dest.stat().st_size / 1e6:.0f} MB ({time.time() - t0:.0f}s)")
    return True
