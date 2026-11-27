"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePageOnMap } from "@/lib/usePageOnMap";
import { bestOrder, getRoute, getStopsPerRoad, googleParts, moveStop, routeMiles, routeOnMap, setRoute, setStopsPerRoad, type RouteStop, type StopsPerRoad } from "@/lib/dayRoute";
import { keepOffline, isKept, offlineSupported } from "@/lib/offline";
import { loadCell } from "@/lib/roadData";

/**
 * The day route (11.85): the roads picked for a day, in order, with one set of
 * directions for your own maps app. Kept on this device.
 */
export default function DayRoute() {
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [canKeep, setCanKeep] = useState(false);
  const [per, setPer] = useState<StopsPerRoad>("one");
  const onMap = useMemo(() => routeOnMap(stops), [stops]);
  const shell = usePageOnMap(stops.length ? "Day route" : null, stops.length ? onMap : null);

  useEffect(() => {
    const update = () => setStops(getRoute());
    update();
    setCanKeep(offlineSupported());
    setPer(getStopsPerRoad());
    window.addEventListener("sl-route", update);
    return () => window.removeEventListener("sl-route", update);
  }, []);

  // A route road tapped on the map opens that road.
  useEffect(() => {
    const id = shell?.selectedSpotId;
    if (id && stops.some((s) => s.id === id)) {
      shell!.closeSpot();
      shell!.selectRoad(id);
    }
    // When the tapped item changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell?.selectedSpotId]);

  const save = (list: RouteStop[]) => {
    setStops(list);
    setRoute(list);
  };
  const miles = routeMiles(stops);
  const parts = googleParts(stops, null, per);

  async function keepAll() {
    for (const s of stops) {
      if (isKept(s.id) || !s.cell) continue;
      setSaving(`Saving ${s.name} for offline...`);
      try {
        const road = (await loadCell(s.cell)).find((r) => r.id === s.id);
        if (road) await keepOffline(road, () => {});
      } catch {
        setSaving(`Couldn't save ${s.name}. Check your connection and try again.`);
        return;
      }
    }
    setSaving("Every road on the route is kept on this device.");
  }

  return (
    <div className="page narrow day-route">
      <h1>Day route</h1>
      {stops.length === 0 ? (
        <>
          <p>
            Pick roads for a day of driving: on any road, tap <b>Add to day route</b>. They line up here in a short
            order, with directions for your own maps app.
          </p>
          <p><Link href="/">Find roads</Link></p>
        </>
      ) : (
        <>
          <p className="fine">
            {stops.length} {stops.length === 1 ? "road" : "roads"}, {Math.round(miles.roads)} mi on them
            {stops.length > 1 && `, about ${Math.round(miles.between)} mi apart in a straight line (more by road)`}.
            Plan it before you go.
          </p>
          <ol className="route-stops">
            {stops.map((s, i) => (
              <li key={s.id}>
                <span className="route-num" aria-hidden="true">{i + 1}</span>
                <button type="button" className="route-name" onClick={() => shell?.selectRoad(s.id)}>
                  <b>{s.name}</b>
                  <span className="fine">
                    {[s.near && `Near ${s.near}`, s.state, `${s.miles.toFixed(1)} mi`, s.reversed ? "driven end to start" : null].filter(Boolean).join(" · ")}
                  </span>
                </button>
                <span className="route-tools">
                  <button type="button" className="link" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => save(moveStop(stops, i, -1))}>&uarr;</button>
                  <button type="button" className="link" aria-label={`Move ${s.name} down`} disabled={i === stops.length - 1} onClick={() => save(moveStop(stops, i, 1))}>&darr;</button>
                  <button type="button" className="link" aria-label={`Drive ${s.name} the other way`} onClick={() => save(stops.map((x, k) => (k === i ? { ...x, reversed: !x.reversed } : x)))}>&#8644;</button>
                  <button type="button" className="link danger" aria-label={`Remove ${s.name}`} onClick={() => save(stops.filter((x) => x.id !== s.id))}>&times;</button>
                </span>
              </li>
            ))}
          </ol>
          <p className="route-actions">
            <button type="button" className="link" onClick={() => save(bestOrder(stops, shell?.usingMyLocation ? shell.origin : null))}>
              Shortest order{shell?.usingMyLocation ? ` from ${shell.originName}` : ""}
            </button>
            {canKeep && <button type="button" className="link" onClick={keepAll}>Keep all offline</button>}
            <button type="button" className="link danger" onClick={() => window.confirm("Clear the whole day route?") && save([])}>Clear the route</button>
          </p>
          {saving && <p className="fine" role="status">{saving}</p>}
          <section className="go" aria-label="Directions">
            <h2>Directions</h2>
            <div className="seg" role="group" aria-label="Stops in Google Maps">
              {([["one", "One stop a road"], ["ends", "Both ends"]] as [StopsPerRoad, string][]).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={per === k} onClick={() => { setPer(k); setStopsPerRoad(k); }}>{label}</button>
              ))}
            </div>
            <p className="fine">
              {per === "one"
                ? "One stop halfway along each road, ending at the far end of the last one. Fewer stops to clear along the way; Google picks how to get on and off each road."
                : "Each road's two ends as stops, so every road is driven end to end. Twice as many stops to clear."}
              {" "}Starts from wherever you are.
              {parts.length > 1 && ` One link holds ${per === "one" ? "nine roads" : "five roads"}, so the route comes in parts.`}
            </p>
            <p className="go-links route-go">
              {parts.map((p) => (
                <a key={p.href} href={p.href} target="_blank" rel="noopener noreferrer">Google Maps: {p.label}</a>
              ))}
            </p>
            <p className="fine">Apple Maps and Waze take one stop at a time: open a road for its own directions.</p>
          </section>
        </>
      )}
    </div>
  );
}
