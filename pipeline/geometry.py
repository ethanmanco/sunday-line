"""Pure geometry helpers for curvature scoring. All inputs are in meters.

Approach (after the published method of the Curvature project, independently
implemented): the radius at each vertex is the radius of the circle through it
and its two neighbors; each segment takes the tighter radius of its two ends
and its length is weighted by how tight that radius is. Straights weigh zero.
"""
from __future__ import annotations

import numpy as np


def seg_lengths(xy: np.ndarray) -> np.ndarray:
    return np.hypot(*np.diff(xy, axis=0).T)


def cumulative(xy: np.ndarray) -> np.ndarray:
    return np.concatenate([[0.0], np.cumsum(seg_lengths(xy))])


def simplify_indices(xy: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker returning the indices of kept vertices (endpoints kept)."""
    n = len(xy)
    if n <= 2:
        return np.arange(n)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = xy[a], xy[b]
        d = q - p
        L = np.hypot(*d)
        pts = xy[a + 1 : b]
        if L == 0:
            dist = np.hypot(*(pts - p).T)
        else:
            dist = np.abs(d[0] * (pts[:, 1] - p[1]) - d[1] * (pts[:, 0] - p[0])) / L
        i = int(np.argmax(dist))
        if dist[i] > tol:
            k = a + 1 + i
            keep[k] = True
            stack.append((a, k))
            stack.append((k, b))
    return np.flatnonzero(keep)


def merge_close(xy: np.ndarray, idx: np.ndarray, min_d: float) -> np.ndarray:
    """Drop vertices closer than min_d to the previous kept one (last always kept)."""
    out = [idx[0]]
    for i in idx[1:-1]:
        if np.hypot(*(xy[i] - xy[out[-1]])) >= min_d:
            out.append(i)
    if len(idx) > 1:
        if len(out) > 1 and np.hypot(*(xy[idx[-1]] - xy[out[-1]])) < min_d:
            out[-1] = idx[-1]
        else:
            out.append(idx[-1])
    return np.array(out)


def vertex_radii(xy: np.ndarray) -> np.ndarray:
    """Circumradius at each interior vertex; endpoints get infinity."""
    n = len(xy)
    r = np.full(n, np.inf)
    if n < 3:
        return r
    a = xy[:-2]
    b = xy[1:-1]
    c = xy[2:]
    ab = np.hypot(*(b - a).T)
    bc = np.hypot(*(c - b).T)
    ca = np.hypot(*(a - c).T)
    cross = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    area2 = np.abs(cross)  # twice the triangle area
    with np.errstate(divide="ignore", invalid="ignore"):
        rr = ab * bc * ca / (2.0 * area2)
    rr[~np.isfinite(rr)] = np.inf
    r[1:-1] = rr
    return r


def segment_weights(xy: np.ndarray, bands: list[dict], min_span: float) -> tuple[np.ndarray, np.ndarray]:
    """Return (segment lengths, segment weights)."""
    lens = seg_lengths(xy)
    if len(lens) == 0:
        return lens, lens
    r = vertex_radii(xy)
    seg_r = np.minimum(r[:-1], r[1:])
    w = np.zeros(len(lens))
    for band in sorted(bands, key=lambda b: -b["max_radius_m"]):
        w[seg_r < band["max_radius_m"]] = band["weight"]
    # A curve has to cover a little road; tiny jogs do not count.
    i = 0
    while i < len(w):
        if w[i] > 0:
            j = i
            while j < len(w) and w[j] > 0:
                j += 1
            if lens[i:j].sum() < min_span:
                w[i:j] = 0
            i = j
        else:
            i += 1
    return lens, w


def resample_line(xy: np.ndarray, step: float) -> tuple[np.ndarray, np.ndarray]:
    """Points every `step` meters along the line. Returns (distances, points)."""
    cum = cumulative(xy)
    n = max(2, int(round(cum[-1] / step)) + 1)
    d = np.linspace(0, cum[-1], n)
    return d, np.column_stack([np.interp(d, cum, xy[:, 0]), np.interp(d, cum, xy[:, 1])])


def radii_at_scale(xy: np.ndarray, k: int) -> np.ndarray:
    """Radius at each point from the circle through the points k steps before and after.

    Measuring across a fixed distance, instead of between immediate neighbors,
    keeps small mapping wobbles from looking like tight corners.
    """
    n = len(xy)
    r = np.full(n, np.inf)
    if n < 2 * k + 1:
        return r
    a, b, c = xy[: n - 2 * k], xy[k : n - k], xy[2 * k :]
    ab = np.hypot(*(b - a).T)
    bc = np.hypot(*(c - b).T)
    ca = np.hypot(*(a - c).T)
    cross = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    with np.errstate(divide="ignore", invalid="ignore"):
        rr = ab * bc * ca / (2.0 * np.abs(cross))
    rr[~np.isfinite(rr)] = np.inf
    r[k : n - k] = rr
    return r


def curvature_profile(xy: np.ndarray, cfg: dict, bands: list[dict]):
    """Weighted curvature along a line.

    Returns (resampled point distances along the original line, segment lengths,
    segment weights, radius at each resampled point).
    """
    cum = cumulative(xy)
    idx = simplify_indices(xy, cfg["simplify_tolerance_m"])
    sxy = xy[idx]
    scum = cumulative(sxy)
    d, rxy = resample_line(sxy, cfg["resample_step_m"])
    r = radii_at_scale(rxy, cfg["radius_offset_steps"])
    lens = seg_lengths(rxy)
    seg_r = np.minimum(r[:-1], r[1:])
    w = np.zeros(len(lens))
    for band in sorted(bands, key=lambda b: -b["max_radius_m"]):
        w[seg_r < band["max_radius_m"]] = band["weight"]
    i = 0
    while i < len(w):
        if w[i] > 0:
            j = i
            while j < len(w) and w[j] > 0:
                j += 1
            if lens[i:j].sum() < cfg["min_curve_span_m"]:
                w[i:j] = 0
            i = j
        else:
            i += 1
    d_orig = np.interp(d, scum, cum[idx])
    return d_orig, lens, w, r, turn_sign(rxy, cfg["radius_offset_steps"])


def turn_sign(xy: np.ndarray, k: int) -> np.ndarray:
    """+1 turning left, -1 turning right, 0 straight or at the ends."""
    n = len(xy)
    s = np.zeros(n)
    if n < 2 * k + 1:
        return s
    a, b, c = xy[: n - 2 * k], xy[k : n - k], xy[2 * k :]
    cross = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    s[k : n - k] = np.sign(cross)
    return s


G = 9.81


def speed_trace(r: np.ndarray, step: float, v_limit: np.ndarray, a_lat: float, a_acc: float, a_brake: float):
    """Speed along the road for a driver who never exceeds the limit.

    The same quasi-steady method lap-time simulators use: each point's speed is
    capped by the speed limit and by the curve (v = sqrt(a_lat * R)); a forward
    pass limits acceleration and a backward pass limits braking.
    Speeds in m/s, accelerations in m/s^2. Returns (speed, lateral acceleration in g).
    """
    with np.errstate(invalid="ignore"):
        v_curve = np.sqrt(a_lat * r)
    vmax = np.minimum(v_limit, v_curve)
    v = vmax.copy()
    for i in range(1, len(v)):
        v[i] = min(v[i], np.sqrt(v[i - 1] ** 2 + 2 * a_acc * step))
    for i in range(len(v) - 2, -1, -1):
        v[i] = min(v[i], np.sqrt(v[i + 1] ** 2 + 2 * a_brake * step))
    with np.errstate(divide="ignore", invalid="ignore"):
        lat = np.where(np.isfinite(r), v**2 / r, 0.0) / G
    return v, lat


def trace_metrics(v: np.ndarray, lat: np.ndarray, r: np.ndarray, step: float, signed_turn: np.ndarray, cfg: dict) -> dict:
    """Track-style measures of how hard a road works a car."""
    seg_v = (v[:-1] + v[1:]) / 2
    seg_lat = (lat[:-1] + lat[1:]) / 2
    seg_t = step / np.maximum(seg_v, 0.5)
    total_t = seg_t.sum()
    length_km = step * len(seg_v) / 1000
    # Time-weighted average cornering load, like a g-g trace from a data logger.
    mean_lat = float((seg_lat * seg_t).sum() / total_t)
    # Share of time spent cornering hard enough to feel it.
    hard_share = float(seg_t[seg_lat >= cfg["working_g"]].sum() / total_t)
    # Braking zones: total speed scrubbed per km (m/s per km).
    dv = np.diff(v)
    braking = float(-dv[dv < 0].sum() / max(length_km, 1e-6))
    # Direction changes between loaded corners (esses), per km.
    loaded = (lat >= cfg["working_g"]) & (signed_turn != 0)
    signs = np.sign(signed_turn[loaded])
    transitions = int((np.diff(signs) != 0).sum()) if len(signs) > 1 else 0
    return {
        "mean_lat_g": mean_lat,
        "hard_share": hard_share,
        "braking_ms_per_km": braking,
        "transitions_per_km": transitions / max(length_km, 1e-6),
        "avg_speed_ms": float(step * len(seg_v) / total_t),
    }


def split_at_straights(lens: np.ndarray, w: np.ndarray, split_len: float) -> list[tuple[int, int]]:
    """Split a road at straights at least split_len long.

    Returns (first_vertex, last_vertex) index pairs into the simplified line.
    """
    pieces = []
    start = 0
    i = 0
    n = len(lens)
    while i < n:
        if w[i] == 0:
            j = i
            while j < n and w[j] == 0:
                j += 1
            if lens[i:j].sum() >= split_len:
                if i > start:
                    pieces.append((start, i))
                start = j
            i = j
        else:
            i += 1
    if n > start:
        pieces.append((start, n))
    return pieces


def saturate(x: float, scale: float) -> float:
    return 100.0 * (1.0 - np.exp(-x / scale))


def decay(x: float, scale: float) -> float:
    return 100.0 * np.exp(-x / scale)
