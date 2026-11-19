"use client";

import { useEffect, useRef } from "react";
import FilterBar from "./FilterBar";
import RoadDetail from "./RoadDetail";
import RoadList from "./RoadList";
import { useMapShell } from "@/lib/mapShell";
import { badgeKey } from "@/lib/roads";

function roadIdFromPath(path: string): string | null {
  const m = path.match(/^\/road\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1] : null;
}

/** The home page's panel: filters and the list, or one road's details. */
export default function RoadsPanel({ initialRoadId }: { initialRoadId?: string }) {
  const shell = useMapShell()!;
  const opened = useRef(false);

  // A road opened from a link.
  useEffect(() => {
    if (opened.current || !initialRoadId || !shell.byId.size) return;
    opened.current = true;
    shell.selectRoad(initialRoadId);
  }, [initialRoadId, shell]);

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

  useEffect(() => {
    const onPop = () => {
      const id = roadIdFromPath(window.location.pathname);
      if (id) shell.selectRoad(id);
      else shell.closeRoad();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [shell]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shell.selectedId) shell.closeRoad();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shell]);

  if (!shell.region) return <p className="empty">Loading roads...</p>;
  const selected = shell.selectedId ? shell.byId.get(shell.selectedId) ?? null : null;
  if (selected) {
    return <RoadDetail road={selected} units={shell.region.units} origin={shell.origin} originName={shell.originName} onClose={shell.closeRoad} />;
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
