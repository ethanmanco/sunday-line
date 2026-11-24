import type { StyleSpecification, LayerSpecification, ExpressionSpecification, Map as MLMap, SourceSpecification } from "maplibre-gl";
import { baseStyle, roadLayers, scoreRamp, VECTOR_BASE_LAYERS } from "./mapStyle";

// Map styles (11.63). Each reshapes the normal style; "night" is the map as
// it was before styles, "relief" (the default) is night with the hills shaded.
// The choice is kept on the device only.
export type MapTheme = "relief" | "night" | "golden" | "evergreen" | "moonlight" | "neon" | "atlas" | "trail";

/** The styles in the picker, in order. */
export const MAP_STYLES: { id: MapTheme; label: string }[] = [
  { id: "relief", label: "Relief" },
  { id: "night", label: "Night" },
  { id: "golden", label: "Golden Hour" },
  { id: "evergreen", label: "Evergreen" },
  { id: "moonlight", label: "Moonlight" },
  { id: "neon", label: "Soft Neon" },
  { id: "atlas", label: "Road Atlas" },
  { id: "trail", label: "Trail Map" },
];
export const DEFAULT_MAP_STYLE: MapTheme = "relief";
const KEY = "sl-map-style";

export function savedMapStyle(): MapTheme {
  try {
    const kept = localStorage.getItem(KEY) as MapTheme | null;
    return kept && MAP_STYLES.some((m) => m.id === kept) ? kept : DEFAULT_MAP_STYLE;
  } catch {
    return DEFAULT_MAP_STYLE;
  }
}

export function saveMapStyle(t: MapTheme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Storage blocked: the style lasts until the page closes.
  }
}

/** Which base layers show with the satellite switch. Hill shading hides over the photos. */
export function baseVisibility(satellite: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = { imagery: satellite, hillshade: !satellite };
  for (const id of VECTOR_BASE_LAYERS) out[id] = !satellite;
  return out;
}

type Paint = Record<string, unknown>;
const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const roadW = (a: number, b: number, c: number) => ["interpolate", ["exponential", 1.5], ["zoom"], 6, a, 12, b, 16, c];

interface Spec {
  over: Record<string, Paint>;
  /** Paint for every label (place, road, landmark names). */
  text?: Paint;
  shade?: Paint;
}

