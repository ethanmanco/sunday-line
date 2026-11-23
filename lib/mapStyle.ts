import type { StyleSpecification, LayerSpecification, ExpressionSpecification } from "maplibre-gl";
import { RAMP } from "./roads";

// Sunday Line map theme: our own style over OpenFreeMap vector tiles
// (OpenStreetMap data in the OpenMapTiles schema). Every color, width, and
// label is ours to change.
export const THEME = {
  ground: "#14171c",
  wood: "#19251f",
  park: "#1b2922",
  wetland: "#17232a",
  water: "#0e2133",
  waterLine: "#1d4563",
  residential: "#1a1d23",
  roadMinor: "#2c3139",
  roadMid: "#434a55",
  roadMajor: "#5a6270",
  roadHighway: "#788090",
  label: "#c3c9d2",
  labelDim: "#868d98",
  halo: "#0c0e11",
  boundary: "#4a4f58",
  parkLine: "#3f6b4f",
  lmNational: "#8fdc9c",
  lmState: "#9fd3ae",
  lmForest: "#79ad88",
  lmWild: "#8aa99a",
  lmPeak: "#ddd6c8",
  lmVolcano: "#f2a468",
  lmPass: "#b9b2a6",
  lmView: "#e7d38b",
  lmWater: "#7fb2dc",
};

/** Our scored roads go just under this layer: above the base map, under every label. */
export const ROADS_BEFORE = "water-names";

/** Layers hidden while the satellite view is on. */
export const VECTOR_BASE_LAYERS = [
  "residential", "wood", "wetland", "park", "waterway", "water",
  "road-minor", "road-mid", "road-major", "road-highway",
];

export const scoreRamp: ExpressionSpecification = [
  "interpolate", ["linear"], ["get", "score"],
  ...RAMP.flatMap(([v, c]) => [v, c]),
] as unknown as ExpressionSpecification;

