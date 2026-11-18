"""Forest and water cover from ESA WorldCover 10 m (2021, CC BY 4.0).

The region is read once into a coarser grid (3 x 3 pixels, about 25 to 30 m)
holding the share of each cell that is tree cover, open water, or wetland.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

TREE = 10
WATER = 80
WETLAND = (90, 95)   # herbaceous wetland, mangroves
BUILT = 50           # built-up: buildings, pavement
NATIVE = 1 / 12000   # WorldCover pixel size, degrees
BLOCK = 3


class Landcover:
    def __init__(self, tile_dir: Path, bbox):
        w, s, e, n = bbox
        self.cell = NATIVE * BLOCK
        self.w, self.n = w, n
        cols = int(math.ceil((e - w) / self.cell))
        rows = int(math.ceil((n - s) / self.cell))
        self.tree = np.zeros((rows, cols), np.float32)
        self.water = np.zeros((rows, cols), np.float32)
        self.wetland = np.zeros((rows, cols), np.float32)
        self.built = np.zeros((rows, cols), np.float32)
        self.covered = False
        for path in sorted(tile_dir.glob("ESA_WorldCover_10m_2021_v200_*_Map.tif")):
            self._add(path, bbox)

    def _add(self, path: Path, bbox):
        w, s, e, n = bbox
        with rasterio.open(path) as ds:
            b = ds.bounds
            ix_w, ix_s = max(w, b.left), max(s, b.bottom)
            ix_e, ix_n = min(e, b.right), min(n, b.top)
            if ix_w >= ix_e or ix_s >= ix_n:
                return
            win = from_bounds(ix_w, ix_s, ix_e, ix_n, ds.transform).round_offsets().round_lengths()
            arr = ds.read(1, window=win)
            tr = ds.window_transform(win)
        self.covered = True
        h = arr.shape[0] // BLOCK * BLOCK
        wd = arr.shape[1] // BLOCK * BLOCK
        arr = arr[:h, :wd]

        def frac(mask):
            return mask.reshape(h // BLOCK, BLOCK, wd // BLOCK, BLOCK).mean(axis=(1, 3)).astype(np.float32)

        r0 = int(round((self.n - tr.f) / self.cell))
        c0 = int(round((tr.c - self.w) / self.cell))
        for target, mask in (
            (self.tree, arr == TREE),
            (self.water, arr == WATER),
            (self.wetland, np.isin(arr, WETLAND)),
            (self.built, arr == BUILT),
        ):
            f = frac(mask)
            rr = slice(max(r0, 0), min(r0 + f.shape[0], target.shape[0]))
            cc = slice(max(c0, 0), min(c0 + f.shape[1], target.shape[1]))
            target[rr, cc] = f[rr.start - r0 : rr.stop - r0, cc.start - c0 : cc.stop - c0]

    def window_means(self, lonlat: np.ndarray, radius_m: float, layer: str) -> np.ndarray:
        """Mean share of `layer` within roughly radius_m of each point."""
        arr = getattr(self, layer)
        out = np.zeros(len(lonlat))
        for i, (lon, lat) in enumerate(lonlat):
            r = int((self.n - lat) / self.cell)
            c = int((lon - self.w) / self.cell)
            ry = max(1, int(round(radius_m / (self.cell * 111_320))))
            rx = max(1, int(round(radius_m / (self.cell * 111_320 * math.cos(math.radians(lat))))))
            win = arr[max(r - ry, 0) : r + ry + 1, max(c - rx, 0) : c + rx + 1]
            out[i] = float(win.mean()) if win.size else 0.0
        return out
