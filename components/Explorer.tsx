"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import FilterBar from "./FilterBar";
import RoadDetail from "./RoadDetail";
import RoadList from "./RoadList";
import type { FocusRequest } from "./MapView";
import { DATA_URL } from "@/lib/config";
import { decodePolyline } from "@/lib/polyline";
import { SpotLayersControl, useSpotLayers } from "./SpotLayers";
import RoadCards from "./RoadCards";
import SpotEditor from "./spots/SpotEditor";
import { useAuth } from "./AuthProvider";
import { useRouter } from "next/navigation";
import { rememberReturn } from "@/lib/supabase";
import type { SpotKind } from "@/lib/spots";
import { applyFilters, badgeKey, DEFAULT_FILTERS, defaultSort, type Bounds, type Filters, type View } from "@/lib/roads";
import type { LoadedRoad, RegionInfo, RoadData } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map map-loading" /> });

function roadIdFromPath(path: string): string | null {
  const m = path.match(/^\/road\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1] : null;
}

export default function Explorer({ initialRoadId }: { initialRoadId?: string }) {
  const [region, setRegion] = useState<RegionInfo | null>(null);
  const [roads, setRoads] = useState<LoadedRoad[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialRoadId ?? null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [myLocation, setMyLocation] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  // Phones: hide the list so the map fills the screen.
  const [fullMap, setFullMap] = useState(false);
  const layers = useSpotLayers();
  const { user, profile } = useAuth();
  const router = useRouter();
  // The + button: closed, open (showing road and place), or adding one.
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState<SpotKind | null>(null);
  const [focusSpot, setFocusSpot] = useState<{ id: string; key: number } | null>(null);

  // A link like /?spot=<id> opens the map on that spot (with your spots shown).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("spot");
    if (id && /^[0-9a-f-]{36}$/.test(id)) setFocusSpot({ id, key: Date.now() });
  }, []);

  function startAdding(kind: SpotKind) {
    setAddOpen(false);
    if (!user || !profile) {
      rememberReturn("/");
      router.push(user ? "/me" : "/signin");
      return;
    }
    setAdding(kind);
  }

  async function added(id: string) {
    setAdding(null);
    layers.save({ ...layers.saved, mine: true });
    await layers.reload();
    setFullMap(true);
    setFocusSpot({ id, key: Date.now() });
  }
  const panel = useRef<HTMLElement>(null);
  const listScroll = useRef(0);
  const listBounds = useRef<Bounds | null>(null);

  useEffect(() => {
    // Revalidate every load so a data update never pairs with stale data.
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

  const byId = useMemo(() => new Map(roads.map((r) => [r.id, r])), [roads]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const origin: [number, number] = myLocation ?? region?.home ?? [0, 0];
  const originName = myLocation ? "you" : region?.home_name ?? "home";
  const scoreKey = badgeKey(filters.view);

  // Focus the map on a road opened from a shared link.
  const focusedInitial = useRef(false);
  useEffect(() => {
    if (focusedInitial.current || !selected) return;
    focusedInitial.current = true;
    setFocus({ bbox: selected.bbox, key: Date.now() });
  }, [selected]);

  const list = useMemo(
    () => (region ? applyFilters(roads, filters, origin, bounds) : []),
    // origin is derived from myLocation and region
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roads, filters, bounds, region, myLocation],
  );
  const mapRoads = useMemo(() => {
    if (!region) return [];
    const shown = applyFilters(roads, { ...filters, inView: false }, origin, null);
    if (selected && !shown.includes(selected)) shown.push(selected);
    return shown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roads, filters.view, filters.maxMiles, filters.minMiles, region, myLocation, selected]);

  const select = useCallback(
    (id: string) => {
      const r = byId.get(id);
      if (!r) return;
      if (!selectedId) {
        if (panel.current) listScroll.current = panel.current.scrollTop;
        listBounds.current = bounds;
      }
      setSelectedId(id);
      setFullMap(false);
      setFocus({ bbox: r.bbox, key: Date.now() });
      if (window.location.pathname !== `/road/${id}`) window.history.pushState(null, "", `/road/${id}`);
      if (panel.current) panel.current.scrollTop = 0;
    },
    [byId, selectedId, bounds],
  );

  const close = useCallback(() => {
    setSelectedId(null);
    // Go back to the map view the list had before the road was opened.
    const back = listBounds.current ?? region?.bbox;
    if (back) setFocus({ bbox: back, key: Date.now(), exact: true });
    if (window.location.pathname !== "/") window.history.pushState(null, "", "/");
    requestAnimationFrame(() => {
      if (panel.current) panel.current.scrollTop = listScroll.current;
    });
  }, [region]);

  useEffect(() => {
    const onPop = () => setSelectedId(roadIdFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedId) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, close]);

  function setView(view: View) {
    setFilters({ ...filters, view, sort: defaultSort(view) });
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

  if (loadError) return <p className="load-error">{loadError}</p>;

  return (
    <div className={`explorer${fullMap ? " full-map" : ""}`}>
      <section ref={panel} className="panel" aria-label={selected ? "Road details" : "Road list"}>
        {selected && region ? (
          <RoadDetail road={selected} units={region.units} origin={origin} originName={originName} onClose={close} />
        ) : (
          <>
            {region && (
              <FilterBar
                filters={filters}
                originName={originName}
                homeName={region.home_name}
                count={list.length}
                usingMyLocation={!!myLocation}
                locating={locating}
                locationError={locationError}
                onChange={setFilters}
                onView={setView}
                onUseMyLocation={locateMe}
                onClearMyLocation={() => setMyLocation(null)}
              />
            )}
            {region ? (
              <RoadList
                roads={list}
                view={filters.view}
                scoreKey={scoreKey}
                units={region.units}
                origin={origin}
                originName={originName}
                onSelect={select}
                onHover={setHoverId}
              />
            ) : (
              <p className="empty">Loading roads...</p>
            )}
          </>
        )}
      </section>
      <div className="map-wrap">
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
            layoutKey={fullMap ? "full" : "split"}
            spots={layers.spots}
            focusSpot={focusSpot}
            onSelect={select}
            onHover={setHoverId}
            onBounds={setBounds}
          />
        )}
        <button type="button" className="sat-toggle" aria-pressed={satellite} onClick={() => setSatellite(!satellite)}>
          {satellite ? "Map" : "Satellite"}
        </button>
        <SpotLayersControl groups={layers.groups} saved={layers.saved} save={layers.save} signedIn={layers.signedIn} />
        {region && !selected && (
          <RoadCards roads={list.slice(0, 15)} scoreKey={scoreKey} units={region.units} onSelect={select} onHover={setHoverId} />
        )}
        <div className={`map-actions${addOpen ? " open" : ""}`}>
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
          <button
            type="button"
            className="add-toggle"
            aria-expanded={addOpen}
            aria-label={addOpen ? "Close" : "Add a road or a place"}
            onClick={() => setAddOpen(!addOpen)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        <button
          type="button"
          className="full-toggle"
          aria-pressed={fullMap}
          aria-label={fullMap ? (selected ? "Show the road details" : "Show the list") : "Make the map full screen"}
          title={fullMap ? (selected ? "Show road" : "Show list") : "Full map"}
          onClick={() => setFullMap(!fullMap)}
        >
          {/* Up arrow grows the map; down arrow brings the list back. */}
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d={fullMap ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        </div>
        <div className="legend" aria-hidden="true">
          <span>{scoreKey === "overall" ? "Overall" : scoreKey === "scenic" ? "Scenic" : "Twisty"}</span>
          <span className="ramp" />
          <span className="ends"><span>35</span><span>80+</span></span>
        </div>
      </div>
      {adding && (
        <div className="add-sheet" role="dialog" aria-modal="true" aria-label={adding === "road" ? "Add a road" : "Add a place"}>
          <SpotEditor initialKind={adding} initialBbox={bounds} onSaved={added} onCancel={() => setAdding(null)} />
        </div>
      )}
    </div>
  );
}
