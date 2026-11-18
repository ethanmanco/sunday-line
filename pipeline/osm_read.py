"""Read OpenStreetMap extracts and keep what road scoring needs.

Everything is clipped to the region's bounding box while reading, and objects
that appear in more than one state extract are de-duplicated by id.
"""
from __future__ import annotations

import gc
import os
import time
from array import array
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import osmium
import shapely

# Roads that can become candidates.
ELIGIBLE = {"primary", "secondary", "tertiary", "unclassified"}

# Roads that count as an interruption where they meet a candidate.
# Service roads (driveways, parking aisles) and tracks are left out on purpose.
DRIVABLE = ELIGIBLE | {
    "motorway", "trunk", "residential", "living_street",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}

NO_ACCESS = {"private", "no"}

KEEP_TAGS = (
    "name", "ref", "surface", "maxspeed", "source:maxspeed", "lanes",
    "bridge", "tunnel", "scenic", "oneway", "junction",
)

SIGNAL_KINDS = {
    ("highway", "stop"): "stop",
    ("highway", "traffic_signals"): "signals",
    ("highway", "give_way"): "yield",
    ("railway", "level_crossing"): "rail",
}

PLACE_KINDS = {"city", "town", "village", "hamlet"}


def scenery_kind(tags) -> str | None:
    lu = tags.get("landuse")
    nat = tags.get("natural")
    if lu == "forest" or nat == "wood":
        return "forest"
    if nat in ("water", "bay") or lu == "reservoir" or tags.get("waterway") == "riverbank":
        return "water"
    if nat == "wetland":
        return "wetland"
    if (
        tags.get("boundary") in ("protected_area", "national_park")
        or tags.get("leisure") == "nature_reserve"
    ):
        return "protected"
    return None


def _polygon_from_lines(lines):
    if not lines:
        return None
    merged = shapely.line_merge(shapely.union_all(lines))
    polys = shapely.get_parts(shapely.polygonize(shapely.get_parts(merged)))
    if len(polys) == 0:
        return None
    return shapely.union_all(polys)


@dataclass
class OsmData:
    ways: dict = field(default_factory=dict)          # id -> dict(nodes, lonlat, tags, highway)
    drivable_refs: array = field(default_factory=lambda: array("q"))
    signals: dict = field(default_factory=dict)       # node id -> (kind, tags)
    places: dict = field(default_factory=dict)        # node id -> (name, kind, lon, lat)
    scenery: dict = field(default_factory=dict)       # (kind, area id) -> shapely geom (lon/lat)
    rivers: dict = field(default_factory=dict)        # way id -> shapely LineString
    byway_members: set = field(default_factory=set)   # way ids in scenic byway routes
    byway_names: dict = field(default_factory=dict)   # way id -> route name


