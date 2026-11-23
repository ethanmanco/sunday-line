import { describe, expect, it } from "vitest";
import { bestSide, chain } from "../traceRoad";
import raw from "./fixtures/divided-parkways.json";

type LL = [number, number];
const fixture = raw as unknown as Record<string, LL[][]>;

function meters(a: LL, b: LL): number {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  return Math.hypot(x, (b[1] - a[1]) * k) * 6371000;
}

function lengthM(line: LL[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += meters(line[i - 1], line[i]);
  return s;
}

/**
 * Closest the line comes back to itself: the smallest gap between two points
 * that are more than `apart` meters apart along the line. A traced divided
 * road that turned around onto its other side comes back within a few dozen
 * meters of itself.
 */
function closestReturn(line: LL[], apart = 1500): number {
  const along = [0];
  for (let i = 1; i < line.length; i++) along.push(along[i - 1] + meters(line[i - 1], line[i]));
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    for (let j = i + 1; j < line.length; j++) {
      if (along[j] - along[i] > apart) best = Math.min(best, meters(line[i], line[j]));
    }
  }
  return best;
}

// Real base map pieces (OpenFreeMap tiles, zoom 12 and 14) for two divided
// parkways in Shreveport and Bossier City: each side of the road is its own line.
const cases = Object.entries(fixture);

describe("tracing a divided road follows one side", () => {
  for (const [key, pieces] of cases) {
    it(`${key}: never turns back onto the other side`, () => {
      for (let first = 0; first < pieces.length; first++) {
        const line = chain(pieces, first);
        expect(closestReturn(line), `starting from piece ${first}`).toBeGreaterThan(150);
      }
    });

    it(`${key}: traces about one side's length, not both`, () => {
      const total = pieces.reduce((s, p) => s + lengthM(p), 0);
      for (let first = 0; first < pieces.length; first++) {
        expect(lengthM(chain(pieces, first)), `starting from piece ${first}`).toBeLessThan(0.75 * total);
      }
    });
  }

  it("uses the other side when the tapped side's map data stops short", () => {
    // Clyde Fant at zoom 14: piece 0 is the southbound side's last 0.7 mi, then
    // the map data has a gap; piece 1 is the northbound side, which runs the
    // whole parkway.
    const pieces = fixture["Clyde Fant Memorial Parkway|z14"];
    expect(lengthM(chain(pieces, 0))).toBeLessThan(1500);
    const line = bestSide(pieces, [0, 1]);
    expect(lengthM(line)).toBeGreaterThan(9000);
    expect(closestReturn(line)).toBeGreaterThan(150);
    // A tapped side that isn't cut short stays the tapped side.
    expect(bestSide(pieces, [1, 0])).toEqual(chain(pieces, 1));
  });
});
