"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { directionsLinks } from "@/lib/roads";
import { spotFeatures, spotLabel, spotsBbox, type Spot } from "@/lib/spots";
import type { PickState } from "@/lib/mapShell";
import { traceRoadAt, type TracedRoad } from "@/lib/traceRoad";
import type { GeoJSONSource, Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import { baseStyle, roadLayers, VECTOR_BASE_LAYERS } from "@/lib/mapStyle";
import type { Bounds } from "@/lib/roads";
import type { LoadedRoad } from "@/lib/types";
import { findSpotRoad } from "@/lib/spotRoad";
import type { RoadOnMap } from "@/lib/roadData";
import { getSupabase } from "@/lib/supabase";

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
  /** Fly to and highlight one spot (change key to repeat). */
  focusSpot?: { id: string; key: number } | null;
  /** Adding a spot on this map: what to draw, and taps go to the handlers. */
  pick?: PickState | null;
  onPickPoint?: (ll: [number, number]) => void;
  onPickRoad?: (id: string) => void;
  onTraceRoad?: (t: TracedRoad) => void;
  /** Pixels hidden at the bottom (the phone sheet), kept clear when fitting views. */
  bottomInset?: number;
  onSelect: (id: string) => void;
  /** A spot's "Road stats" button: open the scored road it sits on. */
  onOpenRoad?: (road: RoadOnMap) => void;
  /** A link in a spot's card (a profile or a group). */
  onNavigate?: (href: string) => void;
  onHover: (id: string | null) => void;
  onBounds: (b: Bounds) => void;
}

const idFilter = (id: string | null) => ["==", ["get", "id"], id ?? ""] as ["==", ["get", string], string];

export default function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<MLMarker | null>(null);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  const pinRef = useRef<MLMarker | null>(null);
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
        map.addSource("pick-segment", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("pick-vertices", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "ps-line", type: "line", source: "public-spots", filter: ["==", ["geometry-type"], "LineString"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#7cc4ff", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 5], "line-dasharray": [2, 1.5] },
        });
        map.addLayer({
          id: "ps-focus-line", type: "line", source: "public-spots",
          filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "id"], ""]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#f5a524", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 12], "line-opacity": 0.85 },
        });
        map.addLayer({
          id: "ps-focus-point", type: "circle", source: "public-spots",
          filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "id"], ""]],
          paint: { "circle-color": "rgba(245,165,36,0.25)", "circle-radius": 22, "circle-stroke-color": "#f5a524", "circle-stroke-width": 3 },
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
        // Spots first: they sit on top of the roads.
        const spotHits = map.queryRenderedFeatures([[p.x - 10, p.y - 10], [p.x + 10, p.y + 10]], { layers: ["ps-point", "ps-line"] });
        const spot = spotHits.length ? cb.current.spots?.find((s) => s.id === spotHits[0].properties.id) : undefined;
        if (spot) {
          popupRef.current?.remove();
          popupRef.current = new ml.Popup({ closeButton: true, maxWidth: "260px", className: "spot-popup" })
            .setLngLat(e.lngLat)
            .setDOMContent(spotPopup(spot, cb.current, () => popupRef.current?.remove()))
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
    if (pk) popupRef.current?.remove();
  }, [ready, props.pick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setPadding({ top: 0, left: 0, right: 0, bottom: props.bottomInset ?? 0 });
  }, [ready, props.bottomInset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("public-spots") as GeoJSONSource | undefined)?.setData(spotFeatures(props.spots ?? []));
  }, [ready, props.spots]);

  // Fly to a spot (for example one just added) and ring it.
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    const f = props.focusSpot;
    if (!ready || !map || !ml || !f) return;
    const spot = props.spots?.find((s) => s.id === f.id);
    if (!spot) return;
    map.setFilter("ps-focus-line", ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "id"], f.id]]);
    map.setFilter("ps-focus-point", ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "id"], f.id]]);
    const b = spotsBbox([spot]);
    if (b) {
      const pad = b[0] === b[2] ? 0.01 : 0;
      map.fitBounds([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], { padding: 60, maxZoom: 14, duration: 700 });
    }
    popupRef.current?.remove();
    popupRef.current = new ml.Popup({ closeButton: true, maxWidth: "260px", className: "spot-popup" })
      .setLngLat([spot.lng, spot.lat])
      .setDOMContent(spotPopup(spot, cb.current, () => popupRef.current?.remove()))
      .addTo(map);
    // The key decides when to fly; spots can update without moving the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.focusSpot, props.spots?.length]);

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

/**
 * The little card shown when a spot on the map is tapped. Built from DOM
 * nodes, so names can't inject markup. Who added it, its groups, and its road
 * stats fill in after it opens.
 */
function spotPopup(s: Spot, h: Pick<Props, "onOpenRoad" | "onNavigate">, close: () => void): HTMLElement {
  const box = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = s.name;
  const kind = document.createElement("div");
  kind.className = "fine";
  kind.textContent = s.group_name
    ? `${spotLabel(s)} · ${s.group_name}`
    : spotLabel(s) + (s.kind === "road" && s.public_status === "approved" ? " (community pick)" : "");
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

  const more = document.createElement("div");
  more.className = "popup-actions";
  box.append(more);
  const link = (label: string, href: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.className = "chip";
    a.textContent = label;
    a.addEventListener("click", (e) => {
      if (!h.onNavigate || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      close();
      h.onNavigate(href);
    });
    more.append(a);
  };
  if (s.kind === "road") {
    findSpotRoad(s).then((road) => {
      if (road && h.onOpenRoad) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip accent";
        b.textContent = "Road stats";
        b.addEventListener("click", () => {
          close();
          h.onOpenRoad!(road);
        });
        more.prepend(b);
      } else if (!road) {
        const n = document.createElement("p");
        n.className = "fine";
        n.textContent = "Drawn by hand off the scored roads, so there are no road stats.";
        box.insertBefore(n, more);
      }
    });
  }
  const sb = getSupabase();
  if (sb && s.owner_id && !s.id.startsWith("event-")) {
    sb.from("profiles").select("username, display_name").eq("id", s.owner_id).maybeSingle().then(({ data }) => {
      const p = data as { username: string; display_name: string } | null;
      if (p) link(`By ${p.display_name}`, `/u/${p.username}`);
    });
    sb.from("spot_groups").select("group:groups(name, short_id)").eq("spot_id", s.id).eq("status", "accepted").then(({ data }) => {
      for (const r of (data as unknown as { group: { name: string; short_id: string } | null }[] | null) ?? []) {
        if (r.group) link(`In ${r.group.name}`, `/g/${r.group.short_id}`);
      }
    });
  }
  return box;
}
