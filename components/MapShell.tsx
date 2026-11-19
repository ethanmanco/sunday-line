"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import type { FocusRequest } from "./MapView";
import { useAuth } from "./AuthProvider";
import ItemCards from "./ItemCards";
import SpotEditor from "./spots/SpotEditor";
import { useSpotLayers } from "./SpotLayers";
import { DATA_URL } from "@/lib/config";
import {
  MapShellContext, type ListItem, type LL, type MapShell as Shell, type PickHandlers, type PickState, type SheetState,
} from "@/lib/mapShell";
import { decodePolyline } from "@/lib/polyline";
import { applyFilters, badgeKey, DEFAULT_FILTERS, haversineMi, type Bounds, type Filters } from "@/lib/roads";
import { spotsBbox, type Spot, type SpotKind } from "@/lib/spots";
import { rememberReturn } from "@/lib/supabase";
import type { LoadedRoad, RegionInfo, RoadData } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map map-loading" /> });

const SHEET_MEDIA = "(max-width: 899px) and (orientation: portrait), (max-width: 599px)";

function spotIn(s: Spot, b: Bounds): boolean {
  const box = spotsBbox([s]);
  if (!box) return false;
  return !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]);
}

/**
 * The map that stays put while people move between the road list, a road, a
 * profile, a group, and an event. Pages render in the panel: a side panel on
 * wide screens and in phone landscape, a sheet from the bottom on phones.
 */
