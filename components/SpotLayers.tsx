"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { getSupabase, type Group } from "@/lib/supabase";
import type { Spot } from "@/lib/spots";

const KEY = "sl-map-layers";

export interface LayerChoice {
  public: boolean;
  mine: boolean;
  /** Group IDs turned off (new groups show by default). */
  hidden: string[];
}

const DEFAULT: LayerChoice = { public: true, mine: true, hidden: [] };

function readSaved(): LayerChoice {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<LayerChoice> | null;
    if (s && typeof s.public === "boolean" && Array.isArray(s.hidden)) return { ...DEFAULT, ...s };
  } catch {
    // Storage blocked or bad value: use the defaults.
  }
  return DEFAULT;
}

/**
 * Which spots show on the main map: public ones, your own, your groups', or any
 * mix. Returns the spots to draw plus what the layer panel needs.
 */
export function useSpotLayers() {
  const { ready, user } = useAuth();
  const [publicSpots, setPublicSpots] = useState<Spot[]>([]);
  const [mySpots, setMySpots] = useState<Spot[]>([]);
  const [groupSpots, setGroupSpots] = useState<Spot[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [saved, setSaved] = useState<LayerChoice>(DEFAULT);

  useEffect(() => setSaved(readSaved()), []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("spots").select("*").eq("public_status", "approved").limit(3000)
      .then(({ data }) => setPublicSpots((data as Spot[] | null) ?? []));
  }, []);

  const loadMine = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user) {
      setGroups([]);
      setGroupSpots([]);
      setMySpots([]);
      return;
    }
    const [{ data: own }, { data: m }] = await Promise.all([
      sb.from("spots").select("*").eq("owner_id", user.id).limit(1000),
      sb.from("group_members").select("group:groups(*)").eq("user_id", user.id),
    ]);
    setMySpots((own as Spot[] | null) ?? []);
    const gs = ((m as unknown as { group: Group | null }[]) ?? []).flatMap((r) => (r.group ? [r.group] : []));
    if (!gs.length) {
      setGroups([]);
      setGroupSpots([]);
      return;
    }
    const { data } = await sb.from("spots").select("*").in("group_id", gs.map((g) => g.id)).eq("group_status", "accepted").limit(3000);
    const spots = (data as Spot[] | null) ?? [];
    const withSpots = new Set(spots.map((s) => s.group_id));
    setGroups(gs.filter((g) => withSpots.has(g.id)));
    setGroupSpots(spots);
  }, [user]);

  useEffect(() => {
    if (ready) loadMine();
  }, [ready, loadMine]);

  const save = useCallback((next: LayerChoice) => {
    setSaved(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not saved for next time; still applies now.
    }
  }, []);

  const names = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const spots = useMemo(() => {
    const shown: Spot[] = [];
    const seen = new Set<string>();
    const add = (s: Spot) => {
      if (seen.has(s.id)) return;
      seen.add(s.id);
      shown.push(s.group_id ? { ...s, group_name: names.get(s.group_id) ?? null } : s);
    };
    if (saved.mine) mySpots.forEach(add);
    for (const s of groupSpots) if (s.group_id && !saved.hidden.includes(s.group_id)) add(s);
    if (saved.public) publicSpots.forEach(add);
    return shown;
  }, [mySpots, groupSpots, publicSpots, saved, names]);

  return { spots, groups, saved, save, reload: loadMine, signedIn: !!user };
}

export function SpotLayersControl({ groups, saved, save, signedIn }: {
  groups: Group[];
  saved: LayerChoice;
  save: (s: LayerChoice) => void;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const only = (c: Partial<LayerChoice>) => save({ public: false, mine: false, hidden: groups.map((g) => g.id), ...c });
  return (
    <div className="layers">
      <button type="button" className="layers-toggle" aria-expanded={open} aria-controls="layers-panel" onClick={() => setOpen(!open)}>
        Spots
      </button>
      {open && (
        <div id="layers-panel" className="layers-panel" role="group" aria-label="Spots on the map">
          {signedIn && (
            <label className="check">
              <input type="checkbox" checked={saved.mine} onChange={(e) => save({ ...saved, mine: e.target.checked })} />
              <span>My spots</span>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={saved.public} onChange={(e) => save({ ...saved, public: e.target.checked })} />
            <span>Public spots</span>
          </label>
          {groups.length > 0 && <p className="fine">Your groups</p>}
          {groups.map((g) => (
            <label key={g.id} className="check">
              <input
                type="checkbox"
                checked={!saved.hidden.includes(g.id)}
                onChange={(e) =>
                  save({ ...saved, hidden: e.target.checked ? saved.hidden.filter((x) => x !== g.id) : [...saved.hidden, g.id] })
                }
              />
              <span>{g.name}</span>
            </label>
          ))}
          {signedIn && (
            <div className="row">
              <button type="button" className="link" onClick={() => only({ mine: true })}>Only mine</button>
              {groups.length > 0 && <button type="button" className="link" onClick={() => only({ hidden: [] })}>Only groups</button>}
              <button type="button" className="link" onClick={() => only({ public: true })}>Only public</button>
              <button type="button" className="link" onClick={() => save(DEFAULT)}>All</button>
            </div>
          )}
          {!signedIn && <p className="fine">Sign in to see your own and your groups&apos; spots.</p>}
        </div>
      )}
    </div>
  );
}
