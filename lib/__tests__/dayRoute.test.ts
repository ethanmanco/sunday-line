import { describe, expect, it } from "vitest";
import { bestOrder, entry, exit, googleParts, middle, routeMiles, type RouteStop } from "../dayRoute";

const stop = (id: string, start: [number, number], end: [number, number]): RouteStop =>
  ({ id, name: id, near: null, state: null, cell: null, start, end, line: "", miles: 5 });

describe("day route (11.85)", () => {
  // Three roads in a row going east; b is mapped west to east, c east to west.
  const a = stop("a", [-94.0, 32.5], [-93.9, 32.5]);
  const b = stop("b", [-93.8, 32.5], [-93.7, 32.5]);
  const c = stop("c", [-93.5, 32.5], [-93.6, 32.5]);

  it("orders roads by the nearest next end, and drives each from the near end", () => {
    const out = bestOrder([c, a, b], [-94.1, 32.5]);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(out[2].reversed).toBe(true);
    expect(entry(out[2])).toEqual([-93.6, 32.5]);
    expect(exit(out[2])).toEqual([-93.5, 32.5]);
  });

  it("adds up road miles and the straight-line gaps", () => {
    const m = routeMiles(bestOrder([a, b, c], [-94.1, 32.5]));
    expect(m.roads).toBe(15);
    expect(m.between).toBeGreaterThan(10);
    expect(m.between).toBeLessThan(13);
  });

  it("with both ends: one Google Maps link for up to five roads, parts after that", () => {
    expect(googleParts([a, b, c], null, "ends")).toHaveLength(1);
    const link = new URL(googleParts([a, b, c], null, "ends")[0].href);
    expect(link.searchParams.get("destination")).toBe("32.50000,-93.60000");
    expect(link.searchParams.get("waypoints")?.split("|")).toHaveLength(5);
    const seven = Array.from({ length: 7 }, (_, i) => stop(`r${i}`, [-94 + i * 0.1, 33], [-93.95 + i * 0.1, 33]));
    expect(googleParts(seven, null, "ends").map((p) => p.label)).toEqual(["Roads 1 to 5", "Roads 6 to 7"]);
  });

  it("by default: one stop halfway along each road, ending at the last road's far end (11.98)", () => {
    const link = new URL(googleParts([a, b, c])[0].href);
    expect(link.searchParams.get("waypoints")?.split("|")).toEqual(["32.50000,-93.95000", "32.50000,-93.75000", "32.50000,-93.55000"]);
    expect(link.searchParams.get("destination")).toBe("32.50000,-93.60000");
    // Nine roads fit one link; twenty come in parts with no part left holding only the last end.
    const roads = (n: number) => Array.from({ length: n }, (_, i) => stop(`r${i}`, [-94 + i * 0.1, 33], [-93.95 + i * 0.1, 33]));
    expect(googleParts(roads(9)).map((p) => p.label)).toEqual(["Whole route"]);
    expect(googleParts(roads(10)).map((p) => p.label)).toEqual(["Roads 1 to 9", "Road 10"]);
    expect(googleParts(roads(20)).map((p) => p.label)).toEqual(["Roads 1 to 10", "Roads 11 to 19", "Road 20"]);
    for (const p of googleParts(roads(20))) expect((new URL(p.href).searchParams.get("waypoints") ?? "").split("|").length).toBeLessThanOrEqual(9);
  });

  it("finds the middle by distance along the road's line", () => {
    // An L: a short leg east, then a leg three times as long north, so halfway is a third of the way up.
    const l = { ...a, line: encode([[0, 0], [0.001, 0], [0.001, 0.003]]) };
    const m = middle(l);
    expect(m[0]).toBeCloseTo(0.001, 5);
    expect(m[1]).toBeGreaterThan(0.0009);
    expect(m[1]).toBeLessThan(0.0011);
  });
});

/** Encode [lon, lat] pairs as a Google polyline (precision 5), for the tests. */
function encode(pts: [number, number][]): string {
  let out = "";
  let plat = 0;
  let plon = 0;
  const one = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) { out += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; }
    out += String.fromCharCode(x + 63);
  };
  for (const [lon, lat] of pts) {
    const la = Math.round(lat * 1e5);
    const lo = Math.round(lon * 1e5);
    one(la - plat); one(lo - plon);
    plat = la; plon = lo;
  }
  return out;
}
