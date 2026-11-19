"use client";

import { useMapShell } from "@/lib/mapShell";
import { defaultSort, SORTS, VIEWS, type SortKey, type View } from "@/lib/roads";

const DISTANCES = [null, 25, 50, 75, 100, 150];
const LENGTHS = [0, 3, 5, 10];

/**
 * What shows on the map, in the list, and in the cards: road views and spot
 * layers together, then sort and distance.
 */
export default function FilterBar() {
  const shell = useMapShell();
  if (!shell) return null;
  const f = shell.filters;
  const l = shell.layers;
  const setView = (view: View) => {
    shell.setShowRoads(true);
    shell.setFilters({ ...f, view, sort: f.sort === "distance" ? "distance" : defaultSort(view) });
  };
  const roadsOnly = shell.showRoads;

  return (
    <div className="filters">
      <div className="show-group" role="group" aria-label="Roads">
        <span className="show-label">Roads</span>
        <div className="chips">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" className="chip" aria-pressed={shell.showRoads && f.view === v.key} title={v.hint} onClick={() => setView(v.key)}>
              {v.label}
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={!shell.showRoads} onClick={() => shell.setShowRoads(false)}>Off</button>
        </div>
      </div>
      <div className="show-group" role="group" aria-label="Spots">
        <span className="show-label">Spots</span>
        <div className="chips">
          {shell.signedIn && (
            <button type="button" className="chip" aria-pressed={l.mine} onClick={() => shell.saveLayers({ ...l, mine: !l.mine })}>Mine</button>
          )}
          <button type="button" className="chip" aria-pressed={l.public} onClick={() => shell.saveLayers({ ...l, public: !l.public })}>Public</button>
          {shell.spotGroups.map((g) => {
            const on = !l.hidden.includes(g.id);
            return (
              <button key={g.id} type="button" className="chip" aria-pressed={on}
                onClick={() => shell.saveLayers({ ...l, hidden: on ? [...l.hidden, g.id] : l.hidden.filter((x) => x !== g.id) })}>
                {g.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="controls">
        <label>
          <span>Sort</span>
          <select value={f.sort} onChange={(e) => shell.setFilters({ ...f, sort: e.target.value as SortKey })}>
            {SORTS.filter((s) => roadsOnly || s.key === "distance").map((s) => (
              <option key={s.key} value={s.key}>{s.key === "distance" ? "Closest first" : s.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Distance from {shell.originName}</span>
          <select
            value={f.maxMiles ?? "any"}
            onChange={(e) => shell.setFilters({ ...f, maxMiles: e.target.value === "any" ? null : Number(e.target.value) })}
          >
            {DISTANCES.map((d) => (
              <option key={d ?? "any"} value={d ?? "any"}>{d === null ? "Any distance" : `Within ${d} mi`}</option>
            ))}
          </select>
        </label>
        {roadsOnly && (
          <label>
            <span>Road length</span>
            <select value={f.minMiles} onChange={(e) => shell.setFilters({ ...f, minMiles: Number(e.target.value) })}>
              {LENGTHS.map((x) => (
                <option key={x} value={x}>{x === 0 ? "Any length" : `${x} mi or more`}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="controls secondary">
        <button type="button" className="chip" aria-pressed={f.inView} onClick={() => shell.setFilters({ ...f, inView: !f.inView })}>
          Only what&apos;s in the map view
        </button>
        {shell.usingMyLocation ? (
          <button type="button" className="chip" aria-pressed onClick={shell.clearMyLocation}>Measuring from you</button>
        ) : (
          <button type="button" className="chip" onClick={shell.locateMe} disabled={shell.locating}>
            {shell.locating ? "Finding you..." : `Measure from my location`}
          </button>
        )}
      </div>
      {shell.locationError && <p className="hint warn">{shell.locationError}</p>}
      <p className="count" aria-live="polite">
        {[
          shell.showRoads ? `${shell.roadCount} ${shell.roadCount === 1 ? "road" : "roads"}` : null,
          `${shell.spotCount} ${shell.spotCount === 1 ? "spot" : "spots"}`,
        ].filter(Boolean).join(" and ")}
        {f.inView ? " in view" : ""}
      </p>
    </div>
  );
}
