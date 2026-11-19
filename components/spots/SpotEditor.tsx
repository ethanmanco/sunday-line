"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { decodePolyline } from "@/lib/polyline";
import { getSupabase } from "@/lib/supabase";
import {
  CATEGORY_LABEL, encodePolyline, lineMiles, loadRoads, ROAD_REGION, simplifyLine, sliceLine,
  type Spot, type SpotCategory, type SpotKind,
} from "@/lib/spots";
import type { TracedRoad } from "@/lib/traceRoad";
import { useMapShell } from "@/lib/mapShell";
import type { LoadedRoad } from "@/lib/types";

const SpotMap = dynamic(() => import("./SpotMap"), { ssr: false, loading: () => <div className="spot-map map-loading" /> });

type LL = [number, number];
/** Where a road spot's line comes from. */
type RoadSource =
  | { from: "suggested"; id: string }
  | { from: "traced"; name: string | null; coords: LL[] }
  | null;

/**
 * Add or edit a spot: a place, or a road. Roads can be one of our suggested
 * roads, any other road on the map (traced from the base map), or drawn by
 * tapping points. Suggested and traced roads can be trimmed with a start and end.
 */
export default function SpotEditor({ groupId = null, spot = null, groupName, initialKind, initialBbox, onSaved, onCancel }: {
  groupId?: string | null;
  spot?: Spot | null;
  groupName?: string;
  /** Start as a place or a road (from the map's add button). */
  initialKind?: SpotKind;
  /** Start the map here (the view the person was looking at). */
  initialBbox?: [number, number, number, number] | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const custom = spot?.kind === "road" && !spot.road_id && spot.line ? decodePolyline(spot.line) : null;
  const [kind, setKind] = useState<SpotKind>(spot?.kind ?? initialKind ?? "point");
  const [drawing, setDrawing] = useState(!!custom);
  const [category, setCategory] = useState<SpotCategory>(spot?.category ?? "meetup");
  const [name, setName] = useState(spot?.name ?? "");
  const [description, setDescription] = useState(spot?.description ?? "");
  const [pin, setPin] = useState<LL | null>(spot?.kind === "point" ? [spot.lng, spot.lat] : null);
  const [source, setSource] = useState<RoadSource>(spot?.road_id ? { from: "suggested", id: spot.road_id } : null);
  const [points, setPoints] = useState<LL[]>(custom ?? []);
  const [whole, setWhole] = useState(spot ? spot.start_frac === null && spot.end_frac === null : true);
  const [start, setStart] = useState(Math.round((spot?.start_frac ?? 0) * 100));
  const [end, setEnd] = useState(Math.round((spot?.end_frac ?? 1) * 100));
  const [onProfile, setOnProfile] = useState(spot?.show_on_profile ?? false);
  const [data, setData] = useState<{ bbox: [number, number, number, number]; roads: LoadedRoad[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState("start");
  // On the shared map (home, profiles, groups), the editor drives that map
  // instead of drawing its own.
  const shell = useMapShell();

  useEffect(() => {
    if (shell?.region && shell.roads.length) {
      setData({ bbox: shell.region.bbox, roads: shell.roads });
      return;
    }
    loadRoads().then(setData).catch(() => setError("The road map didn't load. Check your connection."));
  }, [shell?.region, shell?.roads]);

  const suggested = useMemo(
    () => (source?.from === "suggested" ? data?.roads.find((r) => r.id === source.id) ?? null : null),
    [data, source],
  );
  /** The full line of the chosen road, before trimming. */
  const baseLine: LL[] | null = suggested ? suggested.coords : source?.from === "traced" ? source.coords : null;
  const roadName = suggested ? suggested.name : source?.from === "traced" ? source.name : null;

  const segment = useMemo((): LL[] | null => {
    if (kind !== "road") return null;
    if (drawing) return points.length > 1 ? points : null;
    if (!baseLine) return null;
    return whole ? baseLine : sliceLine(baseLine, start / 100, end / 100);
  }, [kind, drawing, points, baseLine, whole, start, end]);

  const mapModeNow = kind === "point" ? "point" : drawing ? "draw" : "road";
  const shownPin = kind === "point" ? pin : null;
  const shownVertices = useMemo(() => (drawing ? points : []), [drawing, points]);
  const selectedRoadId = source?.from === "suggested" ? source.id : null;
  useEffect(() => {
    if (!shell) return;
    shell.setPick(
      { mode: mapModeNow, pin: shownPin, segment, vertices: shownVertices, selectedRoadId },
      {
        onPickPoint: (ll) => (drawing ? setPoints((p) => (p.length < 500 ? [...p, ll] : p)) : setPin(ll)),
        onPickRoad: (id) => pickSuggestedRef.current(id),
        onTraceRoad: (t) => pickTracedRef.current(t),
      },
    );
    // Only when what the map shows changes (setPick itself never changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell?.setPick, mapModeNow, shownPin, segment, shownVertices, selectedRoadId, drawing]);
  const setPickFn = shell?.setPick;
  useEffect(() => () => setPickFn?.(null), [setPickFn]);
  // Zoom the shared map to a chosen road.
  useEffect(() => {
    if (!shell || !fitKey.startsWith("road-") || !segment || segment.length < 2) return;
    const xs = segment.map((c) => c[0]);
    const ys = segment.map((c) => c[1]);
    shell.fitTo([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    // Only when a new road is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  function chooseLine(next: RoadSource, newName: string | null) {
    const oldName = roadName;
    setSource(next);
    setWhole(true);
    setStart(0);
    setEnd(100);
    setError(null);
    if (newName && (!name.trim() || name === oldName)) setName(newName.slice(0, 60));
    // Zoom to the chosen road so its start and end are easy to set.
    setFitKey(`road-${Date.now()}`);
  }

  function pickSuggested(id: string) {
    const r = data?.roads.find((x) => x.id === id);
    chooseLine({ from: "suggested", id }, r?.name ?? null);
  }

  function pickTraced(t: TracedRoad) {
    chooseLine({ from: "traced", name: t.name, coords: t.coords }, t.name);
  }
  // The shared map calls these; keep them pointing at the latest state.
  const pickSuggestedRef = useRef(pickSuggested);
  const pickTracedRef = useRef(pickTraced);
  pickSuggestedRef.current = pickSuggested;
  pickTracedRef.current = pickTraced;

  function setMode(next: SpotKind, draw = false) {
    setKind(next);
    setDrawing(draw);
    setError(null);
    setFitKey(`k${Date.now()}`);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setError(null);
    let row: Record<string, unknown>;
    if (kind === "point") {
      if (!pin) return setError("Tap the map to place the spot.");
      row = { kind, category, lat: pin[1], lng: pin[0], road_id: null, road_region: null, start_frac: null, end_frac: null, line: null };
    } else {
      if (!segment || segment.length < 2) {
        return setError(drawing ? "Tap at least two points along the road." : "Tap a road on the map.");
      }
      if (!drawing && !whole && end - start < 1) return setError("Move the end past the start.");
      const keepsId = !drawing && source?.from === "suggested";
      row = {
        kind,
        category: null,
        lat: segment[0][1],
        lng: segment[0][0],
        road_id: keepsId ? source.id : null,
        road_region: keepsId ? ROAD_REGION : null,
        start_frac: keepsId && !whole ? start / 100 : null,
        end_frac: keepsId && !whole ? end / 100 : null,
        line: encodePolyline(simplifyLine(segment)),
      };
    }
    row = { ...row, name: name.trim(), description: description.trim() || null, show_on_profile: onProfile };
    setBusy(true);
    const res = spot
      ? await sb.from("spots").update(row).eq("id", spot.id).select("id").single()
      : await sb.from("spots").insert({ ...row, group_id: groupId }).select("id").single();
    setBusy(false);
    if (res.error) {
      setError(
        res.error.message.includes("Limit") ? "That's the limit of 500 spots."
          : res.error.message.includes("line") ? "That road is too long to save. Trim it or draw a shorter stretch."
            : "Couldn't save. Names are 2 to 60 characters.",
      );
      return;
    }
    onSaved((res.data as { id: string }).id);
  }

  const mapMode = kind === "point" ? "point" : drawing ? "draw" : "road";
  let hint: string;
  if (kind === "point") hint = pin ? "Pin placed. Tap again to move it." : "Tap the map where the spot is.";
  else if (drawing) {
    hint = points.length === 0
      ? "Tap along the road, start to end. Zoom in for curves; each tap adds a point."
      : `${points.length} ${points.length === 1 ? "point" : "points"}, ${lineMiles(points).toFixed(1)} mi. Keep tapping, or save.`;
  } else if (baseLine) {
    hint = `${roadName ?? "Unnamed road"}: ${lineMiles(segment ?? baseLine).toFixed(1)} mi selected.${source?.from === "suggested" ? " (a suggested road)" : ""} Tap another road to switch.`;
  } else hint = "Zoom in, then tap any road. Suggested roads are the gray lines, but any road on the map works.";

  return (
    <form onSubmit={save} className="form spot-editor">
      <h3>{spot ? "Edit spot" : groupName ? `Add a spot to ${groupName}` : "Add a spot"}</h3>
      <fieldset>
        <legend>What is it</legend>
        <div className="seg">
          <button type="button" aria-pressed={kind === "point"} onClick={() => setMode("point")}>A place</button>
          <button type="button" aria-pressed={kind === "road" && !drawing} onClick={() => setMode("road")}>A road</button>
          <button type="button" aria-pressed={kind === "road" && drawing} onClick={() => setMode("road", true)}>Draw a road</button>
        </div>
      </fieldset>
      {kind === "point" && (
        <fieldset>
          <legend>Kind of place</legend>
          <div className="seg">
            {(Object.keys(CATEGORY_LABEL) as SpotCategory[]).map((c) => (
              <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}>{CATEGORY_LABEL[c]}</button>
            ))}
          </div>
        </fieldset>
      )}

      <p className="fine map-hint" aria-live="polite">{hint}</p>
      {shell ? null : data ? (
        <SpotMap
          spots={[]}
          fallbackBbox={initialBbox ?? data.bbox}
          mode={mapMode}
          roads={data.roads}
          selectedRoadId={source?.from === "suggested" ? source.id : null}
          segment={segment}
          vertices={drawing ? points : []}
          pin={kind === "point" ? pin : null}
          fitKey={fitKey}
          className="editor"
          onPickPoint={(ll) => (drawing ? setPoints((p) => (p.length < 500 ? [...p, ll] : p)) : setPin(ll))}
          onPickRoad={pickSuggested}
          onTraceRoad={pickTraced}
        />
      ) : (
        <div className="spot-map editor map-loading" />
      )}

      {kind === "road" && drawing && (
        <div className="row">
          <button type="button" className="button ghost small" disabled={!points.length} onClick={() => setPoints((p) => p.slice(0, -1))}>Undo last point</button>
          <button type="button" className="button ghost small" disabled={!points.length} onClick={() => setPoints([])}>Start over</button>
        </div>
      )}
      {kind === "road" && !drawing && baseLine && (
        <fieldset className="stretch">
          <label className="check">
            <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
            <span>{source?.from === "traced" ? "All of it (as traced)" : "The whole road"}</span>
          </label>
          {!whole && (
            <>
              <label>
                <span>Start: {start}% along</span>
                <input type="range" min={0} max={99} value={start} onChange={(e) => setStart(Math.min(Number(e.target.value), end - 1))} />
              </label>
              <label>
                <span>End: {end}% along</span>
                <input type="range" min={1} max={100} value={end} onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 1))} />
              </label>
            </>
          )}
          {source?.from === "traced" && (
            <span className="fine">
              Traced from the map as far as it&apos;s loaded. Zoom out to fit the whole road and tap it again to trace more, or use Draw a road.
            </span>
          )}
        </fieldset>
      )}

      <label>
        <span>Name</span>
        <input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)}
          placeholder={kind === "road" ? "Old Mooringsport Road" : "Sunday coffee lot"} />
      </label>
      <label>
        <span>Notes (optional)</span>
        <textarea maxLength={500} rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={kind === "road" ? "Best direction, rough spots" : "Where to park, hours"} />
      </label>
      <label className="check">
        <input type="checkbox" checked={onProfile} onChange={(e) => setOnProfile(e.target.checked)} />
        <span>Show on my profile (when your profile is set to show spots you pick)</span>
      </label>
      {groupId && !spot && <p className="fine">Group spots are seen by group members only. Group managers may need to accept it first.</p>}
      <div className="row">
        <button type="submit" className="button" disabled={busy}>{busy ? "Saving..." : "Save spot"}</button>
        <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="hint warn" role="alert">{error}</p>}
    </form>
  );
}
