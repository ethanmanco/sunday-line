import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { SITE_URL } from "./config";
import { CELLS_BASE, type DataIndex } from "./roadData";
import type { Road } from "./types";

// Small files are read from disk (bundled with the server code). The road
// squares are many and large, so they're fetched from where the app loads
// them (GitHub Pages, 11.31) instead of being bundled into every server function.
const DIR = path.join(process.cwd(), "public", "data", "us");
const read = async <T,>(rel: string): Promise<T> => JSON.parse(await readFile(path.join(DIR, rel), "utf8")) as T;

export const loadIndex = cache(() => read<DataIndex>("index.json"));
const loadRoadCells = cache(() => read<Record<string, string>>("road-cells.json"));

const loadCell = cache(async (key: string): Promise<{ roads: Road[] }> => {
  // Tagged with this deploy, so a new deploy (new road data) never serves a cached old square.
  const v = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
  const res = await fetch(`${CELLS_BASE.startsWith("/") ? SITE_URL + CELLS_BASE : CELLS_BASE}/cells/${key}.json?v=${encodeURIComponent(v)}`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`cell ${key}: ${res.status}`);
  return res.json() as Promise<{ roads: Road[] }>;
});

/** A road by ID, from its square's file. */
export async function findRoad(id: string): Promise<Road | null> {
  if (!/^[a-f0-9]{12}$/.test(id)) return null;
  const key = (await loadRoadCells())[id];
  if (!key || !/^-?\d+_-?\d+$/.test(key)) return null;
  try {
    const cell = await loadCell(key);
    return cell.roads.find((r) => r.id === id) ?? null;
  } catch {
    return null;
  }
}
