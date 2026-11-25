import { describe, expect, it } from "vitest";
import { bestOrder, entry, exit, googleParts, routeMiles, type RouteStop } from "../dayRoute";

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

  it("makes one Google Maps link for up to five roads, parts after that", () => {
    expect(googleParts([a, b, c])).toHaveLength(1);
    const link = new URL(googleParts([a, b, c])[0].href);
    expect(link.searchParams.get("destination")).toBe("32.50000,-93.60000");
    expect(link.searchParams.get("waypoints")?.split("|")).toHaveLength(5);
    const seven = Array.from({ length: 7 }, (_, i) => stop(`r${i}`, [-94 + i * 0.1, 33], [-93.95 + i * 0.1, 33]));
    const parts = googleParts(seven);
    expect(parts.map((p) => p.label)).toEqual(["Roads 1 to 5", "Roads 6 to 7"]);
  });
});
