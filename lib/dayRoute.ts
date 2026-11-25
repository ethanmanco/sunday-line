// A day route (11.85): roads picked to drive in one day, in an order, opened
// as one set of directions in the person's own maps app. Kept in this
// browser's storage only; nothing about it is sent anywhere.

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

/**
 * Google Maps links for the route, in parts of up to five roads (a road is two
 * stops: its two ends). Each part starts from wherever the phone is.
 */
export function googleParts(stops: RouteStop[], from?: LL | null): { label: string; href: string }[] {
  const points = stops.flatMap((s) => [entry(s), exit(s)]);
  const parts: { label: string; href: string }[] = [];
  for (let i = 0; i < points.length; i += POINTS_PER_LINK) {
    const chunk = points.slice(i, i + POINTS_PER_LINK);
    const ll = (p: LL) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`;
    const dest = chunk[chunk.length - 1];
    const way = chunk.slice(0, -1).map(ll).join("|");
    const first = i / 2 + 1;
    const last = Math.min(stops.length, (i + chunk.length) / 2);
    parts.push({
      label: points.length > POINTS_PER_LINK ? `Roads ${first} to ${last}` : "Whole route",
      href: `https://www.google.com/maps/dir/?api=1&travelmode=driving${from && i === 0 ? `&origin=${ll(from)}` : ""}&destination=${ll(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ""}`,
    });
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