const SPECS: Record<Exclude<MapTheme, "night">, Spec> = {
  // Today's night map with the hills shaded in, quietly.
  relief: {
    over: {},
    shade: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#4a5464", "hillshade-accent-color": "#07090c" },
  },
  // A paper road atlas: cream paper, blue water, red highways, dark type.
  atlas: {
    over: {
      ground: { "background-color": "#f2ead6" },
      residential: { "fill-color": "#ebdfc4" },
      wood: { "fill-color": "#dbe3c3" },
      wetland: { "fill-color": "#d5e2d4" },
      park: { "fill-color": "#c9dca9", "fill-opacity": 0.9 },
      "park-outline": { "line-color": "#6f9a4f", "line-opacity": 0.5 },
      water: { "fill-color": "#a8cce0" },
      waterway: { "line-color": "#7fb0cf" },
      boundary: { "line-color": "#8a6f8f" },
      "road-minor": { "line-color": "#cbbd9f" },
      "road-mid": { "line-color": "#8c7f6a" },
      "road-major": { "line-color": "#c9483b" },
      "road-highway": { "line-color": "#2f5fa8" },
    },
    text: { "text-color": "#2c2620", "text-halo-color": "#f6efdc" },
    shade: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#9b8a6a", "hillshade-highlight-color": "#fffaf0", "hillshade-accent-color": "#8a7a5c" },
  },
  // Soft neon: dusky violet, muted teal freeways, a gentle glow on scored roads.
  neon: {
    over: {
      ground: { "background-color": "#171226" },
      residential: { "fill-color": "#1c1630" },
      wood: { "fill-color": "#1a1530" },
      wetland: { "fill-color": "#1a1530" },
      park: { "fill-color": "#1d1733", "fill-opacity": 0.9 },
      "park-outline": { "line-color": "#c77dd6", "line-opacity": 0.5 },
      water: { "fill-color": "#121a33" },
      waterway: { "line-color": "#3a4f8f" },
      boundary: { "line-color": "#6b5a9a" },
      "road-minor": { "line-color": "#2a2340" },
      "road-mid": { "line-color": "#3b3158" },
      "road-major": { "line-color": "#544477" },
      "road-highway": { "line-color": "#6fb6c9", "line-opacity": 0.45 },
    },
    text: { "text-color": "#e6dcf2", "text-halo-color": "#171226" },
    shade: { "hillshade-exaggeration": 0.3, "hillshade-shadow-color": "#07040d", "hillshade-highlight-color": "#3a2f55", "hillshade-accent-color": "#0d0a16" },
  },
  // Golden hour: warm dark browns, amber type, hills lit from the low sun.
  golden: {
    over: {
      ground: { "background-color": "#1c1613" },
      residential: { "fill-color": "#231b16" },
      wood: { "fill-color": "#1f1d14" },
      wetland: { "fill-color": "#1b1d19" },
      park: { "fill-color": "#231f15", "fill-opacity": 0.9 },
      "park-outline": { "line-color": "#a08a4a", "line-opacity": 0.5 },
      water: { "fill-color": "#13202a" },
      waterway: { "line-color": "#2e4a5c" },
      boundary: { "line-color": "#6a5444" },
      "road-minor": { "line-color": "#33291f" },
      "road-mid": { "line-color": "#4d3e2f" },
      "road-major": { "line-color": "#6b5641" },
      "road-highway": { "line-color": "#8a7055" },
    },
    text: { "text-color": "#f0dcc0", "text-halo-color": "#140f0c" },
    shade: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#7a5230", "hillshade-accent-color": "#120c08" },
  },
  // Evergreen: deep forest greens with the hills shaded, like a park at night.
  evergreen: {
    over: {
      ground: { "background-color": "#101814" },
      residential: { "fill-color": "#161e1a" },
      wood: { "fill-color": "#132a1f" },
      wetland: { "fill-color": "#13241f" },
      park: { "fill-color": "#16301f", "fill-opacity": 0.9 },
      "park-outline": { "line-color": "#4f8a62", "line-opacity": 0.5 },
      water: { "fill-color": "#0c1c24" },
      waterway: { "line-color": "#24495a" },
      boundary: { "line-color": "#4a5a50" },
      "road-minor": { "line-color": "#26302b" },
      "road-mid": { "line-color": "#3a4640" },
      "road-major": { "line-color": "#505d56" },
      "road-highway": { "line-color": "#69776f" },
    },
    text: { "text-color": "#d7e6dc", "text-halo-color": "#0b120e" },
    shade: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#3f5a48", "hillshade-accent-color": "#07100b" },
  },
  // Moonlight: navy night with silver light on the ridges.
  moonlight: {
    over: {
      ground: { "background-color": "#111827" },
      residential: { "fill-color": "#151d2e" },
      wood: { "fill-color": "#121c2c" },
      wetland: { "fill-color": "#121c2c" },
      park: { "fill-color": "#141f31", "fill-opacity": 0.9 },
      "park-outline": { "line-color": "#6f86b8", "line-opacity": 0.5 },
      water: { "fill-color": "#0a1222" },
      waterway: { "line-color": "#2a4166" },
      boundary: { "line-color": "#4b5878" },
      "road-minor": { "line-color": "#263049" },
      "road-mid": { "line-color": "#36435f" },
      "road-major": { "line-color": "#4b5a7a" },
      "road-highway": { "line-color": "#64759a" },
    },
    text: { "text-color": "#dbe4f5", "text-halo-color": "#0b1120" },
    shade: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#03060d", "hillshade-highlight-color": "#8a9ab8", "hillshade-accent-color": "#0a1020" },
  },
  // Trail map: a national park brochure, green forests, brown roads, strong relief.
  trail: {
    over: {
      ground: { "background-color": "#f1ecdc" },
      residential: { "fill-color": "#e9e1cc" },
      wood: { "fill-color": "#cfdcb4" },
      wetland: { "fill-color": "#cfe0d0" },
      park: { "fill-color": "#c5d6a2", "fill-opacity": 0.9 },
      "park-outline": { "line-color": "#5f8a3f", "line-opacity": 0.5 },
      water: { "fill-color": "#9fc6dc" },
      waterway: { "line-color": "#6fa6c6" },
      boundary: { "line-color": "#8a7a6a" },
      "road-minor": { "line-color": "#c4b296" },
      "road-mid": { "line-color": "#9c7f5c" },
      "road-major": { "line-color": "#7a5634" },
      "road-highway": { "line-color": "#4d3520" },
    },
    text: { "text-color": "#2f2418", "text-halo-color": "#f1ecdc" },
    shade: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#7b6a4c", "hillshade-highlight-color": "#fffdf5", "hillshade-accent-color": "#6d5e44" },
  },
};

/** Light themes need dark road names. */
const LIGHT: MapTheme[] = ["atlas", "trail"];
const LIGHT_CASING: Partial<Record<MapTheme, string>> = { atlas: "#3b2f22", trail: "#3b2a18" };

