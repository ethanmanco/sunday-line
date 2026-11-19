"""Render review contact sheets of downloaded candidates (square center crops,
numbered) so a human can pick keepers and spot logos, faces, plates.

Usage: python -I scripts/avatars/contact_sheets.py <workdir>
Writes <workdir>/sheets/sheet-NN.jpg and <workdir>/sheets/index.txt
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageOps

TILE = 220
COLS, ROWS = 6, 5


def square(im, pos=0.5, zoom=1.0):
    im = ImageOps.exif_transpose(im).convert("RGB")
    w, h = im.size
    s = int(min(w, h) / zoom)
    if w >= h:
        x = int((w - s) * pos)
        y = (h - s) // 2
    else:
        x = (w - s) // 2
        y = int((h - s) * pos)
    return im.crop((x, y, x + s, y + s))


def main(wd):
    cands = json.load(open(os.path.join(wd, "candidates.json"), encoding="utf-8"))
    out = os.path.join(wd, "sheets")
    os.makedirs(out, exist_ok=True)
    per = COLS * ROWS
    lines = []
    for si in range(0, len(cands), per):
        sheet = Image.new("RGB", (COLS * TILE, ROWS * (TILE + 16)), "white")
        d = ImageDraw.Draw(sheet)
        for j, c in enumerate(cands[si:si + per]):
            idx = si + j
            fn = os.path.join(wd, "dl", c["ov"]["id"] + ".img")
            x, y = (j % COLS) * TILE, (j // COLS) * (TILE + 16)
            try:
                im = Image.open(fn)
                sz = im.size
                t = square(im).resize((TILE - 4, TILE - 4))
                sheet.paste(t, (x + 2, y + 2))
            except Exception:  # noqa: BLE001
                sz = (0, 0)
            d.rectangle((x, y + TILE, x + TILE, y + TILE + 16), fill="black")
            d.text((x + 3, y + TILE + 2), f"{idx} {c['key'][:24]}", fill="yellow")
            lines.append(f"{idx}\t{c['key']}\t{c['ov']['license']}\t{sz[0]}x{sz[1]}\t{(c['ov'].get('title') or '')[:70]}")
        sheet.save(os.path.join(out, f"sheet-{si // per:02d}.jpg"), quality=85)
    with open(os.path.join(out, "index.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(len(cands), "candidates,", (len(cands) + per - 1) // per, "sheets")


if __name__ == "__main__":
    main(sys.argv[1])
