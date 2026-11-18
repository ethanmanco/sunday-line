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
};

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

/** Our scored roads, drawn above the base map and below the place labels. */
export function roadLayers(): LayerSpecification[] {
  const width = (a: number, b: number, c: number): ExpressionSpecification =>
    ["interpolate", ["linear"], ["zoom"], 6, a, 10, b, 15, c];
  return [
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
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, ["interpolate", ["linear"], ["get", "score"], 40, 0.45, 70, 1], 11, 1],
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
