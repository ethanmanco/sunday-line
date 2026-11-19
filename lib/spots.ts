import { decodePolyline } from "./polyline";
import { loadIndex, loadTop } from "./roadData";
import type { LoadedRoad } from "./types";

export type SpotKind = "point" | "road";
export type SpotCategory = "meetup" | "scenic" | "food" | "gas" | "parking" | "track" | "other";
export type SpotPublicStatus = "none" | "pending" | "approved" | "rejected";
export type SpotsDisplay = "all" | "selected" | "groups" | "none";

export interface Spot {
  id: string;
  owner_id: string;
  kind: SpotKind;
  name: string;
  description: string | null;
  category: SpotCategory | null;
  lat: number;
  lng: number;
  road_id: string | null;
  road_region: string | null;
  start_frac: number | null;
  end_frac: number | null;
  line: string | null;
  show_on_profile: boolean;
  public_status: SpotPublicStatus;
  public_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  /** A group's view of the spot: suggested or accepted there. */
  group_status?: "proposed" | "accepted";
  /** Groups the spot is in (filled in where it matters). */
  group_ids?: string[];
  /** Filled in by the main map for group spots. */
  group_name?: string | null;
}

export type SpotGroupStatus = "proposed" | "accepted";
export interface SpotLink {
  group_id: string;
  status: SpotGroupStatus;
}

/** Rows from spot_groups with the spot embedded, flattened to spots. */
export function linkedSpots(rows: unknown): Spot[] {
  const out: Spot[] = [];
  for (const r of (rows as { status: SpotGroupStatus; group_id?: string; spot: Spot | null }[] | null) ?? []) {
    if (r.spot) out.push({ ...r.spot, group_status: r.status });
  }
  return out;
}

/**
 * Every spot uses one cool gradient (teal, sky, lavender) so spots read as
 * their own thing next to the warm Driver's road colors, whatever their
 * category or score (11.26).
 */
export const SPOT_STOPS = ["#2dd4bf", "#38bdf8", "#a78bfa"] as const;
export const SPOT_COLOR = SPOT_STOPS[1];
export const SPOT_GRADIENT_CSS = `linear-gradient(135deg, ${SPOT_STOPS.join(", ")})`;

export const CATEGORY_LABEL: Record<SpotCategory, string> = {
  meetup: "Meetup spot",
  scenic: "Scenic stop",
  food: "Food",
  gas: "Gas",
  parking: "Parking",
  track: "Track or venue",
  other: "Other",
};

export const CATEGORY_COLOR: Record<SpotCategory, string> = {
  meetup: "#f5a524",
  scenic: "#46a758",
  food: "#e5484d",
  gas: "#3e8ed0",
  parking: "#8b939e",
  track: "#8e4ec6",
  other: "#e8ebef",
};

export const PUBLIC_LABEL: Record<SpotPublicStatus, string> = {
  none: "Not public",
  pending: "Waiting for review",
  approved: "On the public map",
  rejected: "Not approved for the public map",
};

export function spotLabel(s: Pick<Spot, "kind" | "category">): string {
  return s.kind === "road" ? "Road" : CATEGORY_LABEL[s.category ?? "other"];
}

/** Encode [lon, lat] pairs as a Google polyline (precision 5). */
export function encodePolyline(coords: [number, number][]): string {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * 1e5);
    const lo = Math.round(lon * 1e5);
    out += enc(la - pLat) + enc(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out;
}

function meters(a: [number, number], b: [number, number]): number {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  const y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6371000;
}

/** Cumulative distance along a line, in meters. */
export function cumulative(coords: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + meters(coords[i - 1], coords[i]));
  return out;
}

function pointAt(coords: [number, number][], cum: number[], d: number): [number, number] {
  if (d <= 0) return coords[0];
  const total = cum[cum.length - 1];
  if (d >= total) return coords[coords.length - 1];
  let i = 1;
  while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  const a = coords[i - 1];
  const b = coords[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The part of a line between two fractions of its length (0 to 1). */
export function sliceLine(coords: [number, number][], start: number, end: number): [number, number][] {
  if (coords.length < 2) return coords;
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  const a = Math.max(0, Math.min(start, end)) * total;
  const b = Math.min(1, Math.max(start, end)) * total;
  const out: [number, number][] = [pointAt(coords, cum, a)];
  for (let i = 0; i < coords.length; i++) if (cum[i] > a && cum[i] < b) out.push(coords[i]);
  out.push(pointAt(coords, cum, b));
  return out;
}

export function lineMiles(coords: [number, number][]): number {
  const c = cumulative(coords);
  return c[c.length - 1] / 1609.344;
}

/** The region's roads, loaded once per page. */
let roadsPromise: Promise<{ bbox: [number, number, number, number]; roads: LoadedRoad[] }> | null = null;
export function loadRoads(): Promise<{ bbox: [number, number, number, number]; roads: LoadedRoad[] }> {
  roadsPromise ??= Promise.all([loadIndex(), loadTop()])
    .then(([i, roads]) => ({ bbox: i.bbox, roads: roads as LoadedRoad[] }))
    .catch((e) => {
      roadsPromise = null;
      throw e;
    });
  return roadsPromise;
}

/** Road spots record the data set they came from. */
export const ROAD_REGION = "us";

/** Spots as map features: points and road stretches. */
export function spotFeatures(spots: Spot[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: spots.map((s) => ({
      type: "Feature",
      id: s.id,
      properties: {
        id: s.id,
        name: s.name,
        kind: s.kind,
        color: SPOT_COLOR,
      },
      geometry:
        s.kind === "road" && s.line
          ? { type: "LineString", coordinates: decodePolyline(s.line) }
          : { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  };
}

export function spotsBbox(spots: Spot[]): [number, number, number, number] | null {
  const pts: [number, number][] = [];
  for (const s of spots) {
    if (s.kind === "road" && s.line) pts.push(...decodePolyline(s.line));
    else pts.push([s.lng, s.lat]);
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Drop points that sit within `tolerance` meters of the line (Douglas-Peucker). Curves keep their shape. */
export function simplifyLine(coords: [number, number][], tolerance = 3): [number, number][] {
  if (coords.length < 3) return coords;
  const lat0 = (coords[0][1] * Math.PI) / 180;
  const xy = coords.map(([lon, lat]) => [lon * 111320 * Math.cos(lat0), lat * 110540] as [number, number]);
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}
