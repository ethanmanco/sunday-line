// Keep a road for when there's no signal (11.83). Saves, on this device only:
// the road's square (its full details), the street map, terrain and label
// tiles along it, and the app itself, into the cache the service worker
// (public/sw.js) answers from when the network doesn't.
//
// The list of kept roads lives in this browser's storage. Nothing about it is
// sent anywhere.

import { CELLS_BASE, roadCell, type RoadOnMap } from "./roadData";
import { streetsRequest } from "./mapStyle";

const CACHE = "sl-offline-v1";
const STATIC = "sl-static-v1";
const PAGES = "sl-pages-v1";
const DATA = "sl-data-v1";
const KEY = "sl-offline-roads";

export interface KeptRoad {
  id: string;
  name: string;
  near: string | null;
  state: string | null;
  cell: string;
  bytes: number;
  at: string;
  /** Everything saved for it, so removing it frees what no other kept road uses. */
  urls: string[];
}

export function offlineSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window && "serviceWorker" in navigator;
}

export function keptRoads(): KeptRoad[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as KeptRoad[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveList(list: KeptRoad[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the files are cached, the list just isn't kept.
  }
  window.dispatchEvent(new Event("sl-offline"));
}

export const isKept = (id: string) => keptRoads().some((k) => k.id === id);

// ---- Which tiles: the whole area zoomed out, a strip along the road zoomed in ----

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/**
 * Tiles z/x/y covering a road from minZ to maxZ: every tile it crosses, plus
 * one all around from `ringFrom` in. Zoomed-out tiles cover big areas and
 * weigh the most, so those are just the road's own.
 */
export function roadTiles(coords: [number, number][], minZ: number, maxZ: number, ringFrom = 9): string[] {
  const out = new Set<string>();
  for (let z = minZ; z <= maxZ; z++) {
    const pad = z >= ringFrom ? 1 : 0;
    // Points along the road, at least one per tile width, so no tile is skipped.
    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i];
      const [lng2, lat2] = coords[Math.min(i + 1, coords.length - 1)];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(tileX(lng2, z) - tileX(lng, z)), Math.abs(tileY(lat2, z) - tileY(lat, z)))));
      for (let k = 0; k <= steps; k++) {
        const x = tileX(lng + ((lng2 - lng) * k) / steps, z);
        const y = tileY(lat + ((lat2 - lat) * k) / steps, z);
        for (let dx = -pad; dx <= pad; dx++) for (let dy = -pad; dy <= pad; dy++) out.add(`${z}/${x + dx}/${y + dy}`);
      }
    }
  }
  return [...out];
}

/** The street map's tile address now (it changes weekly), from what the map loaded, or OpenFreeMap's list. */
async function streetTemplate(): Promise<string | null> {
  const seen = performance.getEntriesByType("resource").map((e) => e.name)
    .find((u) => /\/(planet|streets)\/[^/]+\/\d+\/\d+\/\d+\.pbf$/.test(u));
  if (seen) return seen.replace(/\d+\/\d+\/\d+\.pbf$/, "{z}/{x}/{y}.pbf");
  try {
    const tj = (await (await fetch(streetsRequest("https://tiles.openfreemap.org/planet").url)).json()) as { tiles: string[] };
    return streetsRequest(tj.tiles[0]).url;
  } catch {
    return null;
  }
}

const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

async function fetchAll(urls: string[], cacheName: string, onEach: (bytes: number) => void) {
  const cache = await caches.open(cacheName);
  let next = 0;
  const one = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const res = await fetch(url, { mode: "cors", credentials: "omit" });
        if (!res.ok) {
          onEach(0);
          continue;
        }
        const body = await res.blob();
        await cache.put(url, new Response(body, { headers: res.headers }));
        onEach(body.size);
      } catch {
        onEach(0);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, one));
}

/**
 * Save a road for offline use. Reports progress from 0 to 1; returns what was
 * kept. Fails only if the road's own square can't be saved.
 */
export async function keepOffline(road: RoadOnMap, progress: (done: number) => void): Promise<KeptRoad> {
  const cell = road.cell ?? roadCell(road);
  const cellUrl = `${CELLS_BASE.startsWith("/") ? location.origin + CELLS_BASE : CELLS_BASE}/cells/${cell}.json`;
  const coords = road.coords;
  const street = await streetTemplate();
  const tiles = street ? roadTiles(coords, 5, 14).map((t) => street.replace("{z}/{x}/{y}", t)) : [];
  const terrain = roadTiles(coords, 7, 13).map((t) => DEM.replace("{z}/{x}/{y}", t));
  // Label fonts the map used (street names, town names).
  const fonts = [...new Set(performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /\/fonts\/.+\.pbf$/.test(u)))];
  // The app's own files: those loaded so far, and every one the home page
  // (the app's offline start) names, so it opens with no signal.
  const home = await fetch("/", { cache: "no-store" }).then((r) => r.text()).catch(() => "");
  const named = [...home.matchAll(/["'(](\/_next\/static\/[^"'()\s\\]+)/g)].map((m) => location.origin + m[1]);
  const app = [...new Set([...performance.getEntriesByType("resource").map((e) => e.name), ...named]
    .filter((u) => u.startsWith(location.origin) && /\/(_next\/static|maplibre|icons)\//.test(u)))];

  // The street map's tile list, under both addresses the map may ask (11.80).
  const lists = [...new Set(["https://tiles.openfreemap.org/planet", streetsRequest("https://tiles.openfreemap.org/planet").url])];
  const road_urls = [cellUrl, ...lists, ...tiles, ...terrain, ...fonts];
  const total = road_urls.length + app.length + 3;
  let done = 0;
  let bytes = 0;
  const tick = (b: number) => {
    bytes += b;
    progress(++done / total);
  };

  // The square first: without it the road can't open offline.
  const cache = await caches.open(CACHE);
  const res = await fetch(cellUrl);
  if (!res.ok) throw new Error("Couldn't download this road. Check your connection.");
  const body = await res.blob();
  await cache.put(cellUrl, new Response(body, { headers: res.headers }));
  tick(body.size);

  await fetchAll(road_urls.slice(1), CACHE, tick);
  await fetchAll(app, STATIC, () => tick(0));
  // The app shell and the map's index files.
  await fetchAll([`${location.origin}/`], PAGES, () => tick(0));
  await fetchAll([`${location.origin}/data/us/index.json`, `${location.origin}/data/us/top.json`], DATA, () => tick(0));

  // Ask the browser not to clear these when space is short (where it supports that).
  navigator.storage?.persist?.().catch(() => {});

  const kept: KeptRoad = {
    id: road.id, name: road.name, near: road.near, state: road.state, cell, bytes,
    at: new Date().toISOString(), urls: road_urls,
  };
  saveList([...keptRoads().filter((k) => k.id !== road.id), kept]);
  return kept;
}

/** Remove a kept road, and the files no other kept road needs. */
export async function forgetOffline(id: string): Promise<void> {
  const list = keptRoads();
  const gone = list.find((k) => k.id === id);
  const rest = list.filter((k) => k.id !== id);
  saveList(rest);
  if (!gone) return;
  const still = new Set(rest.flatMap((k) => k.urls));
  const cache = await caches.open(CACHE);
  await Promise.all(gone.urls.filter((u) => !still.has(u)).map((u) => cache.delete(u)));
}

/**
 * Whether the site can be reached right now. Phones often say they're online
 * with no data getting through, so this asks the site itself (never a saved copy).
 */
export async function reachable(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch("/api/road-names?ids=", { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export function sizeText(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
