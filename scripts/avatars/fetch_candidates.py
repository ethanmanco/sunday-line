"""Query Openverse (CC0 / PDM only) for every entry in queries.py and cache
the raw responses, then download the top candidates for review.

Usage:
  python scripts/avatars/fetch_candidates.py search <workdir>
  python scripts/avatars/fetch_candidates.py download <workdir> [per_query]

Nothing is written inside the repo; <workdir> should be a scratch folder.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from queries import Q  # noqa: E402

API = "https://api.openverse.org/v1/images/"
UA = "sunday-line-avatar-builder/1.0"
OK_LICENSES = {"cc0", "pdm"}


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_image(url, width):
    """Download an image. Wikimedia originals are fetched as a 1280px thumb,
    and curl (system TLS store) is used because Python's bundled CA store
    rejects upload.wikimedia.org on this machine."""
    import re
    import subprocess
    m = re.match(r"https://upload\.wikimedia\.org/wikipedia/commons/(\w/\w\w)/([^/]+)$", url)
    if m and width and width > 1280 and not url.lower().endswith((".svg", ".tif", ".tiff")):
        url = f"https://upload.wikimedia.org/wikipedia/commons/thumb/{m.group(1)}/{m.group(2)}/1280px-{m.group(2)}"
    wm = "upload.wikimedia.org" in url
    for wait in (0, 20, 60):
        time.sleep(wait + (1.5 if wm else 0))  # Wikimedia rate-limits (429)
        p = subprocess.run(["curl", "-sfL", "--max-time", "60", "-A", UA, url], capture_output=True)
        if p.returncode == 0 and len(p.stdout) >= 1000:
            return p.stdout
        if p.returncode != 22:
            break
    raise RuntimeError(f"curl rc={p.returncode} bytes={len(p.stdout)}")


def search(workdir):
    out = os.path.join(workdir, "ov")
    os.makedirs(out, exist_ok=True)
    for entry in Q:
        key, query = entry[0], entry[1]
        path = os.path.join(out, key + ".json")
        if os.path.exists(path):
            continue
        qs = urllib.parse.urlencode({"q": query, "license": "cc0,pdm", "page_size": 20})
        try:
            data = get(API + "?" + qs)
        except Exception as e:  # noqa: BLE001
            print("FAIL", key, e)
            time.sleep(10)
            continue
        with open(path, "wb") as f:
            f.write(data)
        n = len(json.loads(data).get("results", []))
        print(key, n, flush=True)
        time.sleep(3.3)


def download(workdir, per_query=6):
    out = os.path.join(workdir, "dl")
    os.makedirs(out, exist_ok=True)
    cands = []
    seen = set()
    for entry in Q:
        key = entry[0]
        path = os.path.join(workdir, "ov", key + ".json")
        if not os.path.exists(path):
            continue
        res = json.load(open(path, encoding="utf-8")).get("results", [])
        kept = 0
        for r in res:
            if kept >= per_query:
                break
            if r.get("license") not in OK_LICENSES:
                continue
            if r["id"] in seen:
                continue
            w, h = r.get("width") or 0, r.get("height") or 0
            if w and h and min(w, h) < 400:
                continue
            if r.get("mature"):
                continue
            seen.add(r["id"])
            fn = os.path.join(out, r["id"] + ".img")
            if not os.path.exists(fn):
                try:
                    data = get_image(r["url"], w)
                    with open(fn, "wb") as f:
                        f.write(data)
                except Exception as e:  # noqa: BLE001
                    print("dl fail", key, r["id"], e)
                    continue
            kept += 1
            cands.append({"key": key, "ov": r})
        print(key, kept, flush=True)
    with open(os.path.join(workdir, "candidates.json"), "w", encoding="utf-8") as f:
        json.dump(cands, f)


def extra(wd, keys, per_key):
    """Append more candidates (e.g. Wikimedia ones skipped earlier because of
    rate limits) for the given keys, keeping existing candidate indexes."""
    cpath = os.path.join(wd, "candidates.json")
    cands = json.load(open(cpath, encoding="utf-8"))
    have = {c["ov"]["id"] for c in cands}
    for key in keys:
        path = os.path.join(wd, "ov", key + ".json")
        if not os.path.exists(path):
            continue
        added = 0
        for r in json.load(open(path, encoding="utf-8")).get("results", []):
            if added >= per_key:
                break
            if r["id"] in have or r.get("license") not in OK_LICENSES or r.get("mature"):
                continue
            w, h = r.get("width") or 0, r.get("height") or 0
            if w and h and min(w, h) < 400:
                continue
            fn = os.path.join(wd, "dl", r["id"] + ".img")
            if not os.path.exists(fn):
                try:
                    data = get_image(r["url"], w)
                except Exception as e:  # noqa: BLE001
                    print("dl fail", key, r["id"], e, flush=True)
                    continue
                with open(fn, "wb") as f:
                    f.write(data)
                time.sleep(8)
            have.add(r["id"])
            cands.append({"key": key, "ov": r})
            added += 1
        print(key, added, flush=True)
        with open(cpath, "w", encoding="utf-8") as f:
            json.dump(cands, f)


if __name__ == "__main__":
    cmd, wd = sys.argv[1], sys.argv[2]
    if cmd == "search":
        search(wd)
    elif cmd == "extra":
        extra(wd, sys.argv[3].split(","), int(sys.argv[4]))
    else:
        download(wd, int(sys.argv[3]) if len(sys.argv) > 3 else 6)
