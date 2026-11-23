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

// Divided roads (parkways, boulevards) are two same-name lines, one per
// direction. Tracing follows the side that was tapped: a piece that would mean
// turning back sharper than this, or that mostly runs alongside the line
// already traced (the other side), is not joined.
const MAX_TURN_DEG = 110;
const TWIN_METERS = 150;
const TWIN_SHARE = 0.6;

/** Unit direction (in local meters) from `from` toward the first point at least 25 m away along `pts`. */
function heading(from: LL, pts: LL[]): [number, number] | null {
  const k = Math.cos((from[1] * Math.PI) / 180);
  for (const p of pts) {
    if (meters(from, p) >= 25) {
      const x = (p[0] - from[0]) * k;
      const y = p[1] - from[1];
      const n = Math.hypot(x, y);
      return [x / n, y / n];
    }
  }
  return null;
}

/** Degrees the road turns when going along direction `a`, then `b` (0 = straight on, 180 = U-turn). */
function turnDeg(a: [number, number] | null, b: [number, number] | null): number {
  if (!a || !b) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI;
}

/** Meters from `p` to the nearest point on `line` (local flat approximation). */
function metersToLine(line: LL[], p: LL): number {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111320;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * k, ay = (line[i - 1][1] - p[1]) * 110540;
    const bx = (line[i][0] - p[0]) * k, by = (line[i][1] - p[1]) * 110540;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * True when most of `piece` runs within TWIN_METERS of `line`: the other side
 * of a divided road. Points near the line's two ends don't count, so a piece
 * that simply continues the road isn't mistaken for it (the turn check covers
 * the ends).
 */
function runsAlongside(line: LL[], piece: LL[]): boolean {
  const n = Math.min(piece.length, 10);
  if (n < 2) return false;
  const a = line[0];
  const z = line[line.length - 1];
  let near = 0;
  for (let s = 0; s < n; s++) {
    const p = piece[Math.round((s * (piece.length - 1)) / (n - 1))];
    if (meters(p, a) > 2 * TWIN_METERS && meters(p, z) > 2 * TWIN_METERS && metersToLine(line, p) <= TWIN_METERS) near++;
  }
  return near / n >= TWIN_SHARE;
}

/** Turn at the join if `p` (already flipped as it would be) is added at the line's end or start. */
function joinTurn(line: LL[], p: LL[], atEnd: boolean): number {
  if (atEnd) {
    const end = line[line.length - 1];
    const k = overlapIndex(p, end, true);
    const after = p.slice(k >= 0 ? k : 0);
    const back = heading(end, [...line].reverse());
    return turnDeg(back && [-back[0], -back[1]], heading(after[0], after.slice(1)));
  }
  const start = line[0];
  const k = overlapIndex(p, start, false);
  const before = p.slice(0, k >= 0 ? k + 1 : p.length);
  const into = heading(before[before.length - 1], [...before].reverse());
  return turnDeg(into && [-into[0], -into[1]], heading(start, line.slice(1)));
}

/**
 * Join pieces into one line, growing from the piece nearest the tap. Each step
 * attaches the closest remaining piece to either end. Pieces that overlap the
 * end (tile edges) are trimmed; pieces a short gap away are joined straight.
 */
export function chain(pieces: LL[][], first: number): LL[] {
  const used = new Set([first]);
  let line = [...pieces[first]];
  for (;;) {
    const start = line[0];
    const end = line[line.length - 1];
    let best: { i: number; atEnd: boolean; flip: boolean; d: number } | null = null;
    for (let i = 0; i < pieces.length; i++) {
      if (used.has(i)) continue;
      const p = pieces[i];
      if (runsAlongside(line, p)) continue; // the other side of a divided road
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
      for (const o of options) {
        if (o.d > GAP_METERS || (best && o.d >= best.d)) continue;
        // No U-turns onto the other side of a divided road.
        if (joinTurn(line, o.flip ? [...p].reverse() : p, o.atEnd) > MAX_TURN_DEG) continue;
        best = { i, ...o };
      }
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

  // The tapped piece first, then other pieces near the tap (the other side of a divided road).
  const near = pieces
    .map((p, i) => ({ i, d: pixelDistance(map, p, point) }))
    .filter((x, _, all) => x.d <= Math.min(...all.map((y) => y.d)) + NEAR_SIDE_PX)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.i);
  // Simplifying also removes the short back-and-forth where tile pieces overlap.
  const coords = simplifyLine(bestSide(pieces, near), 2);
  return coords.length > 1 ? { name, coords } : null;
}

/** How far (screen pixels) from the tap the other side of a divided road may be. */
const NEAR_SIDE_PX = 40;

/**
 * Trace from the tapped piece (`starts[0]`). If the map data for that side is
 * cut short, use another nearby start (the other side of the road) when it
 * reaches at least 30% farther.
 */
export function bestSide(pieces: LL[][], starts: number[]): LL[] {
  let best = chain(pieces, starts[0]);
  let bestLen = lengthMeters(best);
  for (const s of starts.slice(1)) {
    const line = chain(pieces, s);
    const len = lengthMeters(line);
    if (len > 1.3 * bestLen) {
      best = line;
      bestLen = len;
    }
  }
  return best;
}

function lengthMeters(line: LL[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += meters(line[i - 1], line[i]);
  return s;
}
