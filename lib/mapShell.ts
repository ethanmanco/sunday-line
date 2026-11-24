"use client";

import { createContext, useContext } from "react";
import type { Bounds, Filters } from "./roads";
import type { Spot, SpotKind } from "./spots";
import type { LayerChoice } from "@/components/SpotLayers";
import type { TracedRoad } from "./traceRoad";
import type { MapTheme } from "./mapThemes";
import type { LoadedRoad, RegionInfo } from "./types";
import type { Group } from "./supabase";

export type LL = [number, number];

/** Phones: how much of the screen the page panel takes over the map. */
export type SheetState = "closed" | "peek" | "half" | "full";

/** What the map shows while someone adds a spot on it. */
export interface PickState {
  mode: "point" | "road" | "draw";
  pin: LL | null;
  segment: LL[] | null;
  vertices: LL[];
  selectedRoadId: string | null;
}

export interface PickHandlers {
  onPickPoint: (ll: LL) => void;
  onPickRoad: (id: string) => void;
  onTraceRoad: (t: TracedRoad) => void;
}

export type ListItem =
  | { kind: "road"; road: LoadedRoad; distance: number }
  | { kind: "spot"; spot: Spot; distance: number };

export interface MapShell {
  region: RegionInfo | null;
  roads: LoadedRoad[];
  byId: Map<string, LoadedRoad>;
  loadError: string | null;
  // What shows in the list, the cards, and on the map.
  filters: Filters;
  setFilters: (f: Filters) => void;
  showRoads: boolean;
  setShowRoads: (on: boolean) => void;
  layers: LayerChoice;
  saveLayers: (l: LayerChoice) => void;
  spotGroups: Group[];
  signedIn: boolean;
  reloadSpots: () => Promise<void>;
  items: ListItem[];
  roadCount: number;
  spotCount: number;
  // Where distances are measured from.
  origin: LL;
  originName: string;
  usingMyLocation: boolean;
  locating: boolean;
  locationError: string | null;
  locateMe: () => void;
  clearMyLocation: () => void;
  /** The town picked in the place search, if distances run from it. */
  placeName: string | null;
  /** Move the map to a town or state; a town (with a point) becomes the distance origin. */
  goToPlace: (p: { name: string; point: LL | null; bbox: Bounds }) => void;
  bounds: Bounds | null;
  satellite: boolean;
  setSatellite: (on: boolean) => void;
  /** The map style (11.63), kept on this device. */
  mapStyle: MapTheme;
  setMapStyle: (t: MapTheme) => void;
  /** Waiting for a tap on the map to set the person's location. */
  settingLocation: boolean;
  startSettingLocation: () => void;
  /** Show a road from a shared link (loaded on the server). */
  addRoad: (r: LoadedRoad) => void;
  // Roads.
  selectedId: string | null;
  selectRoad: (id: string) => void;
  closeRoad: () => void;
  /** "All roads": close the road or spot and fly back out to your area or the mainland. */
  showAllRoads: () => void;
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  // A page's own spots (profile, group, event) shown instead of the usual layers.
  overlay: { title: string; spots: Spot[] } | null;
  setOverlay: (o: { title: string; spots: Spot[] } | null) => void;
  /** Select a spot: highlight it on the map and show its details (on the home map) or its card (on a page). */
  focusSpot: (id: string) => void;
  selectedSpotId: string | null;
  selectedSpot: Spot | null;
  closeSpot: () => void;
  /** The scored road a road-spot sits on (null: none or not checked yet). */
  spotRoad: (spotId: string) => import("./roadData").RoadOnMap | null;
  /** Constants for scoring part of a road (null until the data loads or with older data). */
  stretchModel: import("./stretch").StretchModel | null;
  /** On-request scores for drawn roads (11.27), and a way to refresh one. */
  roadScore: (spotId: string) => import("./spots").RoadScore | null;
  reloadRoadScore: (spotId: string) => Promise<void>;
  fitTo: (bbox: Bounds) => void;
  // Adding a spot on this map.
  setPick: (state: PickState | null, handlers?: PickHandlers) => void;
  /** Make a picked road longer past one end, following the base map (11.36). */
  extendRoad: import("./traceRoad").RoadExtender;
  startAdding: (kind: SpotKind) => void;
  // Layout.
  sheet: SheetState;
  setSheet: (s: SheetState) => void;
  setPanelWide: (wide: boolean) => void;
  /** True on phones in portrait, where the panel is a bottom sheet. */
  isSheet: boolean;
}

export const MapShellContext = createContext<MapShell | null>(null);

/** The shared map, when the page sits on it (null on ordinary pages). */
export function useMapShell(): MapShell | null {
  return useContext(MapShellContext);
}
