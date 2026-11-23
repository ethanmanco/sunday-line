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
  /** Filled in by the main map: whose colors this spot shows (11.48). */
  colors?: string[];
  /** Filled in by the main map for group spots. */
  group_name?: string | null;
}

/** A drawn road's on-request score (11.27). */
export interface RoadScore {
  spot_id: string;
  status: "queued" | "scoring" | "done" | "failed";
  requested_at: string;
  scored_at: string | null;
  scores: Record<string, number> | null;
  details: {
    miles?: number; state?: string | null; speed_limit?: string; speed_limit_posted_share?: number;
    pavement_why?: string; surface?: string; climb_ft?: number; descent_ft?: number; profile_ft?: number[];
    junctions?: number; stops?: number; signals?: number; note?: string;
  } | null;
  note: string | null;
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
 * Spot colors say whose a spot is (11.48). They're all cool, so they never
 * read as a road score (the warm Driver's road ramp): your own spots are teal,
 * each group has its own color, and public map spots are light slate. A spot
 * in several groups carries each group's color. On a road spot the center line
 * keeps the road's score color (if it has one) and the owners' colors are the
 * outline.
 */
export const MINE_COLOR = "#2dd4bf";
export const PUBLIC_COLOR = "#cbd5e1";
/** Group colors, by groups.color (0-6). */
export const GROUP_COLORS = ["#38bdf8", "#3b82f6", "#6366f1", "#a78bfa", "#22d3ee", "#4ade80", "#bae6fd"] as const;
export const GROUP_COLOR_NAMES = ["Sky", "Blue", "Indigo", "Violet", "Cyan", "Green", "Ice"] as const;
export const groupColor = (c: number | null | undefined): string => GROUP_COLORS[c ?? 0] ?? GROUP_COLORS[0];
/** Kept for older callers: the color a spot shows when nothing else is known. */
export const SPOT_COLOR = MINE_COLOR;

/** Whose colors a spot shows: its own `colors` if the map worked them out, else yours (teal) or public. */
export function spotColors(s: Spot, me: string | null = null): string[] {
  if (s.colors?.length) return s.colors;
  return [s.owner_id === me ? MINE_COLOR : PUBLIC_COLOR];
}

/** A CSS background for a spot's colors: solid, or equal slices for several. */
export function spotColorsCss(colors: string[]): string {
  if (colors.length <= 1) return colors[0] ?? PUBLIC_COLOR;
  const step = 100 / colors.length;
  return `conic-gradient(${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
}

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

/**
 * Spots as map features: points and road stretches. With `bands`, each road
 * spot also gets one ring per owner color (the main map draws them as wider
 * lines under it, innermost first; MapLibre can't vary a gradient per road).
 */
export function spotFeatures(spots: Spot[], opts: { me?: string | null; bands?: boolean; score?: (s: Spot) => number | null } = {}): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of spots) {
    const colors = spotColors(s, opts.me ?? null);
    if (s.kind === "road" && s.line) {
      const coordinates = decodePolyline(s.line);
      const score = opts.score?.(s) ?? null;
      features.push({
        type: "Feature",
        id: s.id,
        properties: { id: s.id, name: s.name, kind: s.kind, color: colors[0], ...(score !== null ? { score } : {}) },
        geometry: { type: "LineString", coordinates },
      });
      if (opts.bands) {
        // One ring per owner color around the line, the first (yours) innermost (11.52).
        colors.forEach((color, r) => {
          features.push({
            type: "Feature",
            properties: { id: s.id, band: true, color, r },
            geometry: { type: "LineString", coordinates },
          });
        });
      }
    } else {
      features.push({
        type: "Feature",
        id: s.id,
        properties: { id: s.id, name: s.name, kind: s.kind, color: colors[0], icon: `spotpin:${colors.join(",")}` },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** The map pin for a place: a dot split into equal slices of its owners' colors (11.48). */
export function spotPinIcon(id: string): ImageData | null {
  if (!id.startsWith("spotpin:") || typeof document === "undefined") return null;
  const colors = id.slice(8).split(",").filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (!colors.length) return null;
  const S = 40;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = 16;
  colors.forEach((color, i) => {
    const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / colors.length;
    const a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / colors.length;
    g.beginPath();
    g.moveTo(20, 20);
    g.arc(20, 20, r, a0, a1);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  });
  g.beginPath();
  g.arc(20, 20, r, 0, Math.PI * 2);
  g.lineWidth = 4;
  g.strokeStyle = "#0b0d11";
  g.stroke();
  g.beginPath();
  g.arc(20, 20, 5, 0, Math.PI * 2);
  g.fillStyle = "#0b0d11";
  g.fill();
  return g.getImageData(0, 0, S, S);
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
