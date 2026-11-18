"use client";

import { SORTS, VIEWS, type Filters, type SortKey, type View } from "@/lib/roads";

interface Props {
  filters: Filters;
  originName: string;
  homeName: string;
  count: number;
  usingMyLocation: boolean;
  locating: boolean;
  locationError: string | null;
  onChange: (f: Filters) => void;
  onView: (v: View) => void;
  onUseMyLocation: () => void;
  onClearMyLocation: () => void;
}

const DISTANCES = [null, 25, 50, 75, 100, 150];
const LENGTHS = [0, 3, 5, 10];

export default function FilterBar(p: Props) {
  const f = p.filters;
  const hint = VIEWS.find((v) => v.key === f.view)?.hint;
  return (
    <div className="filters">
      <div className="views" role="group" aria-label="Which roads">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" aria-pressed={f.view === v.key} onClick={() => p.onView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <p className="hint">{hint}</p>
      <div className="controls">
        <label>
          <span>Sort</span>
          <select value={f.sort} onChange={(e) => p.onChange({ ...f, sort: e.target.value as SortKey })}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Distance from {p.originName}</span>
          <select
            value={f.maxMiles ?? "any"}
            onChange={(e) => p.onChange({ ...f, maxMiles: e.target.value === "any" ? null : Number(e.target.value) })}
          >
            {DISTANCES.map((d) => (
              <option key={d ?? "any"} value={d ?? "any"}>{d === null ? "Any distance" : `Within ${d} mi`}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Length</span>
          <select value={f.minMiles} onChange={(e) => p.onChange({ ...f, minMiles: Number(e.target.value) })}>
            {LENGTHS.map((l) => (
              <option key={l} value={l}>{l === 0 ? "Any length" : `${l} mi or more`}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="controls secondary">
        <label className="check">
          <input type="checkbox" checked={f.inView} onChange={(e) => p.onChange({ ...f, inView: e.target.checked })} />
          <span>Only roads in the map view</span>
        </label>
        {p.usingMyLocation ? (
          <button type="button" className="link" onClick={p.onClearMyLocation}>Measure from {p.homeName} instead</button>
        ) : (
          <button type="button" className="link" onClick={p.onUseMyLocation} disabled={p.locating}>
            {p.locating ? "Finding you..." : "Measure from my location"}
          </button>
        )}
      </div>
      {p.locationError && <p className="hint warn">{p.locationError}</p>}
      <p className="count" aria-live="polite">
        {p.count} {p.count === 1 ? "road" : "roads"}{f.inView ? " in view" : ""}
      </p>
    </div>
  );
}
