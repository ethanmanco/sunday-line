"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { directionsLinks } from "@/lib/roads";
import { spotFeatures, spotLabel, type Spot } from "@/lib/spots";
import type { GeoJSONSource, Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import { baseStyle, roadLayers, VECTOR_BASE_LAYERS } from "@/lib/mapStyle";
import type { Bounds } from "@/lib/roads";
import type { LoadedRoad } from "@/lib/types";

export interface FocusRequest {
  bbox: [number, number, number, number];
  key: number;
  exact?: boolean; // restore a saved view instead of framing a road
}

interface Props {
  roads: LoadedRoad[];
  scoreKey: "overall" | "scenic" | "twisty";
  regionBbox: [number, number, number, number];
  selectedId: string | null;
  hoverId: string | null;
  satellite: boolean;
  focus: FocusRequest | null;
  myLocation: [number, number] | null;
  /** Changes when the space around the map changes (phone full-map button). */
  layoutKey?: string;
  /** Spots approved for the public map. */
  spots?: Spot[];
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onBounds: (b: Bounds) => void;
}

const idFilter = (id: string | null) => ["==", ["get", "id"], id ?? ""] as ["==", ["get", string], string];

export default function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<MLMarker | null>(null);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef(props);
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
        style: baseStyle(),
        bounds: cb.current.regionBbox,
        fitBoundsOptions: { padding: 16 },
        attributionControl: { compact: false },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxZoom: 17,
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        map.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const layer of roadLayers()) map.addLayer(layer, "places");
        map.addSource("public-spots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "ps-line", type: "line", source: "public-spots", filter: ["==", ["geometry-type"], "LineString"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#7cc4ff", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 5], "line-dasharray": [2, 1.5] },
        });
        map.addLayer({
          id: "ps-point", type: "circle", source: "public-spots", filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, 14, 8],
            "circle-stroke-color": "#0b0d11",
            "circle-stroke-width": 1.5,
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
        // Spots first: they sit on top of the roads.
        const spotHits = map.queryRenderedFeatures([[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]], { layers: ["ps-point", "ps-line"] });
        const spot = spotHits.length ? cb.current.spots?.find((s) => s.id === spotHits[0].properties.id) : undefined;
        if (spot) {
          popupRef.current?.remove();
          popupRef.current = new ml.Popup({ closeButton: true, maxWidth: "260px", className: "spot-popup" })
            .setLngLat(e.lngLat)
            .setDOMContent(spotPopup(spot))
            .addTo(map);
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
      // Follow the container's size (for example the phone's full-map button).
      resize = new ResizeObserver(() => map.resize());
      resize.observe(el.current);
      if (process.env.NODE_ENV === "development") (window as unknown as { __slmap: MLMap }).__slmap = map;
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

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("public-spots") as GeoJSONSource | undefined)?.setData(spotFeatures(props.spots ?? []));
  }, [ready, props.spots]);

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
    map.setFilter("sl-hover", idFilter(props.hoverId && props.hoverId !== props.selectedId ? props.hoverId : null));
  }, [ready, props.hoverId, props.selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("imagery", "visibility", props.satellite ? "visible" : "none");
    for (const id of VECTOR_BASE_LAYERS) map.setLayoutProperty(id, "visibility", props.satellite ? "none" : "visible");
  }, [ready, props.satellite]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !props.focus) return;
    const [w, s, e, n] = props.focus.bbox;
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

/** The little card shown when a spot on the map is tapped. Built from DOM nodes, so names can't inject markup. */
function spotPopup(s: Spot): HTMLElement {
  const box = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = s.name;
  const kind = document.createElement("div");
  kind.className = "fine";
  kind.textContent = s.group_name
    ? `${spotLabel(s)} · ${s.group_name}`
    : spotLabel(s) + (s.kind === "road" ? " (community pick)" : "");
  box.append(title, kind);
  if (s.description) {
    const d = document.createElement("p");
    d.textContent = s.description;
    box.append(d);
  }
  const go = document.createElement("div");
  go.className = "fine";
  go.append(s.kind === "road" ? "Directions to the start: " : "Directions: ");
  directionsLinks([s.lng, s.lat]).forEach((l, i) => {
    if (i) go.append(" · ");
    const a = document.createElement("a");
    a.href = l.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = l.label;
    go.append(a);
  });
  box.append(go);
  return box;
}
