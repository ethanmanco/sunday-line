"""Sunday Line data pipeline.

    python -m pipeline fetch  --region shreveport
    python -m pipeline score  --region shreveport
    python -m pipeline report --region shreveport
    python -m pipeline surface --region shreveport   (aerial-photo gravel check, slow)
    python -m pipeline review --region shreveport    (road-check page data)
    python -m pipeline export --region shreveport    (data file the web app reads)
    python -m pipeline all    --region shreveport
    python -m pipeline tiles                         (merge every export into public/data/us)

One state at a time:

    python -m pipeline states                        (write regions/states/<abbr>.toml)
    python -m pipeline state --region ar [--cleanup] (fetch, overture, hpms, score, export)
    python -m pipeline overture --region ar          (Overture buildings and places for the box)

Set SUNDAY_LINE_DATA to keep downloads, caches, and outputs on another drive
(default: the repo's data/ folder). Tiles always write to public/data/us.
"""
from __future__ import annotations

import argparse

from .config import load_region

STEPS = ["fetch", "score", "surface", "report", "review", "export", "hpms", "overture", "tiles", "all", "states", "state"]


def main() -> None:
    p = argparse.ArgumentParser(prog="pipeline")
    p.add_argument("step", choices=STEPS)
    p.add_argument("--region", default="shreveport")
    p.add_argument("--top", type=int, default=20)
    p.add_argument("--cleanup", action="store_true", help="with `state`: delete the state's raw inputs afterwards")
    args = p.parse_args()

    if args.step == "states":
        from .states import write_state_files

        write_state_files()
        return
    if args.step == "state":
        from .states import run_state

        run_state(args.region, do_cleanup=args.cleanup)
        return
    if args.step == "tiles":
        from .tiles import tiles

        tiles()
        return

    region = load_region(args.region)

    if args.step in ("fetch", "all"):
        from .fetch import fetch

        fetch(region)
    if args.step in ("score", "all"):
        from .build import build

        build(region)
    if args.step in ("report", "all"):
        from .report import report

        report(region, top=args.top)
    if args.step in ("export", "all"):
        from .export import export

        export(region)
    if args.step == "all":
        from .tiles import tiles

        tiles()
    if args.step == "hpms":
        from .hpms import download

        download(region)
    if args.step == "overture":
        from .overture import download as overture_download

        overture_download(region)
    if args.step in ("surface", "review"):
        import sys

        from . import review, surface

        sys.argv = [sys.argv[0], "--region", args.region]
        (surface if args.step == "surface" else review).main()


if __name__ == "__main__":
    main()
