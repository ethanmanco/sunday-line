// Road search for the "Find a place" box (11.79). Each state's road names are
// a static file next to the road squares (pipeline/tiles.py, names-XX.json);
// the app loads only the states it needs and searches on the device, like the
// town search, so nothing anyone types leaves it.

import { CELLS_BASE } from "./roadData";
import { haversineMi, type Bounds } from "./roads";
import { norm } from "./places";

type LL = [number, number];

/** [id, name, near, lng, lat, overall, square]. */
type NameRow = [string, string, string, number, number, number, string];

interface StateNames {
  rows: NameRow[];
  tokens: string[][];
}

export interface RoadHit {
  key: string;
  id: string;
  name: string;
  near: string;
  state: string;
  point: LL;
  cell: string;
  overall: number;
}

// Street words people write both ways: "Rd" and "Road" match each other.
const SHORT: Record<string, string> = {
  road: "rd", street: "st", highway: "hwy", avenue: "ave", lane: "ln", drive: "dr", boulevard: "blvd",
  parkway: "pkwy", court: "ct", circle: "cir", place: "pl", trail: "trl", terrace: "ter",
  north: "n", south: "s", east: "e", west: "w", route: "rte", mountain: "mtn", mount: "mt", saint: "st",
  expressway: "expy", freeway: "fwy", turnpike: "tpke", crossing: "xing", point: "pt", junction: "jct",
};

export function tokens(s: string): string[] {
  const words = norm(s).replace(/\bcounty road\b/g, "cr").replace(/\bfarm to market\b/g, "fm").split(" ").filter(Boolean);
  return words.map((w) => SHORT[w] ?? w);
}

const loaded = new Map<string, Promise<StateNames | null>>();
function loadState(st: string): Promise<StateNames | null> {
  let p = loaded.get(st);
  if (!p) {
    p = fetch(`${CELLS_BASE}/cells/names-${st}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ roads: NameRow[] }>) : null))
      .then((d) => (d ? { rows: d.roads, tokens: d.roads.map((r) => tokens(r[1])) } : null))
      .catch(() => {
        loaded.delete(st);
        return null;
      });
    loaded.set(st, p);
  }
  return p;
}

/**
 * Roads whose name has every typed word (each a word start, any order), in the
 * given states, best match first: the name starting with what was typed, then
 * nearest to `near`, then the higher score. Roads with the same name near the
 * same town show once.
 */
export async function searchRoads(typed: string, states: string[], near: LL, limit = 5): Promise<RoadHit[]> {
  const want = tokens(typed);
  if (!want.length || want.join("").length < 3) return [];
  const all = await Promise.all(states.map((s) => loadState(s).then((d) => [s, d] as const)));
  const found: { hit: RoadHit; starts: boolean; dist: number }[] = [];
  for (const [st, d] of all) {
    if (!d) continue;
    for (let i = 0; i < d.rows.length; i++) {
      const have = d.tokens[i];
      if (!want.every((w) => have.some((h) => h.startsWith(w)))) continue;
      const [id, name, nearTown, lng, lat, overall, cell] = d.rows[i];
      found.push({
        hit: { key: `rd:${id}`, id, name, near: nearTown, state: st, point: [lng, lat], cell, overall },
        starts: want.every((w, k) => have[k]?.startsWith(w)),
        dist: haversineMi(near, [lng, lat]),
      });
    }
  }
  found.sort((a, b) => Number(b.starts) - Number(a.starts) || a.dist - b.dist || b.hit.overall - a.hit.overall);
  const seen = new Set<string>();
  const out: RoadHit[] = [];
  for (const f of found) {
    const k = `${f.hit.name}|${f.hit.near}|${f.hit.state}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f.hit);
    if (out.length >= limit) break;
  }
  return out;
}

/** "1234 Moon Lake Rd, Bossier City, LA": the street, and what follows it. Null if it doesn't start with a house number. */
export function parseAddress(typed: string): { street: string; rest: string } | null {
  const m = /^\s*\d+[a-z]?\s+([^,]+?)\s*(?:,\s*(.*))?$/i.exec(typed);
  if (!m || tokens(m[1]).join("").length < 3) return null;
  return { street: m[1], rest: (m[2] ?? "").trim() };
}

type StateRow = [string, string, number, number, number, number];

/** States whose box overlaps the view; when the view covers many, the ones at its center. */
export function statesForView(states: StateRow[], view: Bounds | null, center: LL): string[] {
  const hit = (b: StateRow, w: number, s: number, e: number, n: number) => b[2] <= e && b[4] >= w && b[3] <= n && b[5] >= s;
  if (view) {
    const inView = states.filter((st) => hit(st, view[0], view[1], view[2], view[3])).map((st) => st[1]);
    if (inView.length && inView.length <= 4) return inView;
  }
  return states.filter((st) => hit(st, center[0], center[1], center[0], center[1])).map((st) => st[1]).slice(0, 3);
}

const ABBR = /^[a-z]{2}$/;

/** A state at the end of what was typed ("Moon Lake Rd, LA", "moon lake la", "... Louisiana"), and the rest. */
export function splitState(typed: string, states: StateRow[]): { st: string | null; rest: string } {
  const comma = typed.lastIndexOf(",");
  if (comma > 0) {
    const tail = norm(typed.slice(comma + 1));
    const named = states.find((s) => s[1].toLowerCase() === tail || norm(s[0]) === tail);
    if (named) return { st: named[1], rest: typed.slice(0, comma) };
  }
  const words = norm(typed).split(" ");
  const last = words[words.length - 1];
  if (words.length > 1 && ABBR.test(last)) {
    const named = states.find((s) => s[1].toLowerCase() === last);
    if (named) return { st: named[1], rest: words.slice(0, -1).join(" ") };
  }
  const q = norm(typed);
  for (const s of states) {
    const sn = norm(s[0]);
    if (words.length > sn.split(" ").length && q.endsWith(" " + sn)) return { st: s[1], rest: q.slice(0, -sn.length - 1) };
  }
  return { st: null, rest: typed };
}
