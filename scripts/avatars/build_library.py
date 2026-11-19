"""Build public/avatars/library from reviewed picks.

Usage:
  python -I scripts/avatars/build_library.py <workdir> <picks.json> <repo_root>

picks.json is a list of objects:
  {"ov": "<openverse id>", "pos": 0.5, "zoom": 1.0, "as": "<queries.py key>",
   "make": ..., "model": ..., "years": ..., "kind": ..., "tags": [...],
   "addtags": [...], "id": ..., "blur": [[x0, y0, x1, y1], ...]}
Only "ov" is required; everything else overrides the defaults that come from
the matching queries.py entry ("as" picks a different entry). "blur" boxes are
in tenths of the 256px square and are used to hide licence plates. Licenses
are re-checked here: anything that is not cc0 / pdm is refused.

<workdir> is the scratch folder used by fetch_candidates.py (candidates.json
plus the downloaded originals in dl/); it is not part of the repo.
"""
import io
import json
import os
import re
import sys

from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from contact_sheets import square  # noqa: E402
from queries import Q  # noqa: E402

LICENSE_LABEL = {"cc0": "CC0", "pdm": "PDM"}
MAX_BYTES = 20 * 1024


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def decade_tags(years):
    tags = set()
    if not years:
        return tags
    for m in re.finditer(r"(19|20)(\d)\d", years):
        dec = m.group(1) + m.group(2) + "0"
        tags.add(dec[2:] + "s" if dec.startswith("19") else dec + "s")
    return tags


def encode(im):
    for q in (80, 75, 70, 65, 60, 55, 50):
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= MAX_BYTES:
            return buf.getvalue(), q
    return buf.getvalue(), q


def main(wd, picks_path, repo):
    meta = {e[0]: e for e in Q}
    cands = {c["ov"]["id"]: c for c in json.load(open(os.path.join(wd, "candidates.json"), encoding="utf-8"))}
    picks = json.load(open(picks_path, encoding="utf-8"))
    out = os.path.join(repo, "public", "avatars", "library")
    os.makedirs(out, exist_ok=True)
    counters = {}
    items = []
    for p in picks:
        c = cands[p["ov"]]
        ov = c["ov"]
        lic = ov.get("license")
        if lic not in LICENSE_LABEL:
            raise SystemExit(f"refusing non CC0/PDM license {lic} for {p['ov']}")
        key, _q, make, model, years, kind, tags, _cat = meta[p.get("as", c["key"])]
        tags = p.get("tags", tags)
        make = p.get("make", make)
        model = p.get("model", model)
        years = p.get("years", years)
        kind = p.get("kind", kind)
        base = p.get("id") or key
        counters[base] = counters.get(base, 0) + 1
        iid = f"{base}-{counters[base]}"
        im = Image.open(os.path.join(wd, "dl", ov["id"] + ".img"))
        if min(im.size) < 400:
            raise SystemExit(f"source too small {iid} {im.size}")
        sq = square(im, p.get("pos", 0.5), p.get("zoom", 1.0)).resize((256, 256), Image.LANCZOS)
        for box in p.get("blur", []):  # licence-plate redaction, box in tenths of the square
            x0, y0, x1, y1 = (round(v * 25.6) for v in box)
            region = sq.crop((x0, y0, x1, y1))
            w, h = region.size
            region = region.resize((max(1, w // 8), max(1, h // 8)), Image.BILINEAR).resize((w, h), Image.BILINEAR)
            region = region.filter(ImageFilter.GaussianBlur(3))
            sq.paste(region, (x0, y0))
        data, q = encode(sq)  # fresh encode: no EXIF/XMP/ICC carried over
        with open(os.path.join(out, iid + ".webp"), "wb") as f:
            f.write(data)
        t = set(tags) | set(p.get("addtags", [])) | decade_tags(years)
        if make != "Various":
            t |= {slug(make)} | set(slug(make).split("-"))
        t |= {w for w in slug(model).split("-") if len(w) > 1 and w not in {"motorcycle", "car"}}
        t.add(kind)
        if kind == "motorcycle":
            t |= {"bike", "moto"}
        if kind == "truck":
            t.add("truck")
        t.discard("")
        item = {
            "id": iid,
            "file": f"/avatars/library/{iid}.webp",
            "make": make,
            "model": model,
        }
        if years:
            item["years"] = years
        item.update({
            "kind": kind,
            "tags": sorted(x.lower() for x in t),
            "license": LICENSE_LABEL[lic],
            "creator": (ov.get("creator") or "").strip() or None,
            "source": ov["foreign_landing_url"],
            "title": (ov.get("title") or "").strip() or None,
            "_bytes": len(data),
            "_q": q,
        })
        items.append(item)

    manifest_items = []
    for it in items:
        m = {k: v for k, v in it.items() if not k.startswith("_") and k != "title"}
        if m["creator"] is None:
            m["creator"] = ""
        manifest_items.append(m)
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"version": 1, "items": manifest_items}, f, indent=1, ensure_ascii=False)
        f.write("\n")

    lines = [
        "# Avatar library credits",
        "",
        "Every image in this folder is either dedicated to the public domain under",
        "CC0 1.0 or marked as public domain (Public Domain Mark 1.0) by its source.",
        "No attribution is legally required; credits are kept as a courtesy and for",
        "provenance. Images were found through Openverse (openverse.org), cropped to",
        "a square, resized to 256x256 and re-encoded as WebP with metadata removed.",
        "Readable licence plates were blurred in some images.",
        "",
        "Vehicle makes and model names are used only to describe what is pictured.",
        "All trademarks belong to their owners; no endorsement is implied.",
        "",
        "| File | Title | Creator | License | Source |",
        "| --- | --- | --- | --- | --- |",
    ]

    def esc(s):
        return (s or "").replace("|", "/").replace("—", "-").replace("–", "-")

    for it in items:
        lic = "CC0 1.0" if it["license"] == "CC0" else "Public Domain Mark 1.0"
        lines.append(
            f"| {it['id']}.webp | {esc(it['title']) or '(untitled)'} | {esc(it['creator']) or '(unknown)'} | {lic} | {it['source']} |"
        )
    with open(os.path.join(out, "CREDITS.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")

    total = sum(it["_bytes"] for it in items)
    print(len(items), "items", total, "bytes", "max", max(it["_bytes"] for it in items))
    low_q = [(it["id"], it["_q"]) for it in items if it["_q"] < 80]
    if low_q:
        print("quality lowered:", low_q)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
