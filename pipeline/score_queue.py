"""Work through the road score queue (docs/plan.md 11.27).

    SUPABASE_URL=... SUPABASE_SECRET_KEY=... python -m pipeline.score_queue [--limit 10]

Run hourly by .github/workflows/score-roads.yml. Claims queued requests,
scores each line with pipeline.score_line, and writes the result back. A road
that fails is retried on a later run, up to 3 tries. Needs the project's
secret (service role) key; it lives only in GitHub's encrypted secrets.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

from .score_line import score_line


def rpc(base: str, key: str, name: str, body: dict):
    headers = {"apikey": key, "Content-Type": "application/json"}
    # Legacy JWT keys also go in Authorization; new sb_secret_ keys go in apikey only.
    if key.count(".") == 2:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(f"{base}/rest/v1/rpc/{name}", data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()
    base = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY") or ""
    if not base or not key:
        print("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
        return 2
    if not base.startswith("http"):
        base = f"https://{base}.supabase.co"  # a bare project ID
    jobs = rpc(base, key, "claim_score_jobs", {"p_limit": args.limit}) or []
    print(f"{len(jobs)} road(s) to score", flush=True)
    failed = 0
    for job in jobs:
        t0 = time.time()
        try:
            result = score_line(job["line"])
            rpc(base, key, "finish_score_job", {"p_spot": job["spot_id"], "p_scores": result["scores"], "p_details": result["details"]})
            print(f"  scored in {time.time() - t0:.0f}s: overall {result['scores']['overall']}", flush=True)
        except Exception as e:  # noqa: BLE001 - one bad road must not stop the rest (11.82)
            failed += 1
            note = (str(e) if isinstance(e, ValueError)
                    else "Couldn't reach the map data. It'll try again." if isinstance(e, (urllib.error.URLError, TimeoutError, ConnectionError))
                    else "Scoring hit a problem. It'll try again.")
            print(f"  failed: {type(e).__name__}: {e}", flush=True)
            try:
                rpc(base, key, "fail_score_job", {"p_spot": job["spot_id"], "p_note": note})
            except Exception:  # noqa: BLE001 - the claim times out and it's retried
                pass
        time.sleep(2)  # be polite to the public map servers
    return 1 if failed and failed == len(jobs) else 0


if __name__ == "__main__":
    sys.exit(main())
