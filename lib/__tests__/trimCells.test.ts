import { describe, expect, it } from "vitest";
import { trimCells, type RoadOnMap } from "../roadData";

const road = (id: string) => ({ id }) as unknown as RoadOnMap;
const away = (k: string) => Number(k.split("_")[1]);

describe("trimCells (11.82)", () => {
  it("keeps everything up to the limit", () => {
    const m = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`0_${i}`, [road(`r${i}`)]]));
    expect(trimCells(m, [], away, null)).toBe(m);
  });

  it("drops the farthest squares, never the wanted ones or the open road's", () => {
    const m = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`0_${i}`, [road(`r${i}`)]]));
    const out = trimCells(m, ["0_69"], away, "r68");
    expect(Object.keys(out)).toHaveLength(64);
    expect(out["0_69"]).toBeDefined();
    expect(out["0_68"]).toBeDefined();
    expect(out["0_67"]).toBeUndefined();
    expect(out["0_0"]).toBeDefined();
  });
});
