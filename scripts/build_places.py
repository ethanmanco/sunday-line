"""Build public/data/places.json: every US city, town and CDP for place search.

    python scripts/build_places.py <gazetteer.txt> <acs-b01003.dat>

Inputs (both public domain, US Census Bureau):
  https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip
      (unzip it; one row per place with its center point)
  https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-b01003.dat
      (total population per place, ACS 5-year)

Output: {"places": [[name, state, lng, lat, population], ...], "states": [[name, abbr, w, s, e, n], ...]}
Places are sorted by population, biggest first, so search can rank by order.
States come from the per-state region files (regions/states/*.toml).
Search runs in the browser; nothing anyone types leaves their device (docs/plan.md 11.32).
"""
from __future__ import annotations

import csv
import json
import re
import sys
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "public" / "data" / "places.json"
# No road data there (yet), so no point finding places there.
SKIP_STATES = {"AK", "PR"}

TAIL = re.compile(r"(\s+(?:[a-z][a-z.]*|CDP))+$")


def clean(name: str) -> str:
    """"Abbeville city" -> "Abbeville", "Metairie CDP" -> "Metairie"."""
    out = TAIL.sub("", name.strip().removesuffix(" (balance)"))
    return out or name.strip()


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    gaz, pop_file = Path(sys.argv[1]), Path(sys.argv[2])

    pop: dict[str, int] = {}
    with pop_file.open(encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="|"):
            if row and row[0].startswith("1600000US"):
                try:
                    pop[row[0][9:]] = int(row[1])
                except ValueError:
                    pass

    places = []
    with gaz.open(encoding="utf-8") as f:
        rows = csv.reader(f, delimiter="\t")
        head = [h.strip() for h in next(rows)]
        ix = {h: i for i, h in enumerate(head)}
        for r in rows:
            st = r[ix["USPS"]].strip()
            if st in SKIP_STATES:
                continue
            geoid = r[ix["GEOID"]].strip()
            lat = round(float(r[ix["INTPTLAT"]]), 4)
            lng = round(float(r[ix["INTPTLONG"]]), 4)
            places.append([clean(r[ix["NAME"]]), st, lng, lat, pop.get(geoid, 0)])
    places.sort(key=lambda p: (-p[4], p[0]))

    states = []
    for f in sorted((REPO / "regions" / "states").glob("*.toml")):
        d = tomllib.loads(f.read_text(encoding="utf-8"))
        abbr = f.stem.upper()
        if abbr in SKIP_STATES:
            continue
        w, s, e, n = d["bbox"]
        states.append([d["name"], abbr, round(w, 2), round(s, 2), round(e, 2), round(n, 2)])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": "US Census Bureau 2024 Gazetteer and ACS 2019-2023 (public domain)",
                               "places": places, "states": states}, separators=(",", ":")), encoding="utf-8")
    print(f"{len(places)} places, {len(states)} states, {OUT.stat().st_size / 1e6:.2f} MB -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
