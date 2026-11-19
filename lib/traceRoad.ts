// Trace any road from the base map, for roads that aren't in our suggested list.
//
// The base map is cut into tiles, so one road arrives as many pieces (and the
// pieces overlap a little at tile edges). We find the road under the tap, then
// join every loaded piece with the same name into one line. Only tiles that are
// loaded count, so zooming out to fit the road first traces more of it.

import type { Map as MLMap, MapGeoJSONFeature, PointLike } from "maplibre-gl";
import { simplifyLine } from "./spots";

type LL = [number, number];

const ROAD_LAYERS = ["road-minor", "road-mid", "road-major", "road-highway"];
const JOIN_METERS = 90;

function meters(a: LL, b: LL): number {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  return Math.hypot(x, (b[1] - a[1]) * k) * 6371000;
}

function parts(f: GeoJSON.Feature): LL[][] {
  const g = f.geometry;
  if (g.type === "LineString") return [g.coordinates as LL[]];
  if (g.type === "MultiLineString") return g.coordinates as LL[][];
  return [];
}

function nameOf(f: MapGeoJSONFeature | GeoJSON.Feature): string | null {
  const p = f.properties ?? {};
  return (p["name:en"] as string) || (p.name as string) || (p.ref as string) || null;
}

/** Distance in screen pixels from a point to a line. */
function pixelDistance(map: MLMap, line: LL[], px: { x: number; y: number }): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = map.project(line[i - 1]);
    const b = map.project(line[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((px.x - a.x) * dx + (px.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + t * dx - px.x, a.y + t * dy - px.y));
  }
  return best;
}

/** Index of the point in `line` (searching from one end) closest to `p`, or -1 if none is close. */
function overlapIndex(line: LL[], p: LL, fromStart: boolean): number {
  let best = -1;
  let bestD = JOIN_METERS;
  const n = Math.min(line.length, 12);
  for (let k = 0; k < n; k++) {
    const i = fromStart ? k : line.length - 1 - k;
    const d = meters(line[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The map's road-name data has small gaps (bridges, short segments); bridge up to this. */
const GAP_METERS = 400;

/**
 * Join pieces into one line, growing from the piece nearest the tap. Each step
 * attaches the closest remaining piece to either end. Pieces that overlap the
 * end (tile edges) are trimmed; pieces a short gap away are joined straight.
 */
function chain(pieces: LL[][], first: number): LL[] {
  const used = new Set([first]);
  let line = [...pieces[first]];
  for (;;) {
    const start = line[0];
    const end = line[line.length - 1];
    let best: { i: number; atEnd: boolean; flip: boolean; d: number } | null = null;
    for (let i = 0; i < pieces.length; i++) {
      if (used.has(i)) continue;
      const p = pieces[i];
      const options = [
        { atEnd: true, flip: false, d: meters(end, p[0]) },
        { atEnd: true, flip: true, d: meters(end, p[p.length - 1]) },
        { atEnd: false, flip: false, d: meters(start, p[p.length - 1]) },
        { atEnd: false, flip: true, d: meters(start, p[0]) },
      ];
      // Tile edges: the piece may start a little behind the end it continues.
      const o1 = overlapIndex(p, end, true);
      const o2 = overlapIndex(p, end, false);
      const o3 = overlapIndex(p, start, false);
      const o4 = overlapIndex(p, start, true);
      if (o1 >= 0) options.push({ atEnd: true, flip: false, d: 0 });
      if (o2 >= 0) options.push({ atEnd: true, flip: true, d: 0 });
      if (o3 >= 0) options.push({ atEnd: false, flip: false, d: 0 });
      if (o4 >= 0) options.push({ atEnd: false, flip: true, d: 0 });
      for (const o of options) if (o.d <= GAP_METERS && (!best || o.d < best.d)) best = { i, ...o };
    }
    if (!best) return line;
    used.add(best.i);
    let p = best.flip ? [...pieces[best.i]].reverse() : pieces[best.i];
    if (best.atEnd) {
      const k = overlapIndex(p, end, true);
      line = line.concat(p.slice(k >= 0 ? k + 1 : 0));
    } else {
      const k = overlapIndex(p, start, false);
      p = p.slice(0, k >= 0 ? k : p.length);
      line = p.concat(line);
    }
  }
}

function dedupe(pieces: LL[][]): LL[][] {
  const seen = new Set<string>();
  return pieces.filter((p) => {
    if (p.length < 2) return false;
    const key = [p[0], p[p.length - 1], p.length].map(String).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface TracedRoad {
  name: string | null;
  coords: LL[];
}

/** The base map road under a tap, traced as far as the loaded tiles go. */
export function traceRoadAt(map: MLMap, point: { x: number; y: number }): TracedRoad | null {
  const box: [PointLike, PointLike] = [[point.x - 10, point.y - 10], [point.x + 10, point.y + 10]];
  const hits = map.queryRenderedFeatures(box, { layers: ROAD_LAYERS });
  if (!hits.length) return null;

  // The exact road segment under the finger: nearest line among the hits, and
  // within it the nearest two-point stretch.
  let seg: [LL, LL] | null = null;
  let segD = Infinity;
  for (const h of hits) {
    for (const line of parts(h)) {
      for (let i = 1; i < line.length; i++) {
        const d = pixelDistance(map, [line[i - 1], line[i]], point);
        if (d < segD) {
          segD = d;
          seg = [line[i - 1], line[i]];
        }
      }
    }
  }
  if (!seg) return null;
  // Three points on that stretch around the spot nearest the tap (up to 12 px
  // either side), so a cross street that only touches it at a corner won't match.
  const a = map.project(seg[0]);
  const b = map.project(seg[1]);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const foot = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (len * len)));
  const step = 12 / len;
  const probes = [foot - step, foot, foot + step]
    .map((t) => Math.max(0, Math.min(1, t)))
    .map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));

  // Road names live in a separate base map layer. The right name is the line
  // that runs along the tapped stretch, not one that just meets it at a corner.
  const named = map.querySourceFeatures("omt", { sourceLayer: "transportation_name" });
  let name: string | null = null;
  let nearest = 8;
  for (const f of named) {
    const n = nameOf(f);
    if (!n) continue;
    for (const line of parts(f)) {
      const d = Math.max(...probes.map((p) => pixelDistance(map, line, p)));
      if (d < nearest) {
        nearest = d;
        name = n;
      }
    }
  }

  let pieces: LL[][];
  if (name) {
    pieces = dedupe(named.filter((f) => nameOf(f) === name).flatMap(parts));
  } else {
    // Unnamed road: just the piece that was tapped.
    pieces = dedupe(hits.slice(0, 1).flatMap(parts));
  }
  if (!pieces.length) return null;

  let first = 0;
  let best = Infinity;
  pieces.forEach((p, i) => {
    const d = pixelDistance(map, p, point);
    if (d < best) {
      best = d;
      first = i;
    }
  });
  // Simplifying also removes the short back-and-forth where tile pieces overlap.
  const coords = simplifyLine(chain(pieces, first), 2);
  return coords.length > 1 ? { name, coords } : null;
}
