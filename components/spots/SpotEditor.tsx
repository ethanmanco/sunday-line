"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getSupabase } from "@/lib/supabase";
import {
  CATEGORY_LABEL, encodePolyline, lineMiles, loadRoads, ROAD_REGION, sliceLine,
  type Spot, type SpotCategory, type SpotKind,
} from "@/lib/spots";
import type { LoadedRoad } from "@/lib/types";

const SpotMap = dynamic(() => import("./SpotMap"), { ssr: false, loading: () => <div className="spot-map map-loading" /> });

/** Add or edit a spot: a point, or a road (whole, or from a start to an end). */
export default function SpotEditor({ groupId = null, spot = null, groupName, onSaved, onCancel }: {
  groupId?: string | null;
  spot?: Spot | null;
  groupName?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<SpotKind>(spot?.kind ?? "point");
  const [category, setCategory] = useState<SpotCategory>(spot?.category ?? "meetup");
  const [name, setName] = useState(spot?.name ?? "");
  const [description, setDescription] = useState(spot?.description ?? "");
  const [pin, setPin] = useState<[number, number] | null>(spot?.kind === "point" ? [spot.lng, spot.lat] : null);
  const [roadId, setRoadId] = useState<string | null>(spot?.road_id ?? null);
  const [whole, setWhole] = useState(spot ? spot.start_frac === null && spot.end_frac === null : true);
  const [start, setStart] = useState(Math.round((spot?.start_frac ?? 0) * 100));
  const [end, setEnd] = useState(Math.round((spot?.end_frac ?? 1) * 100));
  const [onProfile, setOnProfile] = useState(spot?.show_on_profile ?? false);
  const [data, setData] = useState<{ bbox: [number, number, number, number]; roads: LoadedRoad[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState("start");

  useEffect(() => {
    loadRoads().then(setData).catch(() => setError("The road map didn't load. Check your connection."));
  }, []);

  const road = useMemo(() => data?.roads.find((r) => r.id === roadId) ?? null, [data, roadId]);
  const segment = useMemo(() => {
    if (kind !== "road" || !road) return null;
    return whole ? road.coords : sliceLine(road.coords, start / 100, end / 100);
  }, [kind, road, whole, start, end]);

  function pickRoad(id: string) {
    setRoadId(id);
    setWhole(true);
    setStart(0);
    setEnd(100);
    const r = data?.roads.find((x) => x.id === id);
    if (r && (!name.trim() || name === road?.name)) setName(r.name.slice(0, 60));
    // Zoom to the chosen road so its start and end are easy to set.
    setFitKey(`road-${id}`);
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
      if (!road || !segment || segment.length < 2) return setError("Tap a road on the map.");
      if (!whole && end - start < 1) return setError("Move the end past the start.");
      row = {
        kind,
        category: null,
        lat: segment[0][1],
        lng: segment[0][0],
        road_id: road.id,
        road_region: ROAD_REGION,
        start_frac: whole ? null : start / 100,
        end_frac: whole ? null : end / 100,
        line: encodePolyline(segment),
      };
    }
    row = { ...row, name: name.trim(), description: description.trim() || null, show_on_profile: onProfile };
    setBusy(true);
    const res = spot
      ? await sb.from("spots").update(row).eq("id", spot.id)
      : await sb.from("spots").insert({ ...row, group_id: groupId });
    setBusy(false);
    if (res.error) {
      setError(res.error.message.includes("Limit") ? "That's the limit of 500 spots." : "Couldn't save. Names are 2 to 60 characters.");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={save} className="form spot-editor">
      <h3>{spot ? "Edit spot" : groupName ? `Add a spot to ${groupName}` : "Add a spot"}</h3>
      <fieldset>
        <legend>What is it</legend>
        <div className="seg">
          <button type="button" aria-pressed={kind === "point"} onClick={() => { setKind("point"); setFitKey(`k${Date.now()}`); }}>A place</button>
          <button type="button" aria-pressed={kind === "road"} onClick={() => { setKind("road"); setFitKey(`k${Date.now()}`); }}>A road</button>
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

      <p className="fine map-hint" aria-live="polite">
        {kind === "point"
          ? pin ? "Pin placed. Tap again to move it." : "Tap the map where the spot is."
          : road ? `${road.name}: ${lineMiles(segment ?? road.coords).toFixed(1)} mi selected. Tap another road to switch.` : "Zoom in, then tap a road (the gray lines)."}
      </p>
      {data ? (
        <SpotMap
          spots={[]}
          fallbackBbox={data.bbox}
          mode={kind}
          roads={data.roads}
          selectedRoadId={roadId}
          segment={segment}
          pin={kind === "point" ? pin : null}
          fitKey={fitKey}
          className="editor"
          onPickPoint={setPin}
          onPickRoad={pickRoad}
        />
      ) : (
        <div className="spot-map editor map-loading" />
      )}

      {kind === "road" && road && (
        <fieldset className="stretch">
          <label className="check">
            <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
            <span>The whole road</span>
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
