"""Run every state, one at a time, then merge them into public/data/us.

    set SUNDAY_LINE_DATA=E:\\sunday-line-data
    python scripts/run_states.py [--only de,ri] [--no-tiles]

Smallest states first so problems show up early; Texas and California last.
A state with an export already is skipped, so the run can be restarted.
One state failing doesn't stop the rest; failures are listed at the end.
Alaska is left out (it needs its own plan, docs/plan.md 11.22).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ORDER = (
    "dc ri de ct nj nh vt ma md hi wv sc in me ky tn va oh pa ms al la ia nc ny il wi ar "
    "mi ga fl ok wa nd sd ne ks mo mn ut id or wy nv co az nm mt ca tx"
).split()


def log(msg: str, logfile: Path) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with logfile.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated postal codes")
    ap.add_argument("--no-tiles", action="store_true")
    args = ap.parse_args()
    data = Path(os.environ.get("SUNDAY_LINE_DATA") or REPO / "data")
    logfile = data / "run_states.log"
    data.mkdir(parents=True, exist_ok=True)
    states = args.only.split(",") if args.only else ORDER
    failed: list[str] = []
    for st in states:
        if (data / "out" / st / "export.json").exists():
            log(f"{st}: done already, skipped", logfile)
            continue
        log(f"{st}: starting", logfile)
        t0 = time.time()
        with (data / f"run_{st}.log").open("w", encoding="utf-8") as out:
            code = subprocess.call(
                [sys.executable, "-m", "pipeline", "state", "--region", st, "--cleanup"],
                cwd=REPO, stdout=out, stderr=subprocess.STDOUT,
            )
        mins = (time.time() - t0) / 60
        if code == 0:
            run = data / "out" / st / "run.json"
            extra = ""
            if run.exists():
                info = json.loads(run.read_text(encoding="utf-8"))
                extra = (f" ({info.get('exported_roads')} roads, {info.get('drivers_roads')} driver's roads,"
                         f" peak +{info.get('peak_growth_bytes', 0) / 1e9:.1f} GB)")
            log(f"{st}: finished in {mins:.1f} min{extra}", logfile)
        else:
            failed.append(st)
            log(f"{st}: FAILED after {mins:.1f} min (exit {code}); see run_{st}.log", logfile)
    if not args.no_tiles:
        log("tiles: merging", logfile)
        code = subprocess.call([sys.executable, "-m", "pipeline", "tiles"], cwd=REPO)
        log(f"tiles: exit {code}", logfile)
    log(f"all done; failed: {', '.join(failed) or 'none'}", logfile)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
