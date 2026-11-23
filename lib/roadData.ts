// Road data for the whole country, loaded by area.
//
//   index.json             which 1-degree squares have roads
//   top.json               top 2 roads per square, light: whole-country view
//   blocks/<lat>_<lon>.json  top roads per square in a 5-degree block, light: region view
//   cells/<lat>_<lon>.json   every road in a square, full: zoomed in
//
// "Light" roads have enough for the map and list; the full road loads when
// someone opens it.

import { decodePolyline } from "./polyline";
import { getSupabase } from "./supabase";
import type { Bounds } from "./roads";
import type { LoadedRoad, Road } from "./types";

export const DATA_BASE = "/data/us";

/**
 * The road squares (cells/) are too big for the site's own static files, so
 * they're served from GitHub Pages (11.31). Set NEXT_PUBLIC_CELLS_BASE to
 * "/data/us" to read local files while developing.
 */
export const CELLS_BASE = process.env.NEXT_PUBLIC_CELLS_BASE || "https://ethanmanco.github.io/sunday-line-data";

export interface DataIndex {
  version: number;
  generated: string;
  scoring_version: string | null;
  license: string;
  units: "imperial";
  regions: string[];
  bbox: [number, number, number, number];
  roads: number;
  cells: Record<string, number>;
  blocks: string[];
  /** Constants for scoring part of a road (11.26). */
  stretch?: import("./stretch").StretchModel;
}

/** The lower 48 (used before the data says otherwise). */
export const US_BBOX: [number, number, number, number] = [-125, 24.5, -66.9, 49.5];

/** View width in degrees at which each level kicks in. */
export const CELLS_BELOW = 4.5;
export const BLOCKS_BELOW = 16;

export type RoadOnMap = LoadedRoad & { cell?: string; light?: boolean };

const json = <T,>(url: string) =>
  fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json() as Promise<T>;
  });

const decode = (roads: Road[]): RoadOnMap[] => roads.map((r) => ({ ...r, coords: decodePolyline(r.line) }));

// ---- Road checks (11.38): what members flagged and the site admin accepted ----

export type CheckKind = "gravel" | "private" | "closed" | "rough";
export const CHECK_REASON: Record<CheckKind, string> = {
  gravel: "gravel or dirt (members flagged it, checked)",
  private: "private or no entry (members flagged it, checked)",
  closed: "closed or doesn't go through (members flagged it, checked)",
  rough: "poor pavement (members flagged it, checked)",
};

let checksP: Promise<Map<string, CheckKind[]>> | null = null;
/** Accepted road checks, loaded once per visit (empty if accounts are off or offline). */
export function loadRoadChecks(): Promise<Map<string, CheckKind[]>> {
  checksP ??= (async () => {
    const out = new Map<string, CheckKind[]>();
    const sb = getSupabase();
    if (!sb) return out;
    const { data, error } = await sb.from("road_checks").select("road_id, kind").eq("status", "accepted");
    if (error) return out;
    for (const r of (data as { road_id: string; kind: CheckKind }[] | null) ?? []) {
      out.set(r.road_id, [...(out.get(r.road_id) ?? []), r.kind]);
    }
    return out;
  })().catch(() => new Map());
  return checksP;
}

/** A road with its accepted checks applied: gravel moves to Gravel; private, closed, or rough leave Driver's roads. */
export function withChecks<T extends Road>(r: T, kinds: CheckKind[] | undefined): T {
  if (!kinds?.length) return r;
  const excluded = [...r.excluded, ...kinds.map((k) => CHECK_REASON[k])];
  const blocked = kinds.includes("private") || kinds.includes("closed");
  const category = blocked ? "other" : kinds.includes("gravel") ? "gravel" : r.category === "drivers" ? "other" : r.category;
  return { ...r, category, excluded };
}

let indexP: Promise<DataIndex> | null = null;
export function loadIndex(): Promise<DataIndex> {
  indexP ??= json<DataIndex>(`${DATA_BASE}/index.json`).catch((e) => {
    indexP = null;
    throw e;
  });
  return indexP;
}

const cache = new Map<string, Promise<RoadOnMap[]>>();
function load(path: string): Promise<RoadOnMap[]> {
  let p = cache.get(path);
  if (!p) {
    p = Promise.all([json<{ roads: Road[] }>(`${path.startsWith("cells/") ? CELLS_BASE : DATA_BASE}/${path}`), loadRoadChecks()])
      .then(([d, checks]) => decode(d.roads.map((r) => withChecks(r, checks.get(r.id))))).catch((e) => {
      cache.delete(path);
      throw e;
    });
    cache.set(path, p);
  }
  return p;
}

export const loadTop = () => load("top.json");
export const loadBlock = (key: string) => load(`blocks/${key}.json`);
export const loadCell = (key: string) => load(`cells/${key}.json`);

export function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat)}_${Math.floor(lon)}`;
}

export function roadCell(r: Road): string {
  const [w, s, e, n] = r.bbox;
  return cellKey((s + n) / 2, (w + e) / 2);
}

/** Keys of the squares (size 1 or 5 degrees) that touch a view. */
export function keysIn(b: Bounds, size: 1 | 5): string[] {
  const out: string[] = [];
  const lat0 = Math.floor(b[1] / size) * size;
  const lon0 = Math.floor(b[0] / size) * size;
  for (let lat = lat0; lat <= b[3]; lat += size) {
    for (let lon = lon0; lon <= b[2]; lon += size) out.push(`${lat}_${lon}`);
  }
  return out;
}

/** Which level of detail a view needs. */
export function levelFor(b: Bounds): "cells" | "blocks" | "top" {
  const width = b[2] - b[0];
  if (width <= CELLS_BELOW) return "cells";
  if (width <= BLOCKS_BELOW) return "blocks";
  return "top";
}

let roadCellsP: Promise<Record<string, string>> | null = null;
/** Roads by id, found through road-cells.json (which square each road is in). Missing ids are left out. */
export async function roadsById(ids: string[]): Promise<Record<string, RoadOnMap>> {
  if (!ids.length) return {};
  roadCellsP ??= json<Record<string, string>>(`${DATA_BASE}/road-cells.json`).catch((e) => {
    roadCellsP = null;
    throw e;
  });
  const cells = await roadCellsP.catch(() => ({} as Record<string, string>));
  const want = new Set(ids);
  const found: Record<string, RoadOnMap> = {};
  for (const key of new Set(ids.map((id) => cells[id]).filter(Boolean))) {
    for (const r of await loadCell(key).catch(() => [] as RoadOnMap[])) if (want.has(r.id)) found[r.id] = r;
  }
  return found;
}
