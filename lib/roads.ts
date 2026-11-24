import type { LoadedRoad, Road } from "./types";

export type View = "drivers" | "scenic" | "gravel" | "bounties" | "all";
export type SortKey = "overall" | "twisty" | "speed" | "pavement" | "scenic" | "elevation" | "length" | "distance";
export type Bounds = [number, number, number, number]; // west, south, east, north

export interface Filters {
  view: View;
  sort: SortKey;
  maxMiles: number | null; // distance from the origin; null = any
  minMiles: number;
  inView: boolean;
}

export const DEFAULT_FILTERS: Filters = { view: "drivers", sort: "overall", maxMiles: null, minMiles: 0, inView: true };

export const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "drivers", label: "Driver's roads", hint: "Paved, 35 mph or more, not inside parks" },
  { key: "scenic", label: "Scenic", hint: "Mountains, coast, forest, desert, and water at any speed, Scenic 50 and up" },
  { key: "gravel", label: "Gravel", hint: "Gravel and dirt roads for rally fans" },
  { key: "bounties", label: "Bounties", hint: "Roads that need a check. A confirmed answer earns rep" },
  { key: "all", label: "All", hint: "Every candidate, with the reason it left the main list" },
];

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "twisty", label: "Twisty" },
  { key: "speed", label: "Speed" },
  { key: "pavement", label: "Pavement" },
  { key: "scenic", label: "Scenic" },
  { key: "elevation", label: "Elevation" },
  { key: "length", label: "Length" },
  { key: "distance", label: "Distance" },
];

/** The score that colors the map and the badge in each view. */
export function badgeKey(view: View): "overall" | "scenic" | "twisty" {
  if (view === "scenic") return "scenic";
  if (view === "gravel") return "twisty";
  return "overall";
}

export function defaultSort(view: View): SortKey {
  return badgeKey(view);
}

const NOT_SCENIC = /neighborhood|off-road|motor/;
/** Below this Scenic score a road doesn't look scenic, so the Scenic list leaves it out (11.46). */
export const MIN_SCENIC = 50;

export function inView(r: Road, view: View): boolean {
  switch (view) {
    case "drivers":
      return r.category === "drivers";
    case "gravel":
      return r.category === "gravel";
    case "bounties":
      return r.category === "unsure";
    case "scenic":
      return r.category !== "gravel" && r.category !== "unsure" && r.scores.scenic >= MIN_SCENIC && !r.excluded.some((e) => NOT_SCENIC.test(e));
    default:
      return true;
  }
}

const R_MI = 3958.8;

export function haversineMi(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Miles from a point to the nearest end of the road. */
export function distanceMi(r: Road, origin: [number, number]): number {
  return Math.min(haversineMi(origin, r.start), haversineMi(origin, r.end));
}

export function intersects(b: Road["bbox"], v: Bounds): boolean {
  return b[0] <= v[2] && b[2] >= v[0] && b[1] <= v[3] && b[3] >= v[1];
}

export function lengthMi(r: Road): number {
  return r.length_m / 1609.344;
}

export function applyFilters<T extends Road>(roads: T[], f: Filters, origin: [number, number], bounds: Bounds | null): T[] {
  const dist = new Map<string, number>();
  const d = (r: T) => {
    let v = dist.get(r.id);
    if (v === undefined) {
      v = distanceMi(r, origin);
      dist.set(r.id, v);
    }
    return v;
  };
  const out = roads.filter(
    (r) =>
      inView(r, f.view) &&
      lengthMi(r) >= f.minMiles &&
      (f.maxMiles === null || d(r) <= f.maxMiles) &&
      (!f.inView || !bounds || intersects(r.bbox, bounds)),
  );
  const key = (r: T): number => {
    switch (f.sort) {
      case "length":
        return -r.length_m;
      case "distance":
        return d(r);
      default:
        return -r.scores[f.sort];
    }
  };
  return out.sort((a, b) => key(a) - key(b) || b.scores.overall - a.scores.overall);
}

// Color ramp for scores: dim violet (low) to bright amber (high). It also runs
// dark to light, so it still reads with common color blindness, and the number
// is always shown next to the color.
export const RAMP: [number, string][] = [
  [35, "#4b2c86"],
  [50, "#9a3290"],
  [60, "#d4466a"],
  [70, "#f27d3b"],
  [80, "#fbd44c"],
];

export function scoreColor(v: number): string {
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (v <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    const [b, cb] = RAMP[i];
    if (v <= b) {
      const [a, ca] = RAMP[i - 1];
      const t = (v - a) / (b - a);
      const x = hex(ca);
      const y = hex(cb);
      return `rgb(${x.map((c, k) => Math.round(c + (y[k] - c) * t)).join(",")})`;
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/** Text color that stays readable on top of scoreColor(v). */
export function scoreInk(v: number): string {
  return v >= 62 ? "#15120c" : "#ffffff";
}

export function lengthText(r: Road, units: "imperial" | "metric"): string {
  return units === "imperial" ? `${lengthMi(r).toFixed(1)} mi` : `${(r.length_m / 1000).toFixed(1)} km`;
}

export function milesText(mi: number): string {
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/** Which way each end of the road lies, like "west end" and "east end". */
export function endNames(r: Road): [string, string] {
  const [x1, y1] = r.start;
  const [x2, y2] = r.end;
  const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * (Math.PI / 180));
  const dy = y2 - y1;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["west end", "east end"] : ["east end", "west end"];
  return dy >= 0 ? ["south end", "north end"] : ["north end", "south end"];
}

export function directionsLinks(p: [number, number]) {
  const ll = `${p[1]},${p[0]}`;
  return [
    { label: "Google Maps", href: `https://www.google.com/maps/dir/?api=1&destination=${ll}` },
    { label: "Apple Maps", href: `https://maps.apple.com/?daddr=${ll}` },
    { label: "Waze", href: `https://waze.com/ul?ll=${ll}&navigate=yes` },
  ];
}

export function streetViewLink(p: [number, number]): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p[1]},${p[0]}`;
}

export function midpoint(r: LoadedRoad): [number, number] {
  return r.coords[Math.floor(r.coords.length / 2)];
}

export const STATUS_LABEL: Record<Road["status"], string> = {
  candidate: "Candidate",
  community_submitted: "Community submitted",
  verified: "Verified",
  flagged: "Flagged: not worth it",
  retired: "Retired",
};

/** Short speed limit text for list rows. Says "estimated" when it is. */
export function speedShort(r: Road): string {
  const { min, max, units, source } = r.speed;
  if (min === null || max === null) return "speed limit unknown";
  const v = min === max ? `${min} ${units}` : `${min} to ${max} ${units}`;
  switch (source) {
    case "posted":
      return `${v} posted`;
    case "state_default":
      return `${v} state default`;
    case "estimated":
      return `about ${v}, estimated`;
    default:
      return `${v}, partly estimated`;
  }
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
