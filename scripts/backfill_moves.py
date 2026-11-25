"""One-off (11.81): build public/data/us/moved.json from earlier releases in git.

Earlier road squares are still in git: in this repo before 11.31 moved them
(public/data/us/cells/) and in the data repo's earlier publish commits (kept
by its reflog). Each road ID from those releases that isn't in today's data is
matched to the road it became (pipeline/moves.py). From now on tiles.py does
this on every rebuild.

    python scripts/backfill_moves.py [path to the sunday-line-data checkout]
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from pipeline.moves import find_moves, merge_moves, ways_of  # noqa: E402

DEST = REPO / "public" / "data" / "us"


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, encoding="utf-8").stdout


def release_ways(repo: Path, commit: str, folder: str) -> dict[str, list[int]]:
    """Road ID -> OSM ways from every road square in one commit."""
    names = [n for n in git(repo, "ls-tree", "--name-only", f"{commit}:{folder}").split() if n.endswith(".json") and not n.startswith("names-")]
    out: dict[str, list[int]] = {}
    batch = subprocess.Popen(["git", "-C", str(repo), "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    assert batch.stdin and batch.stdout
    for n in names:
        batch.stdin.write(f"{commit}:{folder}{n}\n".encode())
        batch.stdin.flush()
        header = batch.stdout.readline().split()
        size = int(header[2])
        body = batch.stdout.read(size)
        batch.stdout.read(1)
        for r in json.loads(body)["roads"]:
            out[r["id"]] = r.get("osm_way_ids") or []
    batch.stdin.close()
    batch.wait()
    return out


def main() -> None:
    data_repo = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO.parent / "sunday-line-data"
    now = ways_of(sorted((DEST / "cells").glob("*.json")))
    live = set(now)
    print(f"today: {len(live)} roads")

    # Oldest first, so a road that moved twice ends up at today's road.
    releases: list[tuple[Path, str, str]] = []
    for c in reversed(git(REPO, "log", "--format=%h", "--", "public/data/us/cells/").split()):
        try:
            git(REPO, "ls-tree", f"{c}:public/data/us/cells/")
            releases.append((REPO, c, "public/data/us/cells/"))
        except subprocess.CalledProcessError:
            pass  # the commit that removed them
    for line in reversed(git(data_repo, "reflog", "--format=%h %gs").splitlines()):
        c, what = line.split(" ", 1)
        if what.startswith("commit"):
            releases.append((data_repo, c, "cells/"))

    moves: dict[str, str] = json.loads((DEST / "moved.json").read_text()) if (DEST / "moved.json").exists() else {}
    seen: set[str] = set()
    for repo, c, folder in releases:
        old = release_ways(repo, c, folder)
        seen |= set(old)
        found = find_moves(old, now)
        moves = merge_moves(moves, found, live)
        print(f"{repo.name} {c}: {len(old)} roads, {sum(1 for i in old if i not in live)} gone, {len(found)} matched")
    unmatched = len({i for i in seen if i not in live} - set(moves))
    (DEST / "moved.json").write_text(json.dumps(dict(sorted(moves.items())), separators=(",", ":")), encoding="utf-8")
    print(f"moved.json: {len(moves)} old IDs redirect; {unmatched} old IDs had no matching road (left out)")


if __name__ == "__main__":
    main()
