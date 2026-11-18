"""Sunday Line data pipeline.

    python -m pipeline fetch  --region shreveport
    python -m pipeline score  --region shreveport
    python -m pipeline report --region shreveport
    python -m pipeline surface --region shreveport   (aerial-photo gravel check, slow)
    python -m pipeline review --region shreveport    (road-check page data)
    python -m pipeline all    --region shreveport
"""
from __future__ import annotations

import argparse

from .config import load_region


def main() -> None:
    p = argparse.ArgumentParser(prog="pipeline")
    p.add_argument("step", choices=["fetch", "score", "surface", "report", "review", "all"])
    p.add_argument("--region", default="shreveport")
    p.add_argument("--top", type=int, default=20)
    args = p.parse_args()
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
    if args.step in ("surface", "review"):
        import sys

        from . import review, surface

        sys.argv = [sys.argv[0], "--region", args.region]
        (surface if args.step == "surface" else review).main()


if __name__ == "__main__":
    main()
