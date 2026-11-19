import { decodePolyline } from "./polyline";
import { keysIn, loadCell, loadIndex, type RoadOnMap } from "./roadData";
import type { Spot } from "./spots";

type LL = [number, number];

const M_PER_DEG = 111_320;
/** How close the drawn line has to run to a scored road, in meters. */
const NEAR_M = 45;
/** Share of the drawn line that has to follow the road. */
const MIN_SHARE = 0.6;

function distToSegment(p: LL, a: LL, b: LL, kx: number): number {
  const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * kx, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * M_PER_DEG;
}

function samples(line: LL[], n: number): LL[] {
  if (line.length <= n) return line;
  const step = (line.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => line[Math.round(i * step)]);
}

/**
 * The scored road a road-spot sits on: the one it was picked from, or for a
 * hand-drawn line, a scored road it follows most of the way. Null when there
 * isn't one (points, or roads not in the data).
 */
export async function findSpotRoad(spot: Spot): Promise<RoadOnMap | null> {
  if (spot.kind !== "road" || !spot.line) return null;
  const line = decodePolyline(spot.line) as LL[];
  if (line.length < 2) return null;
  const lons = line.map((p) => p[0]), lats = line.map((p) => p[1]);
  const bbox: [number, number, number, number] = [
    Math.min(...lons) - 0.02, Math.min(...lats) - 0.02, Math.max(...lons) + 0.02, Math.max(...lats) + 0.02,
  ];
  const index = await loadIndex().catch(() => null);
  if (!index) return null;
  const keys = keysIn(bbox, 1).filter((k) => index.cells[k]);
  const lists = await Promise.all(keys.map((k) => loadCell(k).then((rs) => rs.map((r) => ({ ...r, cell: k })) as RoadOnMap[]).catch(() => [])));
  const roads = lists.flat();
  if (spot.road_id) {
    const r = roads.find((x) => x.id === spot.road_id);
    if (r) return r;
  }
  const pts = samples(line, 40);
  const kx = Math.cos(((bbox[1] + bbox[3]) / 2) * (Math.PI / 180));
  let best: RoadOnMap | null = null;
  let bestShare = 0;
  for (const r of roads) {
    const [w, s, e, n] = r.bbox;
    if (w > bbox[2] || e < bbox[0] || s > bbox[3] || n < bbox[1]) continue;
    let near = 0;
    for (const p of pts) {
      for (let i = 1; i < r.coords.length; i++) {
        if (distToSegment(p, r.coords[i - 1] as LL, r.coords[i] as LL, kx) <= NEAR_M) {
          near++;
          break;
        }
      }
    }
    const share = near / pts.length;
    if (share > bestShare) {
      bestShare = share;
      best = r;
    }
  }
  return bestShare >= MIN_SHARE ? best : null;
}
