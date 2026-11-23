"""Rebuild every state, three at a time, then the Shreveport region, then tiles.

    python scripts/rebuild_national.py

Used for the 11.33 rebuild. Each group runs scripts/run_states.py on its own
(states already exported are skipped, so it can be restarted). Shared elevation
and land cover tiles are kept until the end (SUNDAY_LINE_KEEP_TILES=1) so two
neighboring states never delete each other's files; delete raw/dem and
raw/landcover by hand afterwards. Keeps Windows awake while it runs.
Set SUNDAY_LINE_DATA first.
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
    for i, p in enumerate(procs):
        log(f"group {i + 1} exited {p.wait()}", logf)

    if not (data / "out" / "shreveport" / "export.json").exists():
        with (data / "run_shreveport.log").open("a", encoding="utf-8") as out:
            for step in ("hpms", "overture", "fetch", "score", "export"):
                code = subprocess.call([py, "-m", "pipeline", step, "--region", "shreveport"],
                                       cwd=REPO, env=env, stdout=out, stderr=subprocess.STDOUT)
                log(f"shreveport {step}: exit {code}", logf)
                if code:
                    break
    code = subprocess.call([py, "-m", "pipeline", "tiles"], cwd=REPO, env=env)
    log(f"tiles: exit {code}", logf)
    return 0


if __name__ == "__main__":
    sys.exit(main())
