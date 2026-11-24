"use client";

import { useState } from "react";
import { useMapShell } from "@/lib/mapShell";
import { defaultSort, SORTS, VIEWS, type SortKey, type View } from "@/lib/roads";
import { MAP_STYLES, type MapTheme } from "@/lib/mapThemes";

const DISTANCES = [null, 10, 25, 50, 100, 200];
const LENGTHS = [0, 3, 5, 10];

/**
 * What shows on the map, in the list, and in the cards: road views and spot
 * layers, then sort. Less-used settings tuck under "More options".
 */
export default function FilterBar() {
  const shell = useMapShell();
  const [more, setMore] = useState(false);
  if (!shell) return null;
  const f = shell.filters;
  const l = shell.layers;
  const setView = (view: View) => {
    shell.setShowRoads(true);
    shell.setFilters({ ...f, view, sort: f.sort === "distance" ? "distance" : defaultSort(view) });
  };
  const changed = [
    f.maxMiles !== null, f.minMiles > 0, !f.inView, shell.usingMyLocation, shell.satellite,
  ].filter(Boolean).length;

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

      <div className="sort-row">
        <label className="sort-select">
          <span>Sort</span>
          <select value={f.sort} onChange={(e) => shell.setFilters({ ...f, sort: e.target.value as SortKey })}>
            {SORTS.filter((s) => shell.showRoads || s.key === "distance").map((s) => (
              <option key={s.key} value={s.key}>{s.key === "distance" ? "Closest first" : s.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="chip" aria-expanded={more} aria-controls="more-options" onClick={() => setMore(!more)}>
          More options{changed ? ` (${changed})` : ""}
        </button>
      </div>

      {more && (
        <div id="more-options" className="more-options">
          <div className="option-selects">
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
            {shell.showRoads && (
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
          <div className="chips">
            <button type="button" className="chip" aria-pressed={f.inView} onClick={() => shell.setFilters({ ...f, inView: !f.inView })}>
              Only what&apos;s in the map view
            </button>
            <button type="button" className="chip" aria-pressed={shell.satellite} onClick={() => shell.setSatellite(!shell.satellite)}>
              Satellite map
            </button>
          </div>
          <div className="option-selects">
            <label>
              <span>Map style</span>
              <select value={shell.mapStyle} onChange={(e) => shell.setMapStyle(e.target.value as MapTheme)}>
                {MAP_STYLES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="chips">
            <button type="button" className="chip" disabled={shell.locating} onClick={shell.locateMe}>
              {shell.locating ? "Finding you..." : "Use my location"}
            </button>
            <button type="button" className="chip" aria-pressed={shell.settingLocation} onClick={() => shell.startSettingLocation()}>
              Set a location on the map
            </button>
            {shell.usingMyLocation && (
              <button type="button" className="chip" onClick={shell.clearMyLocation}>Measure from the map center</button>
            )}
          </div>
          <p className="fine">
            Distances are measured from {shell.originName}. Your location stays on this device and is never saved.
          </p>
          {shell.locationError && <p className="hint warn">{shell.locationError}</p>}
        </div>
      )}

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