export function baseStyle(): StyleSpecification {
  const t = THEME;
  const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name"]];
  const road = (id: string, classes: string[], color: string, widths: [number, number, number], minzoom = 5): LayerSpecification => ({
    id, type: "line", source: "omt", "source-layer": "transportation", minzoom,
    filter: ["match", ["get", "class"], classes, true, false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 6, widths[0], 12, widths[1], 16, widths[2]],
    },
  });
  const layers: LayerSpecification[] = [
    { id: "ground", type: "background", paint: { "background-color": t.ground } },
    { id: "imagery", type: "raster", source: "usgs", layout: { visibility: "none" } },
    { id: "residential", type: "fill", source: "omt", "source-layer": "landuse", filter: ["==", ["get", "class"], "residential"], paint: { "fill-color": t.residential } },
    { id: "wood", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", ["get", "class"], "wood"], paint: { "fill-color": t.wood } },
    { id: "wetland", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", ["get", "class"], "wetland"], paint: { "fill-color": t.wetland } },
    { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": t.park, "fill-opacity": 0.8 } },
    {
      id: "park-outline", type: "line", source: "omt", "source-layer": "park", minzoom: 7,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": t.parkLine, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 13, 1.5], "line-opacity": 0.7 },
    },
    { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": t.waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2] } },
    { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": t.water } },
    { id: "boundary", type: "line", source: "omt", "source-layer": "boundary", filter: ["<=", ["coalesce", ["get", "admin_level"], 99], 4], paint: { "line-color": t.boundary, "line-dasharray": [3, 2], "line-width": 1 } },
    road("road-minor", ["minor", "service", "track"], t.roadMinor, [0.3, 1, 5], 11),
    road("road-mid", ["secondary", "tertiary"], t.roadMid, [0.5, 1.5, 7]),
    road("road-major", ["primary", "trunk"], t.roadMajor, [0.7, 2, 9]),
    road("road-highway", ["motorway"], t.roadHighway, [0.9, 2.5, 10]),
    {
      id: "road-names", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 12,
      layout: { "symbol-placement": "line", "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11 },
      paint: { "text-color": t.labelDim, "text-halo-color": t.halo, "text-halo-width": 1.5 },
    },
    ...landmarkLayers(name),
    {
      id: "places", type: "symbol", source: "omt", "source-layer": "place",
      filter: ["match", ["get", "class"], ["city", "town", "village", "hamlet"], true, false],
      layout: {
        "text-field": name, "text-font": ["Noto Sans Bold"],
        "text-size": ["match", ["get", "class"], "city", 15, "town", 13, 11],
      },
      paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 2 },
    },
  ];
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      omt: {
        type: "vector", url: "https://tiles.openfreemap.org/planet",
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>',
      },
      usgs: {
        type: "raster", tileSize: 256, maxzoom: 16,
        tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
        attribution: "Imagery: USGS The National Map",
      },
    },
    layers,
  };
}

// ---- Landmarks (11.34): parks, peaks, volcanoes, passes, viewpoints, lakes ----
// All from the same OpenFreeMap tiles (OpenStreetMap data); peaks are in the
// tiles from zoom 7, parks from zoom 4. Park types in the
// tiles are inconsistent (some state parks are tagged national_park), so parks
// are sorted by name.

const has = (word: string, n: ExpressionSpecification): ExpressionSpecification => ["in", word, n] as ExpressionSpecification;
const anyOf = (words: string[], n: ExpressionSpecification): ExpressionSpecification =>
  ["any", ...words.map((w) => has(w, n))] as ExpressionSpecification;

const STATE = ["State Park", "State Recreation Area", "State Natural Area", "State Scenic", "State Beach", "State Historic", "State Forest", "State Seashore"];
const NATIONAL = ["National Park", "National Monument", "National Seashore", "National Lakeshore", "National Recreation Area",
  "National Preserve", "National Scenic Area", "National Historical Park", "Parkway"];
const FOREST = ["National Forest", "National Grassland"];
const WILD = ["Wilderness", "Wildlife Refuge"];

/** state | forest | national | wild | "" (not labeled). State first: some state parks are tagged national_park. */
function parkKind(n: ExpressionSpecification): ExpressionSpecification {
  return ["case",
    anyOf(STATE, n), "state",
    anyOf(FOREST, n), "forest",
    anyOf(NATIONAL, n), "national",
    anyOf(WILD, n), "wild",
    "",
  ] as unknown as ExpressionSpecification;
}

/** Icon ids drawn by landmarkIcon(); MapView adds them when the map asks. */
export const LANDMARK_ICONS = ["lm-national", "lm-state", "lm-forest", "lm-wild", "lm-peak", "lm-volcano", "lm-pass", "lm-view"] as const;

function landmarkLayers(name: ExpressionSpecification): LayerSpecification[] {
  const t = THEME;
  const halo = { "text-halo-color": t.halo, "text-halo-width": 1.6 };
  const label = (size: number, font = "Noto Sans Regular") => ({
    "text-field": name, "text-font": [font], "text-size": size,
    "text-max-width": 8, "text-optional": true,
    // Labels may sit on any side of their icon, so a park name and the peak inside it both fit.
    "text-variable-anchor": ["top", "bottom", "right", "left"], "text-radial-offset": 0.9,
  });
  const park = (kind: string, minzoom: number, color: string, size: number): LayerSpecification => ({
    id: `park-${kind}`, type: "symbol", source: "omt", "source-layer": "park", minzoom,
    filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "name"], ["==", parkKind(name), kind]],
    // A lone tree icon says little: a park's name must show, its icon may drop out when crowded.
    layout: { ...label(size, kind === "national" ? "Noto Sans Bold" : "Noto Sans Regular"), "text-optional": false, "icon-optional": true, "icon-image": `lm-${kind}`, "symbol-sort-key": ["coalesce", ["get", "rank"], 9] },
    paint: { "text-color": color, ...halo },
  }) as unknown as LayerSpecification;
  const elevation = ["case", ["has", "ele_ft"], ["concat", ["number-format", ["get", "ele_ft"], { locale: "en-US" }], " ft"], ""];
  const withEle = ["format", name, {}, "\n", {}, elevation, { "font-scale": 0.85 }];
  const peak = (id: string, cls: string, icon: string, minzoom: number, color: string, extra: unknown[] = [], maxzoom = 24): LayerSpecification => ({
    id, type: "symbol", source: "omt", "source-layer": "mountain_peak", minzoom, maxzoom,
    filter: ["all", ["==", ["get", "class"], cls], ...extra],
    layout: { ...label(cls === "volcano" ? 12 : 11), "text-field": withEle, "icon-image": icon,
      "symbol-sort-key": ["-", 0, ["coalesce", ["get", "ele"], 0]] },
    paint: { "text-color": color, ...halo },
  }) as unknown as LayerSpecification;
  return [
    {
      id: "water-names", type: "symbol", source: "omt", "source-layer": "water_name", minzoom: 8,
      filter: ["match", ["get", "class"], ["lake", "reservoir", "bay"], true, false],
      layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 11, "text-max-width": 8 },
      paint: { "text-color": t.lmWater, ...halo },
    },
    park("wild", 11, t.lmWild, 11),
    park("forest", 10, t.lmForest, 11),
    park("state", 10, t.lmState, 11),
    {
      id: "viewpoints", type: "symbol", source: "omt", "source-layer": "poi", minzoom: 12,
      filter: ["==", ["get", "subclass"], "viewpoint"],
      layout: { ...label(11), "icon-image": "lm-view" },
      paint: { "text-color": t.lmView, ...halo },
    } as unknown as LayerSpecification,
    peak("passes", "saddle", "lm-pass", 11, t.lmPass),
    peak("peaks-all", "peak", "lm-peak", 11, t.lmPeak),
    peak("peaks-major", "peak", "lm-peak", 8, t.lmPeak, [["<=", ["coalesce", ["get", "rank"], 9], 1]], 11),
    // Last layers win when labels collide: national parks over ordinary peaks, volcanoes over all.
    park("national", 9, t.lmNational, 12),
    peak("volcanoes", "volcano", "lm-volcano", 7, t.lmVolcano),
  ];
}

