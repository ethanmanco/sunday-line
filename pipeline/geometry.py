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

    Returns (vertex distances along the original line, segment lengths, segment weights).
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
    return d_orig, lens, w


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
