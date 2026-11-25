"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMapShell } from "@/lib/mapShell";
import { roadNames, roadsById } from "@/lib/roadData";
import { routeOnMap, stopFor } from "@/lib/dayRoute";

export interface Driven {
  road_id: string;
  driven_at: string;
}

const PAGE = 60;

/**
 * The Driven tab on a profile (11.88): roads their reviews say they drove,
 * newest first, and a way to see them on the map.
 */
export default function DrivenRoads({ driven, isMe, name }: { driven: Driven[]; isMe: boolean; name: string }) {
  const shell = useMapShell();
  const [shown, setShown] = useState(PAGE);
  const [names, setNames] = useState<Record<string, string>>({});
  const [onMap, setOnMap] = useState<"no" | "loading" | "yes">("no");

  useEffect(() => {
    const need = driven.slice(0, shown).map((d) => d.road_id).filter((id) => !names[id]);
    if (!need.length) return;
    roadNames(need).then((n) => setNames((x) => ({ ...x, ...n })));
    // When more rows show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driven, shown]);

  // A driven road tapped on the map opens that road.
  useEffect(() => {
    const id = shell?.selectedSpotId;
    if (id && driven.some((d) => d.road_id === id)) {
      shell!.closeSpot();
      shell!.selectRoad(id);
    }
    // When the tapped item changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell?.selectedSpotId]);

  if (!driven.length) {
    return (
      <p className="fine">
        {isMe
          ? "Roads you review with “I drove it” ticked show up here."
          : `No driven roads yet.`}
      </p>
    );
  }

  async function showOnMap() {
    if (!shell) return;
    setOnMap("loading");
    // The 40 most recent: each needs its road square.
    const roads = await roadsById(driven.slice(0, 40).map((d) => d.road_id));
    const list = Object.values(roads);
    shell.setOverlay({ title: `${name}'s driven roads`, spots: routeOnMap(list.map((r) => stopFor(r))) });
    setOnMap("yes");
  }

  return (
    <>
      <p className="fine">
        {driven.length} {driven.length === 1 ? "road" : "roads"} driven, from {isMe ? "your" : "their"} reviews.{" "}
        {shell && (
          <button type="button" className="link" onClick={showOnMap} disabled={onMap === "loading"}>
            {onMap === "loading" ? "Loading..." : onMap === "yes" ? "On the map" : "Show on the map"}
          </button>
        )}
      </p>
      <ul className="driven-roads">
        {driven.slice(0, shown).map((d) => (
          <li key={d.road_id}>
            <Link href={`/road/${d.road_id}`}>{names[d.road_id] ?? "A road"}</Link>
            <span className="fine">{new Date(d.driven_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
          </li>
        ))}
      </ul>
      {driven.length > shown && <button type="button" className="link" onClick={() => setShown(shown + PAGE)}>Show more</button>}
    </>
  );
}
