"""Join OpenStreetMap ways into continuous roads.

Ways join end to end when they carry the same route number (or, without one,
the same name) and the join is the straightest continuation at that node.
Roundabouts and one-way city streets are left out. One-way halves of divided
highways chain separately; build.py drops the second half of each pair.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

import numpy as np

MAX_DEFLECTION_DEG = 120


def road_key(tags: dict, highway: str):
    ref = tags.get("ref", "").split(";")[0].strip()
    if ref:
        return ("ref", ref)
    name = tags.get("name", "").strip()
    if name:
        return ("name", name)
    return None


@dataclass
class Chain:
    way_ids: list[int]
    nodes: np.ndarray        # node ids along the chain
    lonlat: np.ndarray       # (n, 2)
    seg_way: np.ndarray      # way id for each segment (n - 1)


# Divided highways (interstates, expressways) are mapped as two one-way
# halves. Their halves chain on their own; build.py keeps one of each pair.
DIVIDED = {"motorway", "trunk", "primary", "secondary"}


def is_oneway(way) -> bool:
    return way["tags"].get("oneway") in ("yes", "1", "-1", "true")


def _usable(way) -> bool:
    t = way["tags"]
    if is_oneway(way) and way["highway"] not in DIVIDED:
        return False  # one-way city street pairs would show up twice
    if t.get("junction") in ("roundabout", "circular"):
        return False
    return len(way["nodes"]) >= 2


def build_chains(ways: dict, xy_of) -> list[Chain]:
    """xy_of(way_id) -> projected (n, 2) coordinates for that way."""
    usable = {wid: w for wid, w in ways.items() if _usable(w)}
    keys = {wid: road_key(w["tags"], w["highway"]) for wid, w in usable.items()}

    ends = defaultdict(list)  # node id -> [(wid, end)]  end 0 = start, 1 = end
    for wid, w in usable.items():
        ends[int(w["nodes"][0])].append((wid, 0))
        ends[int(w["nodes"][-1])].append((wid, 1))

    def leave_dir(wid, end):
        xy = xy_of(wid)
        if end == 0:
            a, b = xy[0], xy[min(3, len(xy) - 1)]
        else:
            a, b = xy[-1], xy[max(-4, -len(xy))]
        d = b - a
        n = np.hypot(*d)
        return d / n if n else d

    link = {}
    for node, lst in ends.items():
        if len(lst) < 2:
            continue
        by_key = defaultdict(list)
        for item in lst:
            by_key[keys[item[0]]].append(item)
        for key, items in by_key.items():
            if len(items) < 2:
                continue
            dirs = {it: leave_dir(*it) for it in items}
            pairs = []
            for i in range(len(items)):
                for j in range(i + 1, len(items)):
                    a, b = items[i], items[j]
                    if a[0] == b[0]:
                        continue  # a closed way meeting itself
                    # Straight continuation: leaving directions point opposite ways.
                    cosang = float(np.dot(dirs[a], dirs[b]))
                    deflection = 180 - np.degrees(np.arccos(np.clip(cosang, -1, 1)))
                    pairs.append((deflection, a, b))
            pairs.sort(key=lambda p: p[0])
            used = set()
            for deflection, a, b in pairs:
                if deflection > MAX_DEFLECTION_DEG or a in used or b in used:
                    continue
                used.add(a)
                used.add(b)
                link[a] = b
                link[b] = a

    chains = []
    visited = set()

    def walk(start_wid, start_end):
        # Enter the way at start_end and travel to the other end.
        seq = []
        wid, end = start_wid, start_end
        while wid not in visited:
            visited.add(wid)
            seq.append((wid, end == 1))  # reversed if entering at its end
            other = (wid, 1 - end)
            nxt = link.get(other)
            if nxt is None:
                break
            wid, end = nxt
        return seq

    # Start from open ends first, then whatever is left (closed loops).
    starts = [(wid, end) for wid in usable for end in (0, 1) if (wid, end) not in link]
    for wid, end in starts:
        if wid in visited:
            continue
        chains.append(walk(wid, end))
    for wid in usable:
        if wid not in visited:
            chains.append(walk(wid, 0))

    out = []
    for seq in chains:
        nodes, coords, seg_way = [], [], []
        for wid, rev in seq:
            w = usable[wid]
            n = w["nodes"][::-1] if rev else w["nodes"]
            c = w["lonlat"][::-1] if rev else w["lonlat"]
            if nodes:
                n, c = n[1:], c[1:]
                seg_way.extend([wid] * len(n))       # each new vertex closes a segment
            else:
                seg_way.extend([wid] * (len(n) - 1))
            nodes.extend(n.tolist())
            coords.extend(c.tolist())
        out.append(
            Chain(
                way_ids=[wid for wid, _ in seq],
                nodes=np.array(nodes, dtype=np.int64),
                lonlat=np.array(coords),
                seg_way=np.array(seg_way, dtype=np.int64),
            )
        )
    return out
