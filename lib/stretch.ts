/**
 * Scores for part of a road (docs/plan.md 11.26).
 *
 * The pipeline saves each road's simulated drive in equal sections (sums of
 * distance, time, cornering load, braking, and left-right changes). Adding up
 * the sections a stretch covers and running the same formulas the pipeline
 * uses gives that stretch's Twisty and Speed. Elevation comes from the road's
 * height profile. Pavement, Flow, Scenic, and Quiet stay whole-road. These are
 * scores only; speeds are never shown.
 */
import type { LoadedRoad, Scores } from "./types";
import type { Spot } from "./spots";
import { decodePolyline } from "./polyline";

export interface StretchModel {
  reference: { mean_lat_g: number; braking_ms_per_km: number; transitions_per_km: number };
  twisty_mix: { cornering: number; braking: number; transitions: number };
  track_ratio_scale: number;
  speed: { zero_at_mph: number; full_at_mph: number };
  elevation_scale: number;
  overall: Record<string, number | string>;
}

export interface DriveBins {
  d: number[];
  t: number[];
  lat: number[];
  brake: number[];
  tr: number[];
}

type LL = [number, number];
const MPH = 0.44704;
const clip = (x: number) => Math.max(0, Math.min(100, x));

function meters(a: LL, b: LL): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111_320;
}

/** Where a point falls along a line, as a share of its length (0 to 1). */
function fractionAlong(line: LL[], p: LL): number {
  let total = 0;
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push((total += meters(line[i - 1], line[i])));
  let best = Infinity;
  let at = 0;
  const k = Math.cos(p[1] * (Math.PI / 180));
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const ax = (a[0] - p[0]) * k, ay = a[1] - p[1];
    const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    if (dist < best) {
      best = dist;
      at = cum[i - 1] + t * (cum[i] - cum[i - 1]);
    }
  }
  return total ? at / total : 0;
}

/** Which part of a road a saved line covers, as shares of the road's length. */
export function stretchOnRoad(road: LoadedRoad, line: LL[]): [number, number] {
  const coords = road.coords as LL[];
  const a = fractionAlong(coords, line[0]);
  const b = fractionAlong(coords, line[line.length - 1]);
  return a <= b ? [a, b] : [b, a];
}

/**
 * Scores for the part of a road between shares f0 and f1. Null when the road
 * has no section data yet (older data) or the stretch is too short to judge.
 */
export function stretchScores(road: LoadedRoad & { bins?: DriveBins }, model: StretchModel | null | undefined, f0: number, f1: number): Scores | null {
  const b = road.bins;
  if (!b || !model || f1 - f0 < 0.05) return null;
  const n = b.d.length;
  let d = 0, t = 0, lat = 0, brake = 0, tr = 0;
  for (let i = 0; i < n; i++) {
    // How much of section i the stretch covers.
    const w = Math.max(0, Math.min(f1, (i + 1) / n) - Math.max(f0, i / n)) * n;
    if (w <= 0) continue;
    d += b.d[i] * w;
    t += b.t[i] * w;
    lat += b.lat[i] * w;
    brake += b.brake[i] * w;
    tr += b.tr[i] * w;
  }
  if (d < 500 || t <= 0) return null;
  const km = d / 1000;
  const ref = model.reference, mix = model.twisty_mix;
  const ratio =
    mix.cornering * Math.min(2, lat / t / ref.mean_lat_g)
    + mix.braking * Math.min(2, brake / km / ref.braking_ms_per_km)
    + mix.transitions * Math.min(2, tr / km / ref.transitions_per_km);
  const twisty = clip(100 * (1 - Math.exp(-ratio / model.track_ratio_scale)));
  const mph = d / t / MPH;
  const speed = clip((100 * (mph - model.speed.zero_at_mph)) / (model.speed.full_at_mph - model.speed.zero_at_mph));

  // Elevation: up and down per km over the same part of the height profile.
  let elevation = road.scores.elevation;
  const prof = road.elevation?.profile_ft ?? [];
  if (prof.length >= 3) {
    const i0 = Math.floor(f0 * (prof.length - 1));
    const i1 = Math.ceil(f1 * (prof.length - 1));
    let updown = 0, whole = 0;
    for (let i = 1; i < prof.length; i++) {
      const step = Math.abs(prof[i] - prof[i - 1]);
      whole += step;
      if (i > i0 && i <= i1) updown += step;
    }
    // The profile is thinned out; scale it to the road's measured climb and descent.
    const true_ft = (road.elevation.climb_ft ?? 0) + (road.elevation.descent_ft ?? 0);
    const scale = whole > 0 && true_ft > 0 ? true_ft / whole : 1;
    elevation = clip(100 * (1 - Math.exp(-((updown * scale * 0.3048) / km) / model.elevation_scale)));
  }

  const f: Record<string, number> = { ...road.scores, twisty, speed, elevation };
  const ow = model.overall;
  const wt = (k: string) => (typeof ow[k] === "number" ? (ow[k] as number) : 0);
  const others = Object.keys(ow).filter((k) => k !== "combine" && k !== "twisty" && k !== "speed" && typeof ow[k] === "number");
  const core = ow.combine === "geometric"
    ? (wt("twisty") + wt("speed")) * Math.sqrt(twisty * speed)
    : wt("twisty") * twisty + wt("speed") * speed;
  const rest = others.reduce((s, k) => s + wt(k) * (f[k] ?? 0), 0);
  const overall = (core + rest) / (wt("twisty") + wt("speed") + others.reduce((s, k) => s + wt(k), 0));

  return {
    ...road.scores,
    overall: Math.round(overall),
    twisty: Math.round(twisty),
    speed: Math.round(speed),
    elevation: Math.round(elevation),
  };
}

/**
 * A saved road-spot's own scores on the road it sits on: null when it covers
 * nearly the whole road (the road's scores apply) or there's no section data.
 */
export function spotStretch(spot: Spot, road: LoadedRoad, model: StretchModel | null | undefined):
  { scores: Scores; f0: number; f1: number } | null {
  if (spot.kind !== "road" || !spot.line) return null;
  const line = decodePolyline(spot.line) as LL[];
  if (line.length < 2) return null;
  const [f0, f1] = spot.road_id === road.id && spot.start_frac !== null && spot.end_frac !== null
    ? [spot.start_frac, spot.end_frac]
    : stretchOnRoad(road, line);
  if (f1 - f0 > 0.92) return null;
  const scores = stretchScores(road, model, f0, f1);
  return scores ? { scores, f0, f1 } : null;
}
