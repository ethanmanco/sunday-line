"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { spotFeatures, spotPinIcon, spotsBbox, type Spot } from "@/lib/spots";
import { headsUpIcon, headsUpIconId, type HeadsUp } from "@/lib/headsUps";
import type { PickState } from "@/lib/mapShell";
import { extendOnMap, traceRoadAt, type RoadExtender, type TracedRoad } from "@/lib/traceRoad";
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, LayerSpecification, Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import { baseStyle, landmarkIcon, roadLayers, ROADS_BEFORE, scoreRamp } from "@/lib/mapStyle";
import { applyTheme, baseVisibility, themedRoadLayers, themedStyle, type MapTheme } from "@/lib/mapThemes";
import type { Bounds } from "@/lib/roads";
import type { LoadedRoad } from "@/lib/types";

export interface FocusRequest {
  bbox: [number, number, number, number];
  key: number;
  exact?: boolean; // restore a saved view instead of framing a road
  fly?: boolean; // a long move: fly there, keeping the area clear of the floating controls
}

/** How far down the map the floating search and chips reach (0 when nothing floats there). */
function topOverlay(container: HTMLElement): number {
  const box = container.getBoundingClientRect();
  let bottom = 0;
  for (const el of document.querySelectorAll<HTMLElement>(".app-bar, .map-top-left")) {
    const r = el.getBoundingClientRect();
    if (!r.height || r.bottom <= box.top || r.top > box.top + box.height / 2) continue;
    // The app bar spans the screen but only its rows are solid: measure those.
    const parts = el.classList.contains("app-bar") ? [...el.children].filter((c) => !c.classList.contains("you-menu")) : [el];
    for (const p of parts) {
      const pr = p.getBoundingClientRect();
      if (pr.height && pr.right > box.left && pr.left < box.right) bottom = Math.max(bottom, pr.bottom - box.top);
    }
  }
  return Math.max(0, Math.min(bottom, box.height / 3));
}

interface Props {
  roads: LoadedRoad[];
  scoreKey: "overall" | "scenic" | "twisty";
  regionBbox: [number, number, number, number];
  selectedId: string | null;
  hoverId: string | null;
  satellite: boolean;
  theme: MapTheme;
  focus: FocusRequest | null;
  myLocation: [number, number] | null;
  /** Changes when the space around the map changes (phone full-map button). */
  layoutKey?: string;
  /** Phones in portrait: cards and the search sit over the map, so the card's road glows and the rest dim. */
  phone?: boolean;
  /** Spots approved for the public map. */
  spots?: Spot[];
  /** Fly to and highlight one spot (change key to repeat). */
  focusSpot?: { id: string; key: number } | null;
  /** Adding a spot on this map: what to draw, and taps go to the handlers. */
  pick?: PickState | null;
  onPickPoint?: (ll: [number, number]) => void;
  onPickRoad?: (id: string) => void;
  onTraceRoad?: (t: TracedRoad) => void;
  /** Filled with a way to make a picked road longer on this map. */
  extendRef?: { current: RoadExtender | null };
  /** Pixels hidden at the bottom (the phone sheet), kept clear when fitting views. */
  bottomInset?: number;
  onSelect: (id: string) => void;
  /** The selected spot, drawn like a selected road. */
  selectedSpotId?: string | null;
  onSelectSpot?: (id: string) => void;
  /** Who's looking (their spots are teal) and a spot road's score, if any (11.48). */
  meId?: string | null;
  spotScore?: (s: Spot) => number | null;
  /** Live heads-ups (11.39) and what happens when one is tapped. */
  headsUps?: HeadsUp[];
  onSelectHeadsUp?: (id: string) => void;
  onHover: (id: string | null) => void;
  onBounds: (b: Bounds) => void;
}

const idFilter = (id: string | null) => ["==", ["get", "id"], id ?? ""] as ["==", ["get", string], string];