/** Draws a landmark icon at 2x for sharp phones. Null for ids that aren't ours. */
export function landmarkIcon(id: string): ImageData | null {
  if (!(LANDMARK_ICONS as readonly string[]).includes(id) || typeof document === "undefined") return null;
  const S = 28;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  if (!g) return null;
  const t = THEME;
  const outline = () => { g.lineWidth = 2; g.strokeStyle = t.halo; g.stroke(); };
  const tri = (color: string, flat = false) => {
    g.beginPath();
    if (flat) { g.moveTo(3, 25); g.lineTo(11, 9); g.lineTo(17, 9); g.lineTo(25, 25); }
    else { g.moveTo(3, 25); g.lineTo(14, 4); g.lineTo(25, 25); }
    g.closePath();
    g.fillStyle = color; g.fill(); outline();
  };
  const tree = (bg: string) => {
    g.beginPath(); g.arc(14, 14, 12, 0, Math.PI * 2); g.fillStyle = bg; g.fill(); outline();
    g.beginPath(); g.moveTo(14, 5); g.lineTo(21, 18); g.lineTo(7, 18); g.closePath(); g.fillStyle = t.halo; g.fill();
    g.fillRect(12.5, 18, 3, 4);
  };
  switch (id) {
    case "lm-national": tree(t.lmNational); break;
    case "lm-state": tree(t.lmState); break;
    case "lm-forest": tree(t.lmForest); break;
    case "lm-wild": tree(t.lmWild); break;
    case "lm-peak": tri(t.lmPeak); break;
    case "lm-volcano":
      tri(t.lmVolcano, true);
      g.beginPath(); g.arc(12, 5, 2.5, 0, Math.PI * 2); g.arc(16.5, 3.5, 2.5, 0, Math.PI * 2); g.fillStyle = t.lmPeak; g.fill();
      break;
    case "lm-pass":
      g.beginPath(); g.moveTo(3, 23); g.lineTo(9, 8); g.lineTo(14, 16); g.lineTo(19, 8); g.lineTo(25, 23); g.closePath();
      g.fillStyle = t.lmPass; g.fill(); outline();
      break;
    case "lm-view":
      g.beginPath(); g.ellipse(14, 14, 12, 8, 0, 0, Math.PI * 2); g.fillStyle = t.lmView; g.fill(); outline();
      g.beginPath(); g.arc(14, 14, 4, 0, Math.PI * 2); g.fillStyle = t.halo; g.fill();
      break;
  }
  return g.getImageData(0, 0, S, S);
}

/** How strongly each scored road draws (better roads brighter when zoomed out). */
export const LINE_OPACITY: ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"], 6, ["interpolate", ["linear"], ["get", "score"], 40, 0.45, 70, 1], 11, 1,
] as unknown as ExpressionSpecification;

/** Our scored roads, drawn above the base map and below the place labels. */
export function roadLayers(): LayerSpecification[] {
  const width = (a: number, b: number, c: number): ExpressionSpecification =>
    ["interpolate", ["linear"], ["zoom"], 6, a, 10, b, 15, c];
  return [
    {
      // Phones (11.41): a soft glow under the road a card is showing, so it
      // stands out even when it runs behind the cards or the search box. The
      // road keeps its own color on top.
      id: "sl-hover-glow", type: "line", source: "roads", filter: ["==", ["get", "id"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff4d6", "line-width": width(18, 24, 32), "line-blur": width(9, 12, 16), "line-opacity": 0.8 },
    },
    {
      id: "sl-casing", type: "line", source: "roads",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#08090b",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          6, ["interpolate", ["linear"], ["get", "score"], 40, 2, 75, 5.5],
          10, ["interpolate", ["linear"], ["get", "score"], 40, 3.5, 75, 7],
          15, 10,
        ],
        "line-opacity": 0.85,
      },
    },
    {
      id: "sl-line", type: "line", source: "roads",
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "score"] },
      paint: {
        "line-color": scoreRamp,
        // Better roads draw wider and brighter when zoomed out, so they stand out.
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          6, ["interpolate", ["linear"], ["get", "score"], 40, 1, 75, 3.5],
          10, ["interpolate", ["linear"], ["get", "score"], 40, 2, 75, 4.5],
          15, 7,
        ],
        "line-opacity": LINE_OPACITY,
      },
    },
    {
      id: "sl-hover", type: "line", source: "roads", filter: ["==", ["get", "id"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": width(4, 6, 12), "line-opacity": 0.55 },
    },
    {
      id: "sl-selected-casing", type: "line", source: "roads", filter: ["==", ["get", "id"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": width(5, 8, 14) },
    },
    {
      id: "sl-selected", type: "line", source: "roads", filter: ["==", ["get", "id"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": scoreRamp, "line-width": width(2.5, 4.5, 9) },
    },
    {
      id: "sl-names", type: "symbol", source: "roads", minzoom: 10.5,
      layout: {
        "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"],
        "text-size": 12, "symbol-spacing": 400,
      },
      paint: { "text-color": "#f3f4f6", "text-halo-color": "#0c0e11", "text-halo-width": 2 },
    },
  ];
}