def read_extracts(paths: list[Path], bbox, tmp_dir: Path) -> OsmData:
    w, s, e, n = bbox
    pad = 0.2  # first-node prefilter margin, degrees
    box = shapely.box(w, s, e, n)
    data = OsmData()
    seen_drivable: set[int] = set()
    wkb = osmium.geom.WKBFactory()
    tmp_dir.mkdir(parents=True, exist_ok=True)
    boundary_rels: dict[int, tuple] = {}
    rels_in_file: dict[Path, list[int]] = {}

    def inside(lon, lat):
        return w <= lon <= e and s <= lat <= n

    for path in paths:
        t0 = time.time()
        cache = tmp_dir / f"{path.stem}.{os.getpid()}.nodecache"
        for old in tmp_dir.glob(f"{path.stem}.*.nodecache"):
            try:
                old.unlink()
            except PermissionError:
                pass
        fp = (
            osmium.FileProcessor(str(path))
            .with_locations(f"sparse_file_array,{cache}")
            .with_areas(osmium.filter.KeyFilter("landuse", "natural", "boundary", "leisure", "waterway"))
            .with_filter(
                osmium.filter.KeyFilter(
                    "highway", "landuse", "natural", "waterway", "boundary",
                    "leisure", "railway", "route", "place",
                )
            )
        )
        counts = {"ways": 0, "areas": 0, "nodes": 0}
        for obj in fp:
            if obj.is_node():
                tags = obj.tags
                loc = obj.location
                if not loc.valid() or not inside(loc.lon, loc.lat):
                    continue
                for (k, v), kind in SIGNAL_KINDS.items():
                    if tags.get(k) == v:
                        data.signals[obj.id] = (kind, {"stop": tags.get("stop", "")})
                        counts["nodes"] += 1
                        break
                place = tags.get("place")
                if place in PLACE_KINDS and "name" in tags:
                    data.places[obj.id] = (tags["name"], place, loc.lon, loc.lat)

            elif obj.is_way():
                tags = obj.tags
                hw = tags.get("highway")
                if hw in DRIVABLE:
                    nodes = obj.nodes
                    first = nodes[0].location
                    if not first.valid() or not (
                        w - pad <= first.lon <= e + pad and s - pad <= first.lat <= n + pad
                    ):
                        continue
                    refs = []
                    coords = []
                    for nd in nodes:
                        loc = nd.location
                        if loc.valid():
                            refs.append(nd.ref)
                            coords.append((loc.lon, loc.lat))
                    if len(refs) < 2 or not any(inside(x, y) for x, y in coords):
                        continue
                    if obj.id not in seen_drivable:
                        seen_drivable.add(obj.id)
                        data.drivable_refs.extend(refs)
                        data.drivable_refs.extend(refs[1:-1])  # interior nodes count twice
                    if (
                        hw in ELIGIBLE
                        and tags.get("access") not in NO_ACCESS
                        and tags.get("area") != "yes"
                        and obj.id not in data.ways
                    ):
                        data.ways[obj.id] = {
                            "highway": hw,
                            "nodes": np.array(refs, dtype=np.int64),
                            "lonlat": np.array(coords, dtype=np.float64),
                            "tags": {k: tags[k] for k in KEEP_TAGS if k in tags},
                        }
                        counts["ways"] += 1
                elif tags.get("waterway") == "river" and obj.id not in data.rivers:
                    coords = [
                        (nd.location.lon, nd.location.lat)
                        for nd in obj.nodes
                        if nd.location.valid()
                    ]
                    if len(coords) >= 2:
                        line = shapely.LineString(coords)
                        if line.intersects(box):
                            data.rivers[obj.id] = line

            elif obj.is_relation():
                tags = obj.tags
                if (
                    tags.get("type") == "boundary"
                    and scenery_kind(tags) == "protected"
                    and obj.id not in boundary_rels
                ):
                    # The area builder only handles type=multipolygon; national
                    # forests are usually type=boundary, so build these ourselves.
                    outer = [m.ref for m in obj.members if m.type == "w" and m.role != "inner"]
                    inner = [m.ref for m in obj.members if m.type == "w" and m.role == "inner"]
                    boundary_rels[obj.id] = (tags.get("name", ""), outer, inner)
                    rels_in_file.setdefault(path, []).append(obj.id)
                elif tags.get("type") == "route" and tags.get("route") == "road":
                    label = " ".join(
                        tags.get(k, "") for k in ("name", "network", "description")
                    ).lower()
                    if "scenic" in label or "byway" in label:
                        name = tags.get("name", "Scenic byway")
                        for m in obj.members:
                            if m.type == "w":
                                data.byway_members.add(m.ref)
                                data.byway_names.setdefault(m.ref, name)

            elif obj.is_area():
                kind = scenery_kind(obj.tags)
                if kind is None:
                    continue
                key = (kind, obj.id)
                if key in data.scenery:
                    continue
                try:
                    geom = shapely.from_wkb(wkb.create_multipolygon(obj))
                except Exception:
                    continue
                if geom.intersects(box):
                    data.scenery[key] = geom
                    counts["areas"] += 1
        # Release the reader so Windows lets go of the node cache file.
        del fp
        obj = None
        gc.collect()
        try:
            cache.unlink(missing_ok=True)
        except PermissionError:
            pass  # removed on the next run
        print(
            f"read {path.name}: {counts['ways']} candidate ways, {counts['areas']} scenery areas, "
            f"{counts['nodes']} signs/signals ({time.time() - t0:.0f}s)"
        )

    # Second pass: geometry for protected areas mapped as type=boundary relations.
    for path, rel_ids in rels_in_file.items():
        t0 = time.time()
        want = set()
        for rid in rel_ids:
            _, outer, inner = boundary_rels[rid]
            want.update(outer)
            want.update(inner)
        lines = {}
        cache = tmp_dir / f"{path.stem}.{os.getpid()}.b.nodecache"
        fp = (
            osmium.FileProcessor(str(path), osmium.osm.NODE | osmium.osm.WAY)
            .with_locations(f"sparse_file_array,{cache}")
            .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
            .with_filter(osmium.filter.IdFilter(want))
        )
        for obj in fp:
            coords = [(nd.location.lon, nd.location.lat) for nd in obj.nodes if nd.location.valid()]
            if len(coords) >= 2:
                lines[obj.id] = shapely.LineString(coords)
        del fp
        obj = None
        gc.collect()
        try:
            cache.unlink(missing_ok=True)
        except PermissionError:
            pass
        built = 0
        for rid in rel_ids:
            name, outer, inner = boundary_rels[rid]
            geom = _polygon_from_lines([lines[i] for i in outer if i in lines])
            holes = _polygon_from_lines([lines[i] for i in inner if i in lines])
            if geom is None:
                continue
            if holes is not None:
                geom = geom.difference(holes)
            if geom.intersects(box):
                data.scenery[("protected", rid * 2 + 1)] = geom
                built += 1
        print(f"protected boundaries from {path.name}: {built} of {len(rel_ids)} built ({time.time() - t0:.0f}s)")

    # Scenic tag on ways counts like a byway.
    for wid, way in data.ways.items():
        if way["tags"].get("scenic") == "yes":
            data.byway_members.add(wid)
    return data
