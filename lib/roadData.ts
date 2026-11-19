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
import type { Bounds } from "./roads";
import type { LoadedRoad, Road } from "./types";

export const DATA_BASE = "/data/us";

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
    p = json<{ roads: Road[] }>(`${DATA_BASE}/${path}`).then((d) => decode(d.roads)).catch((e) => {
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