export default function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<MLMarker | null>(null);
  const pinRef = useRef<MLMarker | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef(props);
  // The map style the map is drawn in now (11.63); changes repaint it in place.
  const theme = useRef<MapTheme>(props.theme);
  cb.current = props;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      mlRef.current = ml;
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const map = new ml.Map({
        container: el.current,
        style: themedStyle(baseStyle(), theme.current),
        bounds: cb.current.regionBbox,
        fitBoundsOptions: { padding: 16 },
        // Phones: the credit folds into a small (i) after the first move; OSM's
        // license needs it on the map itself (full credits are on About too).
        attributionControl: { compact: window.matchMedia("(max-width: 899px)").matches },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxZoom: 17,
      });
      // Landmark icons (parks, peaks, volcanoes) are drawn here when the map first needs them.
      map.setMissingStyleImageResolver((id) => {
        const img = landmarkIcon(id) ?? headsUpIcon(id) ?? spotPinIcon(id);
        if (img && !map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        map.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const layer of themedRoadLayers(roadLayers(), theme.current)) map.addLayer(layer, ROADS_BEFORE);
        // lineMetrics: road spots are drawn with a gradient along their length.
        // Spots (11.48, 11.52): whose a spot is shows as color. A road spot is
        // wrapped in one ring per owner color (yours innermost), drawn as wider
        // lines under it so loops and ends close cleanly. The center is the
        // road's score color when it's rated; unrated spots are hollow (dark
        // center). Places are pins split into their owners' colors.
        map.addSource("public-spots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("pick-segment", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("pick-vertices", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const spotWidth = (a: number, b: number): ExpressionSpecification =>
          ["interpolate", ["linear"], ["zoom"], 8, a, 14, b] as unknown as ExpressionSpecification;
        const spotLineColor = ["case", ["has", "score"], scoreRamp, "#14181f"] as unknown as ExpressionSpecification;
        map.addLayer({
          id: "ps-band", type: "line", source: "public-spots", filter: ["has", "band"],
          // Outer rings first, so each inner ring sits on top of the one around it.
          layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["-", 0, ["get", "r"]] },
          paint: {
            "line-color": ["get", "color"],
            // Center width plus a ring of 1.5px (zoomed out) to 2.5px (zoomed in) per side, per color.
            "line-width": ["interpolate", ["linear"], ["zoom"],
              8, ["+", 2, ["*", ["+", ["get", "r"], 1], 3]],
              14, ["+", 4, ["*", ["+", ["get", "r"], 1], 5]]],
          },
        } as LayerSpecification);
        map.addLayer({
          id: "ps-line", type: "line", source: "public-spots",
          filter: ["all", ["==", ["geometry-type"], "LineString"], ["!", ["has", "band"]]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": spotLineColor, "line-width": spotWidth(2, 4) },
        } as LayerSpecification);
        map.addLayer({
          id: "ps-focus-line", type: "line", source: "public-spots", filter: ["==", ["get", "id"], ""],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": spotWidth(9, 17) },
        } as LayerSpecification);
        map.addLayer({
          id: "ps-focus-line-top", type: "line", source: "public-spots", filter: ["==", ["get", "id"], ""],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": spotLineColor, "line-width": spotWidth(3, 6) },
        } as LayerSpecification);
        map.addLayer({
          id: "ps-focus-point", type: "circle", source: "public-spots",
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "id"], ""]],
          paint: { "circle-color": ["get", "color"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 8, 14, 13], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
        });
        map.addLayer({
          id: "pick-segment", type: "line", source: "pick-segment",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#f5a524", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 5, 14, 10] },
        });
        map.addLayer({
          id: "pick-vertices", type: "circle", source: "pick-vertices",
          paint: { "circle-color": "#f5a524", "circle-radius": 5, "circle-stroke-color": "#0b0d11", "circle-stroke-width": 2 },
        });
        map.addLayer({
          id: "ps-point", type: "symbol", source: "public-spots", filter: ["==", ["geometry-type"], "Point"],
          layout: {
            "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true,
            "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 14, 1],
          },
        } as LayerSpecification);
        // Heads-ups sit on top of everything, so they're easy to see and tap.
        map.addSource("heads-ups", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "hu-icons", type: "symbol", source: "heads-ups", minzoom: 6,
          layout: {
            "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true,
            "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 1],
          },
        });
        setReady(true);
        const b = map.getBounds();
        cb.current.onBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      });
      map.on("moveend", () => {
        const b = map.getBounds();
        cb.current.onBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      });
      // Pick the road under a click or tap, with some room for fingers.
      map.on("click", (e) => {
        const p = e.point;
        // Adding a spot: taps choose the place or the road.
        const pk = cb.current.pick;
        if (pk) {
          if (pk.mode === "road") {
            const hits = map.queryRenderedFeatures([[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]], { layers: ["sl-line"] });
            if (hits.length) {
              cb.current.onPickRoad?.(hits[0].properties.id as string);
              return;
            }
            const traced = traceRoadAt(map, p);
            if (traced) cb.current.onTraceRoad?.(traced);
            return;
          }
          cb.current.onPickPoint?.([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        // Heads-ups first: they sit on top of everything.
        const huHits = map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: ["hu-icons"] });
        if (huHits.length && cb.current.onSelectHeadsUp) {
          cb.current.onSelectHeadsUp(huHits[0].properties.id as string);
          return;
        }
        // Spots next: they sit on top of the roads.
        const spotHits = map.queryRenderedFeatures([[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]], { layers: ["ps-point", "ps-line", "ps-band"] });
        const spot = spotHits.length ? cb.current.spots?.find((s) => s.id === spotHits[0].properties.id) : undefined;
        if (spot) {
          cb.current.onSelectSpot?.(spot.id);
          return;
        }
        const hits = map.queryRenderedFeatures(
          [[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]],
          { layers: ["sl-line", "sl-selected"] },
        );
        if (hits.length) {
          const best = hits.reduce((a, b) => ((b.properties.score as number) > (a.properties.score as number) ? b : a));
          cb.current.onSelect(best.properties.id as string);
        }
      });
      map.on("mousemove", "sl-line", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const id = e.features?.[0]?.properties.id as string | undefined;
        cb.current.onHover(id ?? null);
      });
      map.on("mouseleave", "sl-line", () => {
        map.getCanvas().style.cursor = "";
        cb.current.onHover(null);
      });
      mapRef.current = map;
      if (cb.current.extendRef) cb.current.extendRef.current = (line, atEnd) => extendOnMap(map, line, atEnd);
      // Follow the container's size (for example the phone's full-map button).
      resize = new ResizeObserver(() => map.resize());
      resize.observe(el.current);
      if (process.env.NODE_ENV === "development") {
        // Debug handles for testing in the browser (development only).
        const w = window as unknown as { __slmap: MLMap; __slextend: RoadExtender; __sltrace: typeof traceRoadAt };
        w.__slmap = map;
        w.__slextend = (line, atEnd) => extendOnMap(map, line, atEnd);
        w.__sltrace = traceRoadAt;
      }
    })();
    return () => {
      cancelled = true;
      resize?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapRef.current?.resize();
  }, [props.layoutKey]);

  // While adding a spot: the chosen stretch, drawn points, the pin, and a crosshair.
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    const pk = props.pick;
    const empty = { type: "FeatureCollection" as const, features: [] };
    (map.getSource("pick-segment") as GeoJSONSource).setData(
      pk?.segment && pk.segment.length > 1
        ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pk.segment } }
        : empty,
    );
    (map.getSource("pick-vertices") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (pk?.mode === "draw" ? pk.vertices : []).map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })),
    });
    pinRef.current?.remove();
    pinRef.current = pk?.mode === "point" && pk.pin ? new ml.Marker({ color: "#f5a524" }).setLngLat(pk.pin).addTo(map) : null;
    map.getCanvas().style.cursor = pk ? "crosshair" : "";
  }, [ready, props.pick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setPadding({ top: 0, left: 0, right: 0, bottom: props.bottomInset ?? 0 });
  }, [ready, props.bottomInset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("public-spots") as GeoJSONSource | undefined)?.setData(
      spotFeatures(props.spots ?? [], { bands: true, me: props.meId ?? null, score: props.spotScore }),
    );
  }, [ready, props.spots, props.meId, props.spotScore]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("heads-ups") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (props.headsUps ?? []).map((h) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [h.lng, h.lat] },
        properties: { id: h.id, icon: headsUpIconId(h.kind) },
      })),
    });
  }, [ready, props.headsUps]);

  // Fly to a spot (for example one just added) and ring it.
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    const f = props.focusSpot;
    if (!ready || !map || !ml || !f) return;
    const spot = props.spots?.find((s) => s.id === f.id);
    if (!spot) return;
    const b = spotsBbox([spot]);
    if (b) {
      const pad = b[0] === b[2] ? 0.01 : 0;
      map.fitBounds([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], { padding: 60, maxZoom: 14, duration: 700 });
    }
    // The key decides when to fly; spots can update without moving the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.focusSpot, props.spots?.length]);

  // The selected spot, outlined like a selected road.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const id = props.selectedSpotId ?? "";
    const line = ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "id"], id]] as FilterSpecification;
    map.setFilter("ps-focus-line", line);
    map.setFilter("ps-focus-line-top", line);
    map.setFilter("ps-focus-point", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "id"], id]] as FilterSpecification);
  }, [ready, props.selectedSpotId]);

  // Road lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const key = props.scoreKey;
    const src = map.getSource("roads") as GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: props.roads.map((r) => ({
        type: "Feature",
        properties: { id: r.id, name: r.name, score: r.scores[key] },
        geometry: { type: "LineString", coordinates: r.coords },
      })),
    });
  }, [ready, props.roads, props.scoreKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("sl-selected", idFilter(props.selectedId));
    map.setFilter("sl-selected-casing", idFilter(props.selectedId));
  }, [ready, props.selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const hover = props.hoverId && props.hoverId !== props.selectedId ? props.hoverId : null;
    map.setFilter("sl-hover", idFilter(hover));
    // Phones: a soft glow under it, so it shows even behind the cards or the search.
    map.setFilter("sl-hover-glow", idFilter(props.phone ? hover : null));
  }, [ready, props.hoverId, props.selectedId, props.phone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyTheme(map, theme.current, props.theme);
    theme.current = props.theme;
    for (const [id, on] of Object.entries(baseVisibility(props.satellite))) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  }, [ready, props.satellite, props.theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !props.focus) return;
    const [w, s, e, n] = props.focus.bbox;
    if (props.focus.fly) {
      // A long move out (All roads, 11.56): a smooth flight, clear of whatever
      // floats over the top of the map (phone search and chips).
      const top = topOverlay(map.getContainer());
      const cam = map.cameraForBounds([[w, s], [e, n]], { padding: { top: top + 24, bottom: 24, left: 24, right: 24 } });
      if (cam) map.flyTo({ ...cam, bearing: 0, pitch: 0, duration: 1400 });
      return;
    }
    map.fitBounds([[w, s], [e, n]], props.focus.exact ? { padding: 0, duration: 400 } : { padding: 48, maxZoom: 13.5, duration: 600 });
  }, [ready, props.focus]);

  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (props.myLocation) {
      const dot = document.createElement("div");
      dot.className = "me-dot";
      dot.setAttribute("aria-label", "Your location");
      markerRef.current = new ml.Marker({ element: dot }).setLngLat(props.myLocation).addTo(map);
    }
  }, [ready, props.myLocation]);

  return (
    <div
      ref={el}
      className="map"
      role="region"
      aria-label="Map of the roads. The list next to it has every road on the map, with the same scores."
    />
  );
}

