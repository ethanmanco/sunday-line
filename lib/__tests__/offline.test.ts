import { describe, expect, it } from "vitest";
import { roadTiles } from "../offline";

describe("roadTiles (11.83)", () => {
  // About 10 km of road east of Shreveport.
  const road: [number, number][] = [[-93.6, 32.5], [-93.55, 32.52], [-93.5, 32.51]];

  it("covers the road at every zoom; zoomed out, only the road's own tiles", () => {
    const t = roadTiles(road, 5, 14);
    for (let z = 5; z <= 14; z++) expect(t.some((k) => k.startsWith(`${z}/`))).toBe(true);
    expect(t.filter((k) => k.startsWith("5/"))).toHaveLength(1);
    expect(t.filter((k) => k.startsWith("9/")).length).toBeGreaterThanOrEqual(9);
  });

  it("stays a strip along the road, not the whole box, zoomed in", () => {
    const z14 = roadTiles(road, 14, 14);
    expect(z14.length).toBeGreaterThan(10);
    expect(z14.length).toBeLessThan(40);
  });
});
