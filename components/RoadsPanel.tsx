"use client";

import { useEffect, useRef } from "react";
import FilterBar from "./FilterBar";
import RoadDetail from "./RoadDetail";
import RoadList from "./RoadList";
import SpotDetail from "./spots/SpotDetail";
import { useMapShell } from "@/lib/mapShell";
import { badgeKey } from "@/lib/roads";
import { decodePolyline } from "@/lib/polyline";
import { loadRoadChecks, withChecks } from "@/lib/roadData";
import type { Road } from "@/lib/types";

function roadIdFromPath(path: string): string | null {
  const m = path.match(/^\/road\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1] : null;
}

/** The home page's panel: filters and the list, or one road's details. */
export default function RoadsPanel({ initialRoadId, initialRoad }: { initialRoadId?: string; initialRoad?: Road }) {
  const shell = useMapShell()!;
  const opened = useRef(false);

  // A road opened from a link.
  useEffect(() => {
    if (opened.current || !initialRoadId) return;
    opened.current = true;
    if (initialRoad) {
      // The page comes from the data files; members' accepted checks (private,
      // gravel, paved...) are applied first, as on the map (11.78). The checks
      // load once per visit, and an empty set if they can't.
      loadRoadChecks().then((checks) => {
        shell.addRoad({ ...withChecks(initialRoad, checks.get(initialRoad.id)), coords: decodePolyline(initialRoad.line) });
      });
    } else shell.selectRoad(initialRoadId);
  }, [initialRoadId, initialRoad, shell]);

  // A link like /?spot=<id> opens the map on that spot.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("spot");
    if (id && /^[0-9a-f-]{36}$/.test(id)) shell.focusSpot(id);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phones start on the map, with the list a tap away.
  useEffect(() => {
    if (!initialRoadId) shell.setSheet("closed");
    shell.setPanelWide(false);
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attached once: Next.js re-renders during the back step, and a listener
  // swapped out mid-event would miss it. The ref always has the latest shell.
  const shellRef = useRef(shell);
  shellRef.current = shell;
  useEffect(() => {
    const onPop = () => {
      const sh = shellRef.current;
      const id = roadIdFromPath(window.location.pathname);
      const spot = new URLSearchParams(window.location.search).get("spot");
      if (id) sh.selectRoad(id);
      else if (spot && /^[0-9a-f-]{36}$/.test(spot)) sh.focusSpot(spot);
      else {
        sh.closeSpot();
        sh.closeRoad();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shell.selectedSpotId) shell.closeSpot();
      else if (e.key === "Escape" && shell.selectedId) shell.closeRoad();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shell]);

  if (!shell.region) return <p className="empty">Loading roads...</p>;
  if (shell.selectedSpot) {
    const sp = shell.selectedSpot;
    return (
      <SpotDetail spot={sp} road={shell.spotRoad(sp.id)} units={shell.region.units} origin={shell.origin}
        originName={shell.originName} onClose={shell.showAllRoads} />
    );
  }
  const selected = shell.selectedId ? shell.byId.get(shell.selectedId) ?? null : null;
  if (selected?.light) {
    // Its full square didn't load (weak signal): say so rather than show half a road (11.81).
    return (
      <div className="empty" role="alert">
        <p>Couldn&apos;t load {selected.name}. Check your connection and try again.</p>
        <p>
          <button type="button" className="chip" onClick={() => shell.selectRoad(selected.id)}>Try again</button>{" "}
          <button type="button" className="chip" onClick={shell.showAllRoads}>All roads</button>
        </p>
      </div>
    );
  }
  if (selected) {
    return <RoadDetail road={selected} units={shell.region.units} origin={shell.origin} originName={shell.originName} onClose={shell.showAllRoads} />;
  }
  return (
    <>
      <FilterBar />
      <RoadList
        items={shell.items}
        view={shell.filters.view}
        scoreKey={badgeKey(shell.filters.view)}
        units={shell.region.units}
        origin={shell.origin}
        originName={shell.originName}
        onSelect={shell.selectRoad}
        onSpot={shell.focusSpot}
        onHover={shell.setHoverId}
      />
    </>
  );
}
