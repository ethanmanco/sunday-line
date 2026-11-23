import { describe, expect, it } from "vitest";
import { decodePolyline } from "../polyline";
import { applyFilters, DEFAULT_FILTERS, endNames, haversineMi, inView, scoreColor } from "../roads";
import type { Road } from "../types";

function road(over: Partial<Road>): Road {
  return {
    id: "x", name: "Test Road", ref: null, near: null, state: null, status: "candidate", category: "drivers",
    excluded: [], checked: null, length_m: 5000, home_mi: 10,
    scores: { overall: 60, twisty: 60, speed: 60, pavement: 60, flow: 60, elevation: 60, scenic: 60, surface: 100, quiet: 100 },
    speed: { min: 55, max: 55, units: "mph", source: "posted", text: "55 mph posted", note: null },
    surface: { text: "paved (tagged)", paved: true, gravel: false },
    pavement: { why: "state highway", maintained_by: "state", traffic_aadt: null, iri: null },
    elevation: { climb_ft: 100, descent_ft: 100, min_ft: 200, max_ft: 300, profile_ft: [] },
    scenery: { forest: 0, water: 0, wetland: 0, byway: null, tags: [] },
    stops: { junctions: 0, stops: 0, signals: 0 },
    start: [-93.8, 32.5], end: [-93.7, 32.5], bbox: [-93.8, 32.5, -93.7, 32.5], line: "", osm_way_ids: [],
    ...over,
  };
}

describe("polyline", () => {
  it("decodes Google's reference example", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  });
});

describe("filters", () => {
  const home: [number, number] = [-93.75, 32.51];
  const base = road({}).scores;
  const a = road({ id: "a", scores: { ...base, overall: 70, twisty: 50 } });
  const b = road({ id: "b", scores: { ...base, overall: 60, twisty: 80 } });
  const g = road({ id: "g", category: "gravel", surface: { text: "gravel", paved: false, gravel: true } });
  const hood = road({ id: "h", category: "other", excluded: ["runs through a neighborhood"] });
  const far = road({ id: "f", start: [-95.5, 33.9], end: [-95.4, 33.9], bbox: [-95.5, 33.9, -95.4, 33.9] });

  it("keeps gravel off the Driver's roads view", () => {
    const out = applyFilters([a, b, g], DEFAULT_FILTERS, home, null);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("sorts by the chosen score", () => {
    const out = applyFilters([a, b], { ...DEFAULT_FILTERS, sort: "twisty" }, home, null);
    expect(out[0].id).toBe("b");
  });

  it("leaves neighborhoods out of Scenic but keeps them in All", () => {
    expect(inView(hood, "scenic")).toBe(false);
    expect(inView(road({ id: "dull", category: "other", excluded: [], scores: { ...road({}).scores, scenic: 49 } }), "scenic")).toBe(false);
    expect(inView(road({ id: "pretty", category: "other", excluded: [], scores: { ...road({}).scores, scenic: 50 } }), "scenic")).toBe(true);
    expect(inView(hood, "all")).toBe(true);
  });

  it("filters by distance in miles", () => {
    const out = applyFilters([a, far], { ...DEFAULT_FILTERS, maxMiles: 50 }, home, null);
    expect(out.map((r) => r.id)).toEqual(["a"]);
    expect(haversineMi(home, far.start)).toBeGreaterThan(100);
  });

  it("keeps only roads in the map view when asked", () => {
    const out = applyFilters([a, far], DEFAULT_FILTERS, home, [-94, 32, -93, 33]);
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("labels", () => {
  it("names the ends of an east-west road", () => {
    expect(endNames(road({}))).toEqual(["west end", "east end"]);
  });
  it("colors low and high scores differently", () => {
    expect(scoreColor(30)).not.toEqual(scoreColor(85));
  });
});
