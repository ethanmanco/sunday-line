// A day route (11.85): roads picked to drive in one day, in an order, opened
// as one set of directions in the person's own maps app. Kept in this
// browser's storage only; nothing about it is sent anywhere.

import { decodePolyline } from "./polyline";
import { haversineMi } from "./roads";
import type { LoadedRoad } from "./types";
import type { Spot } from "./spots";

type LL = [number, number];

export interface RouteStop {
  id: string;
  name: string;
  near: string | null;
  state: string | null;
  cell: string | null;
  start: LL;
  end: LL;
  /** The road's line (encoded), to draw it on the map. */
  line: string;
  miles: number;
  /** Driven end to start. */
  reversed?: boolean;
}

const KEY = "sl-day-route";
export const MAX_STOPS = 20;
/** Google Maps takes a destination and up to 9 stops in one link. */
const POINTS_PER_LINK = 10;

export function getRoute(): RouteStop[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RouteStop[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function setRoute(list: RouteStop[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_STOPS)));
  } catch {
    // Storage blocked: the route lasts until the page closes.
  }
  window.dispatchEvent(new Event("sl-route"));
}

export const inRoute = (id: string) => getRoute().some((s) => s.id === id);

export function stopFor(r: LoadedRoad & { cell?: string }): RouteStop {
  return {
    id: r.id, name: r.name, near: r.near, state: r.state, cell: r.cell ?? null,
    start: r.start, end: r.end, line: r.line, miles: r.length_m / 1609.344,
  };
}

/** Add a road at the end (true), or say it's full (false). */
export function addToRoute(r: LoadedRoad & { cell?: string }): boolean {
  const list = getRoute();
  if (list.some((s) => s.id === r.id)) return true;
  if (list.length >= MAX_STOPS) return false;
  setRoute([...list, stopFor(r)]);
  return true;
}

export const removeFromRoute = (id: string) => setRoute(getRoute().filter((s) => s.id !== id));

export function moveStop(list: RouteStop[], i: number, by: -1 | 1): RouteStop[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export const entry = (s: RouteStop): LL => (s.reversed ? s.end : s.start);
export const exit = (s: RouteStop): LL => (s.reversed ? s.start : s.end);

/**
 * A short order: from `from` (or the first road's start), each next road is
 * the one with an end closest to where the last one finished, driven from that end.
 */
export function bestOrder(stops: RouteStop[], from?: LL | null): RouteStop[] {
  if (stops.length < 2 && !from) return stops;
  const left = stops.map((s) => ({ ...s, reversed: false }));
  const out: RouteStop[] = [];
  let at: LL = from ?? left[0].start;
  while (left.length) {
    let best = 0;
    let rev = false;
    let d = Infinity;
    left.forEach((s, i) => {
      const a = haversineMi(at, s.start);
      const b = haversineMi(at, s.end);
      if (a < d) [d, best, rev] = [a, i, false];
      if (b < d) [d, best, rev] = [b, i, true];
    });
    const s = { ...left.splice(best, 1)[0], reversed: rev };
    out.push(s);
    at = exit(s);
  }
  return out;
}

/** Miles on the roads, and straight-line miles between them (driving between is longer). */
export function routeMiles(stops: RouteStop[]): { roads: number; between: number } {
  let between = 0;
  for (let i = 1; i < stops.length; i++) between += haversineMi(exit(stops[i - 1]), entry(stops[i]));
  return { roads: stops.reduce((a, s) => a + s.miles, 0), between };
}

/** The point halfway along a road's line (by distance); the middle of its ends if there's no line. */
export function middle(s: RouteStop): LL {
  const pts = s.line ? decodePolyline(s.line) : [];
  if (pts.length < 2) return [(s.start[0] + s.end[0]) / 2, (s.start[1] + s.end[1]) / 2];
  const legs = pts.slice(1).map((p, i) => haversineMi(pts[i], p));
  let left = legs.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i] && legs[i] > 0) {
      const t = left / legs[i];
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    left -= legs[i];
  }
  return pts[pts.length - 1];
}

/**
 * How the route goes into Google Maps (11.98). "one": a stop halfway along each
 * road and the last road's far end, so there are half as many stops to clear
 * and Google picks the way on and off each road. "ends": each road's two ends,
 * so every road is driven end to end, two stops a road.
 */
export type StopsPerRoad = "one" | "ends";
const STOPS_KEY = "sl-route-stops";
export function getStopsPerRoad(): StopsPerRoad {
  try {
    return localStorage.getItem(STOPS_KEY) === "ends" ? "ends" : "one";
  } catch {
    return "one";
  }
}
export function setStopsPerRoad(v: StopsPerRoad) {
  try {
    localStorage.setItem(STOPS_KEY, v);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/**
 * Google Maps links for the route: one link while it fits (a destination and
 * nine stops), parts after that. Each part starts from wherever the phone is.
 */
export function googleParts(stops: RouteStop[], from?: LL | null, per: StopsPerRoad = "one"): { label: string; href: string }[] {
  // Each point remembers which road it belongs to, for the part labels.
  const points: { p: LL; road: number }[] = per === "ends"
    ? stops.flatMap((s, i) => [{ p: entry(s), road: i }, { p: exit(s), road: i }])
    : stops.length
      ? [...stops.map((s, i) => ({ p: middle(s), road: i })), { p: exit(stops[stops.length - 1]), road: stops.length - 1 }]
      : [];
  const parts: { label: string; href: string }[] = [];
  const ll = (p: LL) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`;
  for (let i = 0; i < points.length;) {
    let end = Math.min(points.length, i + POINTS_PER_LINK);
    // Don't leave a last part that's only the final road's far end.
    if (points.length - end === 1) end -= 1;
    const chunk = points.slice(i, end);
    const dest = chunk[chunk.length - 1].p;
    const way = chunk.slice(0, -1).map((c) => ll(c.p)).join("|");
    const first = chunk[0].road + 1;
    const last = chunk[chunk.length - 1].road + 1;
    parts.push({
      label: points.length > POINTS_PER_LINK ? (first === last ? `Road ${first}` : `Roads ${first} to ${last}`) : "Whole route",
      href: `https://www.google.com/maps/dir/?api=1&travelmode=driving${from && i === 0 ? `&origin=${ll(from)}` : ""}&destination=${ll(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ""}`,
    });
    i = end;
  }
  return parts;
}

/** The route's roads as map items, so the map can draw them like a page's spots. */
export const ROUTE_OWNER = "day-route";
export function routeOnMap(stops: RouteStop[]): Spot[] {
  return stops.map((s) => ({
    id: s.id, owner_id: ROUTE_OWNER, kind: "road", name: s.name, description: null, category: null,
    lat: entry(s)[1], lng: entry(s)[0], road_id: s.id, road_region: null, start_frac: null, end_frac: null,
    line: s.line, show_on_profile: false, public_status: "none", public_note: null, submitted_at: null,
    reviewed_at: null, created_at: "",
  }));
}
