"""Region and scoring configuration."""
from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REGIONS_DIR = REPO / "regions"
DATA_DIR = REPO / "data"


@dataclass
class Region:
    slug: str
    name: str
    timezone: str
    units: str
    country: str
    bbox: tuple[float, float, float, float]
    home: tuple[float, float]
    home_radius_km: float
    osm_extracts: list[str]
    dem: str
    speed_estimates: dict[str, float] = field(default_factory=dict)

    @property
    def raw_dir(self) -> Path:
        # Downloaded files only. Never put code here.
        return DATA_DIR / "raw"

    @property
    def out_dir(self) -> Path:
        return DATA_DIR / "out" / self.slug


def load_region(slug: str) -> Region:
    path = REGIONS_DIR / f"{slug}.toml"
    with path.open("rb") as f:
        d = tomllib.load(f)
    return Region(
        slug=d["slug"],
        name=d["name"],
        timezone=d["timezone"],
        units=d["units"],
        country=d["country"],
        bbox=tuple(d["bbox"]),
        home=tuple(d["home"]),
        home_radius_km=float(d.get("home_radius_km", 100)),
        osm_extracts=list(d["osm_extracts"]),
        dem=d["dem"],
        speed_estimates=dict(d.get("speed_estimates", {})),
    )


def load_scoring() -> dict:
    with (Path(__file__).parent / "scoring.toml").open("rb") as f:
        return tomllib.load(f)
