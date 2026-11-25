"""Rebuild every state, three at a time, then Scenic v2, then tiles.

    python scripts/rebuild_national.py

Each group runs scripts/run_states.py on its own (states already exported are
skipped, so it can be restarted). Shared elevation and land cover tiles are
kept until the end (SUNDAY_LINE_KEEP_TILES=1) so two neighboring states never
delete each other's files; delete raw/dem and raw/landcover by hand afterwards.
Keeps Windows awake while it runs. Set SUNDAY_LINE_DATA first.

It stops at the first thing that fails (11.82): a state that didn't export,
the Scenic pass, a missing state, or tiles. Exits 1 then, and the log says
what to look at. Then publish by hand: scripts/publish_cells.py, and commit
the small files in public/data/us.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# Balanced by the last run's minutes; the biggest states (or, tx, ca) start at
# different times so their memory peaks don't line up.
GROUPS = [
    "or,ny,ga,wa,fl,az,ky,ma,ks,id,mt,ms,wy,nd,ri,de",
    "dc,hi,nh,ct,nj,wv,ia,ne,il,al,ok,in,mi,tn,oh,pa,tx",
    "nc,va,mo,wi,mn,ca,sc,co,nm,md,ut,ar,nv,me,sd,vt,la",
]


def log(msg: str, f: Path) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with f.open("a", encoding="utf-8") as out:
        out.write(line + "\n")


def main() -> int:
    data = Path(os.environ.get("SUNDAY_LINE_DATA") or REPO / "data")
    logf = data / "rebuild_national.log"
    env = dict(os.environ, SUNDAY_LINE_KEEP_TILES="1")
    py = sys.executable
    subprocess.Popen([py, str(REPO / "scripts" / "keep_awake.py"), str(os.getpid())])
    procs = []
    for i, g in enumerate(GROUPS):
        out = (data / f"rebuild_group{i + 1}.out").open("a", encoding="utf-8")
        procs.append(subprocess.Popen([py, str(REPO / "scripts" / "run_states.py"), "--only", g, "--no-tiles"],
                                      cwd=REPO, env=env, stdout=out, stderr=subprocess.STDOUT))
        log(f"group {i + 1} started: {g}", logf)
        time.sleep(60)
    codes = [p.wait() for p in procs]
    for i, code in enumerate(codes):
        log(f"group {i + 1} exited {code}", logf)

    states = [st for g in GROUPS for st in g.split(",")]
    missing = [st for st in states if not (data / "out" / st / "export.json").exists()]
    if any(codes) or missing:
        log(f"FAILED: states not exported: {', '.join(missing) or 'none'} (see run_states.log and run_<state>.log). "
            "Fix and run this again; finished states are skipped. Nothing was published.", logf)
        return 1

    # Scenic v2 over the new exports (states already at the current version are skipped).
    code = subprocess.call([py, "-m", "pipeline.scenic", "apply"], cwd=REPO, env=env)
    log(f"scenic: exit {code}", logf)
    if code:
        log("FAILED at the Scenic pass. Nothing was published.", logf)
        return 1

    code = subprocess.call([py, "-m", "pipeline", "tiles"], cwd=REPO, env=env)
    log(f"tiles: exit {code}", logf)
    if code:
        log("FAILED at tiles. Nothing was published.", logf)
        return 1
    log("all done. Next: python scripts/publish_cells.py, then commit public/data/us.", logf)
    return 0


if __name__ == "__main__":
    sys.exit(main())
