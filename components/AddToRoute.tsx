"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addToRoute, getRoute, inRoute, MAX_STOPS, removeFromRoute } from "@/lib/dayRoute";
import type { RoadOnMap } from "@/lib/roadData";

/** "Add to day route" on a road's page (11.85). */
export default function AddToRoute({ road }: { road: RoadOnMap }) {
  const [added, setAdded] = useState(false);
  const [count, setCount] = useState(0);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const update = () => {
      setAdded(inRoute(road.id));
      setCount(getRoute().length);
    };
    update();
    setFull(false);
    window.addEventListener("sl-route", update);
    return () => window.removeEventListener("sl-route", update);
  }, [road.id]);
  if (road.light) return null;
  return (
    <p className="go-extra route-add">
      <button type="button" className="link" aria-pressed={added}
        onClick={() => (added ? removeFromRoute(road.id) : setFull(!addToRoute(road)))}>
        {added ? "In your day route (remove)" : "Add to day route"}
      </button>
      {count > 0 && <Link href="/route">Day route ({count})</Link>}
      {full && <span className="fine">A day route holds {MAX_STOPS} roads.</span>}
    </p>
  );
}
