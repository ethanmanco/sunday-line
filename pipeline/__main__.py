"""Sunday Line data pipeline.

    python -m pipeline fetch  --region shreveport
    python -m pipeline score  --region shreveport
    python -m pipeline report --region shreveport
    python -m pipeline all    --region shreveport
"""
from __future__ import annotations

import argparse

from .config import load_region


def main() -> None:
    p = argparse.ArgumentParser(prog="pipeline")
    p.add_argument("step", choices=["fetch", "score", "report", "all"])
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


if __name__ == "__main__":
    main()
