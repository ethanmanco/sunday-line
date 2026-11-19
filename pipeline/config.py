"""Region and scoring configuration."""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REGIONS_DIR = REPO / "regions"
STATE_REGIONS_DIR = REGIONS_DIR / "states"
# Downloads, caches, temporary files, and outputs. Set SUNDAY_LINE_DATA to keep
# them on another drive; the default is the repo's data/ folder.
DATA_DIR = Path(os.environ["SUNDAY_LINE_DATA"]) if os.environ.get("SUNDAY_LINE_DATA") else REPO / "data"
# Road-check verdicts are people's work, not downloads, so they stay with the repo.
REVIEW_DIR = REPO / "data" / "review"

# Postal codes, used for federal road data (HPMS) and route numbers.
STATE_CODES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}


@dataclass
class Region:
    slug: str
    name: str
    timezone: str
    units: str
    country: str
    bbox: tuple[float, float, float, float]
    osm_extracts: list[str]
    dem: str
    landcover: str
    area: str = ""
    # Optional "home" point for a Local list. Regions without one skip home_mi.
    home: tuple[float, float] | None = None
    home_name: str | None = None
    local_radius_mi: float = 50
    # States the region covers (OpenStreetMap names). Used for state outlines,
    # legal defaults, and federal road data. Defaults to the speed_defaults keys.
    states: list[str] = field(default_factory=list)
    speed_estimates: dict[str, float] = field(default_factory=dict)
    speed_defaults: dict[str, dict] = field(default_factory=dict)
    source: Path | None = None

    @property
    def raw_dir(self) -> Path:
        # Downloaded files only. Never put code here.
        return DATA_DIR / "raw"

    @property
    def out_dir(self) -> Path:
        return DATA_DIR / "out" / self.slug

    @property
    def state_codes(self) -> list[str]:
        return [STATE_CODES[s] for s in self.states if s in STATE_CODES]


def region_path(slug: str) -> Path:
    for path in (REGIONS_DIR / f"{slug}.toml", STATE_REGIONS_DIR / f"{slug}.toml"):
        if path.exists():
            return path
    raise SystemExit(
        f"No region {slug!r}: looked for regions/{slug}.toml and regions/states/{slug}.toml. "
        "State files are written by `python -m pipeline states`."
    )


def load_region(slug: str) -> Region:
    path = region_path(slug)
    with path.open("rb") as f:
        d = tomllib.load(f)
    speed_defaults = dict(d.get("speed_defaults", {}))
    return Region(
        slug=d["slug"],
        name=d["name"],
        timezone=d["timezone"],
        units=d["units"],
        country=d["country"],
        bbox=tuple(d["bbox"]),
        home=tuple(d["home"]) if d.get("home") else None,
        home_name=d.get("home_name") or ("home" if d.get("home") else None),
        area=d.get("area", d["name"]),
        local_radius_mi=float(d.get("local_radius_mi", 50)),
        osm_extracts=list(d["osm_extracts"]),
        dem=d["dem"],
        landcover=d.get("landcover", "esa_worldcover_2021"),
        states=list(d.get("states") or speed_defaults),
        speed_estimates=dict(d.get("speed_estimates", {})),
        speed_defaults=speed_defaults,
        source=path,
    )


def hand_written_regions() -> list[Region]:
    """Regions in regions/*.toml (not the generated per-state files)."""
    return [load_region(p.stem) for p in sorted(REGIONS_DIR.glob("*.toml"))]


def load_scoring() -> dict:
    with (Path(__file__).parent / "scoring.toml").open("rb") as f:
        return tomllib.load(f)