export default function MapShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile } = useAuth();
  const [region, setRegion] = useState<RegionInfo | null>(null);
  const [roads, setRoads] = useState<LoadedRoad[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showRoads, setShowRoads] = useState(true);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [myLocation, setMyLocation] = useState<LL | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [focusSpot, setFocusSpotState] = useState<{ id: string; key: number } | null>(null);
  const [overlay, setOverlay] = useState<{ title: string; spots: Spot[] } | null>(null);
  const [showEverything, setShowEverything] = useState(false);
  const [pick, setPickState] = useState<PickState | null>(null);
  const pickHandlers = useRef<PickHandlers | null>(null);
  const [adding, setAdding] = useState<SpotKind | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState>("closed");
  const [panelWide, setPanelWide] = useState(false);
  const [isSheet, setIsSheet] = useState(false);
  const layers = useSpotLayers();

  useEffect(() => {
    fetch(DATA_URL, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<RoadData>;
      })
      .then((d) => {
        setRegion(d.region);
        setRoads(d.roads.map((r) => ({ ...r, coords: decodePolyline(r.line) })));
      })
      .catch(() => setLoadError("The road data didn't load. Check your connection and reload the page."));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(SHEET_MEDIA);
    const update = () => setIsSheet(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Leaving a page clears its spots from the map.
  const home = pathname === "/";
  const onRoad = pathname.startsWith("/road/");
  useEffect(() => {
    setShowEverything(false);
    if (!onRoad) setSelectedId(null);
    setAdding(null);
    setAddOpen(false);
  }, [pathname, onRoad]);

  const byId = useMemo(() => new Map(roads.map((r) => [r.id, r])), [roads]);
  const origin: LL = myLocation ?? region?.home ?? [0, 0];
  const originName = myLocation ? "you" : region?.home_name ?? "home";
  const scoreKey = badgeKey(filters.view);

  // The list and the cards: roads and spots together, filtered the same way.
  const roadList = useMemo(
    () => (region && showRoads ? applyFilters(roads, filters, origin, bounds) : []),
    // origin comes from myLocation and region
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roads, filters, bounds, region, myLocation, showRoads],
  );
  const spotList = useMemo(() => {
    if (!region) return [] as { spot: Spot; distance: number }[];
    return layers.spots
      .map((spot) => ({ spot, distance: haversineMi(origin, [spot.lng, spot.lat]) }))
      .filter((x) => (filters.maxMiles === null || x.distance <= filters.maxMiles) && (!filters.inView || !bounds || spotIn(x.spot, bounds)))
      .sort((a, b) => a.distance - b.distance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.spots, filters.maxMiles, filters.inView, bounds, region, myLocation]);
  const items = useMemo((): ListItem[] => {
    const r: ListItem[] = roadList.map((road) => ({ kind: "road", road, distance: haversineMi(origin, road.start) }));
    const s: ListItem[] = spotList.map((x) => ({ kind: "spot", spot: x.spot, distance: x.distance }));
    // Closest first mixes both; score sorts list roads first, then spots by distance.
    return filters.sort === "distance" ? [...r, ...s].sort((a, b) => a.distance - b.distance) : [...r, ...s];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadList, spotList, filters.sort, myLocation, region]);

  const mapRoads = useMemo(() => {
    if (!region) return [];
    if ((!showRoads || (overlay && !showEverything)) && pick?.mode !== "road") return [];
    const shown = applyFilters(roads, { ...filters, inView: false }, origin, null);
    const sel = selectedId ? byId.get(selectedId) : null;
    if (sel && !shown.includes(sel)) shown.push(sel);
    return shown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roads, filters.view, filters.maxMiles, filters.minMiles, region, myLocation, selectedId, showRoads, overlay, showEverything, pick?.mode]);

  const mapSpots = useMemo(() => {
    if (overlay && !showEverything) return overlay.spots;
    if (overlay) {
      const ids = new Set(overlay.spots.map((s) => s.id));
      return [...overlay.spots, ...layers.spots.filter((s) => !ids.has(s.id))];
    }
    return layers.spots;
  }, [overlay, showEverything, layers.spots]);

  // When a page's spots arrive, show them all.
  const overlayKey = overlay ? `${overlay.title}:${overlay.spots.map((s) => s.id).join(",")}` : "";
  useEffect(() => {
    if (!overlay || !overlay.spots.length) return;
    const b = spotsBbox(overlay.spots);
    if (b) setFocus({ bbox: b[0] === b[2] ? [b[0] - 0.02, b[1] - 0.02, b[2] + 0.02, b[3] + 0.02] : b, key: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey]);

  const selectRoad = useCallback((id: string) => {
    const r = byId.get(id);
    if (!r) return;
    setSelectedId(id);
    setFocus({ bbox: r.bbox, key: Date.now() });
    if (window.location.pathname !== `/road/${id}`) {
      if (window.location.pathname === "/" || window.location.pathname.startsWith("/road/")) {
        window.history.pushState(null, "", `/road/${id}`);
      } else {
        router.push(`/road/${id}`);
      }
    }
    setSheet("half");
  }, [byId, router]);

  const closeRoad = useCallback(() => {
    setSelectedId(null);
    if (window.location.pathname !== "/") window.history.pushState(null, "", "/");
    setSheet((s) => (s === "half" || s === "full" ? "half" : s));
  }, []);

  const doFocusSpot = useCallback((id: string) => {
    setFocusSpotState({ id, key: Date.now() });
    setSheet((s) => (s === "full" ? "peek" : s));
  }, []);

  const setPick = useCallback((state: PickState | null, handlers?: PickHandlers) => {
    pickHandlers.current = handlers ?? null;
    setPickState((prev) => {
      if (!state || !prev) return state;
      const same = prev.mode === state.mode && prev.pin === state.pin && prev.segment === state.segment
        && prev.vertices === state.vertices && prev.selectedRoadId === state.selectedRoadId;
      return same ? prev : state;
    });
  }, []);

  const startAdding = useCallback((kind: SpotKind) => {
    setAddOpen(false);
    if (!user || !profile) {
      rememberReturn("/");
      router.push(user ? "/me" : "/signin");
      return;
    }
    setAdding(kind);
    setSheet("half");
  }, [user, profile, router]);

  async function added(id: string) {
    setAdding(null);
    layers.save({ ...layers.saved, mine: true });
    await layers.reload();
    setSheet(home ? "closed" : "half");
    setFocusSpotState({ id, key: Date.now() });
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setLocationError("This browser can't share a location.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // Kept in this page's memory only. Never sent anywhere or saved.
        setMyLocation([pos.coords.longitude, pos.coords.latitude]);
      },
      () => {
        setLocating(false);
        setLocationError("Couldn't get your location. Distances stay measured from the region's home town.");
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  }

  // Room the sheet takes at the bottom, so fitted views stay visible.
  const [vh, setVh] = useState(800);
  useEffect(() => {
    const u = () => setVh(window.innerHeight);
    u();
    window.addEventListener("resize", u);
    return () => window.removeEventListener("resize", u);
  }, []);
  const panelOpen = adding ? "half" : sheet;
  const bottomInset = !isSheet ? 0 : panelOpen === "half" ? Math.round(vh * 0.5) : panelOpen === "peek" ? 130 : 0;

  const ctx: Shell = {
    region, roads, byId, loadError,
    filters, setFilters, showRoads, setShowRoads,
    layers: layers.saved, saveLayers: layers.save, spotGroups: layers.groups, signedIn: layers.signedIn, reloadSpots: layers.reload,
    items, roadCount: roadList.length, spotCount: spotList.length,
    origin, originName, usingMyLocation: !!myLocation, locating, locationError, locateMe,
    clearMyLocation: () => setMyLocation(null), bounds,
    selectedId, selectRoad, closeRoad, hoverId, setHoverId,
    overlay, setOverlay, focusSpot: doFocusSpot, fitTo: (b) => setFocus({ bbox: b, key: Date.now() }),
    setPick, startAdding,
    sheet, setSheet, setPanelWide, isSheet,
  };

  const showCards = isSheet && home && !adding && (sheet === "closed" || sheet === "peek");
  const sheetClass = isSheet ? ` sheet-${panelOpen}` : "";

  return (
    <MapShellContext.Provider value={ctx}>
      <div className={`shell${panelWide ? " wide" : ""}${isSheet ? " is-sheet" : ""}`}>
        <section className={`shell-panel${sheetClass}`} aria-label="Page">
          {isSheet && panelOpen !== "closed" && (
            <div className="sheet-handle">
              <button
                type="button"
                className="sheet-grip"
                aria-label={panelOpen === "full" ? "Show more map" : "Show more of the page"}
                onClick={() => setSheet(panelOpen === "full" ? "half" : panelOpen === "half" ? "full" : "half")}
              >
                <span aria-hidden="true" />
              </button>
              <button type="button" className="sheet-hide" onClick={() => setSheet(home && !adding ? "closed" : "peek")}>
                {home && !adding ? "Close" : "Map"}
              </button>
            </div>
          )}
          {adding ? (
            <div className="panel-pad">
              <SpotEditor initialKind={adding} initialBbox={bounds} onSaved={added} onCancel={() => { setAdding(null); setSheet(home ? "closed" : "half"); }} />
            </div>
          ) : (
            children
          )}
        </section>
        <div className="shell-map">
          {loadError && <p className="load-error">{loadError}</p>}
          {region && (
            <MapView
              roads={mapRoads}
              scoreKey={scoreKey}
              regionBbox={region.bbox}
              selectedId={selectedId}
              hoverId={hoverId}
              satellite={satellite}
              focus={focus}
              myLocation={myLocation}
              layoutKey={`${isSheet}-${panelOpen}-${panelWide}`}
              spots={mapSpots}
              focusSpot={focusSpot}
              pick={pick}
              bottomInset={bottomInset}
              onPickPoint={(ll) => pickHandlers.current?.onPickPoint(ll)}
              onPickRoad={(id) => pickHandlers.current?.onPickRoad(id)}
              onTraceRoad={(t) => pickHandlers.current?.onTraceRoad(t)}
              onSelect={selectRoad}
              onHover={setHoverId}
              onBounds={setBounds}
            />
          )}
          <div className="map-top-left">
            {isSheet && home && !adding && (
              <button type="button" className="map-chip" onClick={() => setSheet(sheet === "closed" || sheet === "peek" ? "half" : "closed")}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                List and filters
              </button>
            )}
            <button type="button" className="map-chip" aria-pressed={satellite} onClick={() => setSatellite(!satellite)}>
              {satellite ? "Map" : "Satellite"}
            </button>
            {overlay && (
              <button type="button" className="map-chip" aria-pressed={showEverything} onClick={() => setShowEverything(!showEverything)}>
                {showEverything ? `Only ${overlay.title}` : "Show everything"}
              </button>
            )}
          </div>
          {pick && <p className="pick-hint" aria-hidden="true">{pick.mode === "point" ? "Tap to place it" : pick.mode === "draw" ? "Tap along the road" : "Tap a road"}</p>}
          {showCards && <ItemCards items={items.slice(0, 15)} scoreKey={scoreKey} units={region?.units ?? "imperial"} />}
          {!adding && !pick && (
            <div className={`map-actions${addOpen ? " open" : ""}${showCards ? " above-cards" : ""}`}>
              {addOpen && (
                <div className="add-choices" role="group" aria-label="Add a spot">
                  <button type="button" className="add-choice" onClick={() => startAdding("road")}>
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                      <path d="M8 21l2-18M16 21l-2-18M12 5v2M12 11v2M12 17v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Add a road
                  </button>
                  <button type="button" className="add-choice" onClick={() => startAdding("point")}>
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                      <path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <circle cx="12" cy="10" r="2.2" fill="currentColor" />
                    </svg>
                    Add a place
                  </button>
                </div>
              )}
              <button type="button" className="add-toggle" aria-expanded={addOpen} aria-label={addOpen ? "Close" : "Add a road or a place"} onClick={() => setAddOpen(!addOpen)}>
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
          {!isSheet && showRoads && !overlay && (
            <div className="legend" aria-hidden="true">
              <span>{scoreKey === "overall" ? "Overall" : scoreKey === "scenic" ? "Scenic" : "Twisty"}</span>
              <span className="ramp" />
              <span className="ends"><span>35</span><span>80+</span></span>
            </div>
          )}
        </div>
      </div>
    </MapShellContext.Provider>
  );
}
