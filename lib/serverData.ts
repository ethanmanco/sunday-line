import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { REGION_SLUG } from "./config";
import type { Road, RoadData } from "./types";

export const loadRoadData = cache(async (): Promise<RoadData> => {
  const file = path.join(process.cwd(), "public", "data", REGION_SLUG, "roads.json");
  return JSON.parse(await readFile(file, "utf8")) as RoadData;
});

export async function findRoad(id: string): Promise<Road | null> {
  if (!/^[a-f0-9]{12}$/.test(id)) return null;
  const data = await loadRoadData();
  return data.roads.find((r) => r.id === id) ?? null;
}
