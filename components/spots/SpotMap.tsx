"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { baseStyle } from "@/lib/mapStyle";
import { spotFeatures, spotsBbox, type Spot } from "@/lib/spots";
import { extendOnMap, traceRoadAt, type RoadExtender, type TracedRoad } from "@/lib/traceRoad";
import type { LoadedRoad } from "@/lib/types";

type Box = [number, number, number, number];

interface Props {
  spots: Spot[];
  /** Where to look when there is nothing to fit. */
  fallbackBbox: Box;
  /** "point": tap to drop a pin. "road": tap a road to choose it. "draw": tap points along a road. */
  mode?: "view" | "point" | "road" | "draw";
  roads?: LoadedRoad[];
  selectedRoadId?: string | null;
  segment?: [number, number][] | null;
  pin?: [number, number] | null;
  /** Points tapped so far in draw mode. */
  vertices?: [number, number][];
  /** Change it to fit the view again. */
  fitKey?: string;
  /** Zoom to and ring this spot (fits when fitKey changes). */
  focusId?: string | null;
  className?: string;
  onPickPoint?: (lngLat: [number, number]) => void;
  onPickRoad?: (id: string) => void;
  /** A road from the base map that isn't one of the suggested ones. */
  onTraceRoad?: (road: TracedRoad) => void;
  /** Filled with a way to make a picked road longer on this map. */
  extendRef?: { current: RoadExtender | null };
  onSpotClick?: (id: string) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export default function SpotMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const pinRef = useRef<MLMarker | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      mlRef.current = ml;
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const p = cb.current;
      const map = new ml.Map({
        container: el.current,
        style: baseStyle(),
        bounds: fitBox(p) ?? p.fallbackBbox,
        fitBoundsOptions: { padding: 40, maxZoom: 14 },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxZoom: 18,
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        map.addSource("pick-roads", { type: "geojson", data: EMPTY });
        map.addSource("segment", { type: "geojson", data: EMPTY });
        map.addSource("spots", { type: "geojson", data: EMPTY });
        map.addSource("vertices", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "pick-roads", type: "line", source: "pick-roads",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["case", ["==", ["get", "id"], ["literal", cb.current.selectedRoadId ?? ""]], "#7cc4ff", "#c9ced6"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 6],
            "line-opacity": 0.55,
          },
        });
        map.addLayer({
          id: "segment", type: "line", source: "segment",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#f5a524", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 9] },
        });
        map.addLayer({
          id: "vertices", type: "circle", source: "vertices",
          paint: { "circle-color": "#f5a524", "circle-radius": 5, "circle-stroke-color": "#0b0d11", "circle-stroke-width": 2 },
        });
        map.addLayer({
          id: "spots-line", type: "line", source: "spots", filter: ["==", ["geometry-type"], "LineString"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 7], "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "spots-focus", type: "circle", source: "spots",
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "id"], ""]],
          paint: { "circle-color": "rgba(245,165,36,0.25)", "circle-radius": 20, "circle-stroke-color": "#f5a524", "circle-stroke-width": 3 },
        });
        map.addLayer({
          id: "spots-focus-line", type: "line", source: "spots",
          filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "id"], ""]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#f5a524", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 7, 14, 13], "line-opacity": 0.6 },
        });
        map.addLayer({
          id: "spots-point", type: "circle", source: "spots", filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 14, 9],
            "circle-stroke-color": "#0b0d11",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "spots-name", type: "symbol", source: "spots", minzoom: 10,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "symbol-placement": "point",
          },
          paint: { "text-color": "#e8ebef", "text-halo-color": "#0b0d11", "text-halo-width": 1.5 },
        });
        setReady(true);
      });
      map.on("click", (e) => {
        const c = cb.current;
        const pt = e.point;
        const box: [[number, number], [number, number]] = [[pt.x - 12, pt.y - 12], [pt.x + 12, pt.y + 12]];
        if (c.mode === "road") {
          // Suggested roads first; otherwise trace whatever road is on the base map.
          const hits = map.queryRenderedFeatures(box, { layers: ["pick-roads"] });
          if (hits.length) {
            c.onPickRoad?.(hits[0].properties.id as string);
            return;
          }
          const traced = traceRoadAt(map, pt);
          if (traced) c.onTraceRoad?.(traced);
          return;
        }
        if (c.mode === "point" || c.mode === "draw") {
          c.onPickPoint?.([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        const hits = map.queryRenderedFeatures(box, { layers: ["spots-point", "spots-line"] });
        if (hits.length) c.onSpotClick?.(hits[0].properties.id as string);
      });
      for (const layer of ["spots-point", "spots-line", "pick-roads"]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      }
      mapRef.current = map;
      if (cb.current.extendRef) cb.current.extendRef.current = (line, atEnd) => extendOnMap(map, line, atEnd);
      if (process.env.NODE_ENV === "development") (window as unknown as { __spotmap: MLMap }).__spotmap = map;
      resize = new ResizeObserver(() => map.resize());
      resize.observe(el.current);
    })();
    return () => {
      cancelled = true;
      resize?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Data.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("spots") as GeoJSONSource).setData(spotFeatures(props.spots));
  }, [ready, props.spots]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const roads = props.mode === "road" ? props.roads ?? [] : [];
    (map.getSource("pick-roads") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: roads.map((r) => ({ type: "Feature", properties: { id: r.id }, geometry: { type: "LineString", coordinates: r.coords } })),
    });
  }, [ready, props.mode, props.roads]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setPaintProperty("pick-roads", "line-color", ["case", ["==", ["get", "id"], props.selectedRoadId ?? ""], "#7cc4ff", "#c9ced6"]);
  }, [ready, props.selectedRoadId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("segment") as GeoJSONSource).setData(
      props.segment && props.segment.length > 1
        ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: props.segment } }
        : EMPTY,
    );
  }, [ready, props.segment]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("vertices") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (props.vertices ?? []).map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })),
    });
  }, [ready, props.vertices]);

  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    pinRef.current?.remove();
    pinRef.current = props.pin ? new ml.Marker({ color: "#f5a524" }).setLngLat(props.pin).addTo(map) : null;
  }, [ready, props.pin]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const id = props.focusId ?? "";
    map.setFilter("spots-focus", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "id"], id]]);
    map.setFilter("spots-focus-line", ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "id"], id]]);
  }, [ready, props.focusId]);

  // Fit again when asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || props.fitKey === undefined) return;
    const box = fitBox(props);
    if (box) map.fitBounds(box, { padding: 40, maxZoom: 15, duration: 400 });
    // Only the key decides when to refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.fitKey]);

  return <div ref={el} className={`spot-map ${props.className ?? ""}`} />;
}

function fitBox(p: Props): Box | null {
  const focused = p.focusId ? p.spots.find((s) => s.id === p.focusId) : null;
  if (focused) {
    const b = spotsBbox([focused])!;
    return b[0] === b[2] ? [b[0] - 0.01, b[1] - 0.01, b[2] + 0.01, b[3] + 0.01] : b;
  }
  if (p.segment && p.segment.length > 1) {
    const xs = p.segment.map((c) => c[0]);
    const ys = p.segment.map((c) => c[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  if (p.pin) return [p.pin[0] - 0.01, p.pin[1] - 0.01, p.pin[0] + 0.01, p.pin[1] + 0.01];
  const b = spotsBbox(p.spots);
  if (!b) return null;
  // A single point: give it some room.
  return b[0] === b[2] && b[1] === b[3] ? [b[0] - 0.02, b[1] - 0.02, b[2] + 0.02, b[3] + 0.02] : b;
}
