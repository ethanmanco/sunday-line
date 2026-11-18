"""Elevation sampling from USGS 3DEP 1 arc-second tiles (bare earth)."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import rasterio


class Dem:
    def __init__(self, tile_dir: Path):
        self.tile_dir = tile_dir
        self.tiles: dict[str, tuple[np.ndarray, rasterio.Affine] | None] = {}

    def _tile(self, lon: float, lat: float):
        top = math.floor(lat) + 1
        left = math.floor(lon)
        name = (f"n{top:02d}" if top >= 0 else f"s{-top:02d}") + (
            f"w{-left:03d}" if left < 0 else f"e{left:03d}"
        )
        if name not in self.tiles:
            path = self.tile_dir / f"USGS_1_{name}.tif"
            if path.exists():
                with rasterio.open(path) as ds:
                    arr = ds.read(1).astype(np.float32)
                    nod = ds.nodata
                    if nod is not None:
                        arr[arr == nod] = np.nan
                    arr[arr < -1000] = np.nan
                    self.tiles[name] = (arr, ds.transform)
            else:
                self.tiles[name] = None
        return self.tiles[name]

    def sample(self, lonlat: np.ndarray) -> np.ndarray:
        """Bilinear elevation in meters for each (lon, lat); NaN where unknown."""
        out = np.full(len(lonlat), np.nan)
        for i, (lon, lat) in enumerate(lonlat):
            t = self._tile(lon, lat)
            if t is None:
                continue
            arr, tr = t
            col = (lon - tr.c) / tr.a - 0.5
            row = (lat - tr.f) / tr.e - 0.5
            c0, r0 = int(math.floor(col)), int(math.floor(row))
            if r0 < 0 or c0 < 0 or r0 + 1 >= arr.shape[0] or c0 + 1 >= arr.shape[1]:
                continue
            fc, fr = col - c0, row - r0
            v = (
                arr[r0, c0] * (1 - fc) * (1 - fr)
                + arr[r0, c0 + 1] * fc * (1 - fr)
                + arr[r0 + 1, c0] * (1 - fc) * fr
                + arr[r0 + 1, c0 + 1] * fc * fr
            )
            out[i] = v
        return out
