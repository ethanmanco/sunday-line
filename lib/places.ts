// Place search: every US city, town and CDP, searched in the browser (11.32).
// The list is a static file (public/data/places.json, built by
// scripts/build_places.py from Census data), so nothing anyone types leaves
// their device.

import type { Bounds } from "./roads";

type LL = [number, number];

/** [name, state abbr, lng, lat, population], biggest first. */
type PlaceRow = [string, string, number, number, number];
/** [name, abbr, west, south, east, north]. */
export type StateRow = [string, string, number, number, number, number];

export interface PlaceHit {
  key: string;
  label: string;
  detail: string;
  /** Where distances are measured from; null for a whole state. */
  point: LL | null;
  bbox: Bounds;
}

export interface Places {
  places: PlaceRow[];
  norm: string[];
  states: StateRow[];
}

let loading: Promise<Places> | null = null;
export function loadPlaces(): Promise<Places> {
  loading ??= fetch("/data/places.json")
    .then((r) => {
      if (!r.ok) throw new Error(`places: ${r.status}`);
      return r.json() as Promise<{ places: PlaceRow[]; states: StateRow[] }>;
    })
    .then((d) => ({ places: d.places, states: d.states, norm: d.places.map((p) => norm(p[0])) }))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

/** Lowercase, no accents, punctuation as spaces: "Coeur d'Alene" -> "coeur d alene". */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const ABBRS = new Set([
  "al", "ar", "az", "ca", "co", "ct", "dc", "de", "fl", "ga", "hi", "ia", "id", "il", "in", "ks", "ky", "la", "ma", "md",
  "me", "mi", "mn", "mo", "ms", "mt", "nc", "nd", "ne", "nh", "nj", "nm", "nv", "ny", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "va", "vt", "wa", "wi", "wv", "wy",
]);

/** About 40 by 35 miles around a town: close enough to see its roads. */
function around([lng, lat]: LL): Bounds {
  return [lng - 0.35, lat - 0.25, lng + 0.35, lat + 0.25];
}

/** Up to `limit` places matching what was typed, states first, then towns by size. */
export function searchPlaces(data: Places, typed: string, limit = 6): PlaceHit[] {
  let q = norm(typed);
  if (q.length < 2) return [];
  // "Jena, LA", "jena la", "Jena Louisiana": a trailing state narrows the towns.
  let st: string | null = null;
  const comma = typed.lastIndexOf(",");
  const words = q.split(" ");
  if (comma > 0) {
    const tail = norm(typed.slice(comma + 1));
    const named = data.states.find((s) => s[1].toLowerCase() === tail || norm(s[0]) === tail);
    if (named) {
      st = named[1];
      q = norm(typed.slice(0, comma));
    }
  } else if (words.length > 1 && ABBRS.has(words[words.length - 1])) {
    st = words[words.length - 1].toUpperCase();
    q = words.slice(0, -1).join(" ");
  } else {
    for (const s of data.states) {
      const sn = norm(s[0]);
      if (words.length > sn.split(" ").length && q.endsWith(" " + sn)) {
        st = s[1];
        q = q.slice(0, -sn.length - 1);
        break;
      }
    }
  }

  const hits: PlaceHit[] = [];
  if (!st) {
    for (const s of data.states) {
      if (norm(s[0]).startsWith(q) || (q.length === 2 && s[1].toLowerCase() === q)) {
        hits.push({ key: `st:${s[1]}`, label: s[0], detail: "State", point: null, bbox: [s[2], s[3], s[4], s[5]] });
      }
    }
  }
  // Whole name starts with it first ("Jena"), then any word in it ("Honolulu" in "Urban Honolulu").
  const starts: number[] = [];
  const inside: number[] = [];
  for (let i = 0; i < data.places.length && starts.length < limit; i++) {
    if (st && data.places[i][1] !== st) continue;
    const n = data.norm[i];
    if (n.startsWith(q)) starts.push(i);
    else if (inside.length < limit && n.includes(" " + q)) inside.push(i);
  }
  for (const i of [...starts, ...inside]) {
    const [name, abbr, lng, lat] = data.places[i];
    hits.push({ key: `pl:${i}`, label: `${name}, ${abbr}`, detail: "", point: [lng, lat], bbox: around([lng, lat]) });
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}