/** The base map in a theme. */
export function themedStyle(style: StyleSpecification, t: MapTheme): StyleSpecification {
  if (t === "night") return style;
  const spec = SPECS[t];
  const sources: StyleSpecification["sources"] = { ...style.sources };
  if (spec.shade) sources.dem = { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 15, encoding: "terrarium", attribution: "Terrain: Mapzen, AWS Open Data" };
  const layers: LayerSpecification[] = [];
  for (const l of style.layers) {
    // Hills under the water and roads.
    if (l.id === "waterway" && spec.shade) layers.push({ id: "hillshade", type: "hillshade", source: "dem", paint: spec.shade } as LayerSpecification);
    const paint = { ...(l as { paint?: Paint }).paint, ...spec.over[l.id], ...(l.type === "symbol" && spec.text ? spec.text : {}) };
    layers.push({ ...l, paint } as LayerSpecification);
  }
  return { ...style, sources, layers };
}

/** The scored roads in a theme. */
export function themedRoadLayers(base: LayerSpecification[], t: MapTheme): LayerSpecification[] {
  if (t === "night") return base;
  const width = (a: number, b: number, c: number): ExpressionSpecification =>
    ["interpolate", ["linear"], ["zoom"], 6, a, 10, b, 15, c] as ExpressionSpecification;
  const recolor = (l: LayerSpecification, p: Paint) => ({ ...l, paint: { ...(l as { paint?: Paint }).paint, ...p } }) as LayerSpecification;
  const out: LayerSpecification[] = [];
  for (const l of base) {
    let layer = l;
    if (t === "neon" && l.id === "sl-casing") {
      // A gentle glow in the road's own color.
      out.push({
        id: "sl-glow", type: "line", source: "roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": scoreRamp, "line-width": width(7, 10, 16), "line-blur": width(5, 7, 10), "line-opacity": 0.35 },
      } as LayerSpecification);
      layer = recolor(l, { "line-color": "#0d0a16" });
    }
    if (LIGHT.includes(t) && l.id === "sl-casing") layer = recolor(l, { "line-color": LIGHT_CASING[t], "line-opacity": 0.9 });
    if (LIGHT.includes(t) && l.id === "sl-names") layer = recolor(l, { "text-color": "#1d232b", "text-halo-color": "#f6f4ee" });
    out.push(layer);
    if (t === "atlas" && l.id === "sl-line") {
      // The old atlas mark for a scenic route: green dots beside the road.
      out.push({
        id: "sl-scenic", type: "line", source: "roads", minzoom: 7,
        filter: [">=", ["get", "score"], 70],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2f8f3a", "line-width": width(2, 3, 4), "line-dasharray": [0, 2], "line-offset": width(4, 6, 10) },
      } as LayerSpecification);
    }
  }
  return out;
}

type AnyLayer = LayerSpecification & { paint?: Paint };

/**
 * Switch a live map from one style to another without rebuilding it: adds or
 * removes the style's extra layers and repaints the rest. Spots, heads-ups and
 * picks keep their own layers untouched.
 */
export function applyTheme(map: MLMap, from: MapTheme, to: MapTheme) {
  if (from === to) return;
  const base = baseStyle();
  const roads = roadLayers();
  const a = [...themedStyle(base, from).layers, ...themedRoadLayers(roads, from)] as AnyLayer[];
  const bStyle = themedStyle(base, to);
  const b = [...bStyle.layers, ...themedRoadLayers(roads, to)] as AnyLayer[];
  for (const [id, src] of Object.entries(bStyle.sources)) if (!map.getSource(id)) map.addSource(id, src as SourceSpecification);
  const inB = new Set(b.map((l) => l.id));
  for (const l of a) if (!inB.has(l.id) && map.getLayer(l.id)) map.removeLayer(l.id);
  const before = new Map(a.map((l) => [l.id, l]));
  b.forEach((l, i) => {
    if (!map.getLayer(l.id)) {
      // Put a new layer just under the next one in the style that's already there.
      const next = b.slice(i + 1).find((n) => map.getLayer(n.id));
      map.addLayer(l, next?.id);
      return;
    }
    const old = before.get(l.id)?.paint ?? {};
    const now = l.paint ?? {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
      if (JSON.stringify(old[key]) !== JSON.stringify(now[key])) map.setPaintProperty(l.id, key as Parameters<MLMap["setPaintProperty"]>[1], now[key] as Parameters<MLMap["setPaintProperty"]>[2]);
    }
  });
}
