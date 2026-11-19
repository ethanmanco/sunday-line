"""After the all-states run: re-run states whose output has no section data.

    set SUNDAY_LINE_DATA=E:\\sunday-line-data
    python scripts/rerun_without_bins.py [--wait-for <pid>]

States finished before per-section drive data existed (docs/plan.md 11.26),
and states that failed, are run again; their old output is kept as
export.nobins.json until the new one exists. Then the regions are merged.
Shreveport is skipped (its raw data lives in the repo's data folder; re-score
it there and copy its export over).
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
from run_states import ORDER  # noqa: E402


def wait_for(pid: int) -> None:
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if h:
        k32.WaitForSingleObject(h, 0xFFFFFFFF)
        k32.CloseHandle(h)


def has_bins(path: Path) -> bool:
    try:
        roads = json.loads(path.read_text(encoding="utf-8"))["roads"]
    except (OSError, ValueError, KeyError):
        return False
    return bool(roads) and all(r.get("bins") for r in roads[:20])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wait-for", type=int)
    args = ap.parse_args()
    if args.wait_for:
        wait_for(args.wait_for)
    data = Path(os.environ.get("SUNDAY_LINE_DATA") or REPO / "data")
    todo = []
    for st in ORDER:
        export = data / "out" / st / "export.json"
        if export.exists() and has_bins(export):
            continue
        if export.exists():
            export.replace(export.with_name("export.nobins.json"))
        todo.append(st)
    print(f"re-running: {', '.join(todo) or 'nothing'}", flush=True)
    code = 0
    if todo:
        code = subprocess.call([sys.executable, str(REPO / "scripts" / "run_states.py"), "--only", ",".join(todo)], cwd=REPO)
    # A state that still failed keeps its old output so its roads stay on the map.
    for st in todo:
        out = data / "out" / st
        if not (out / "export.json").exists() and (out / "export.nobins.json").exists():
            (out / "export.nobins.json").replace(out / "export.json")
    return code


if __name__ == "__main__":
    sys.exit(main())
