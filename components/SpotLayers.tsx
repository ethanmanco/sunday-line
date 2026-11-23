"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { getSupabase, type Group } from "@/lib/supabase";
import { groupColor, MINE_COLOR, PUBLIC_COLOR, type Spot } from "@/lib/spots";

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
    const { data } = await sb.from("spot_groups").select("group_id, spot:spots(*)")
      .in("group_id", gs.map((g) => g.id)).eq("status", "accepted").limit(5000);
    // One spot can be in several groups: keep it once, with all its groups.
    const byId = new Map<string, Spot>();
    const withSpots = new Set<string>();
    for (const r of (data as unknown as { group_id: string; spot: Spot | null }[] | null) ?? []) {
      if (!r.spot) continue;
      withSpots.add(r.group_id);
      const s = byId.get(r.spot.id) ?? { ...r.spot, group_ids: [] };
      s.group_ids!.push(r.group_id);
      byId.set(s.id, s);
    }
    setGroups(gs.filter((g) => withSpots.has(g.id)));
    setGroupSpots([...byId.values()]);
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
  const colorOf = useMemo(() => new Map(groups.map((g) => [g.id, groupColor(g.color)])), [groups]);
  const spots = useMemo(() => {
    const shown: Spot[] = [];
    const seen = new Set<string>();
    const inGroups = new Map(groupSpots.map((s) => [s.id, s.group_ids ?? []]));
    const add = (s: Spot) => {
      if (seen.has(s.id)) return;
      seen.add(s.id);
      const gids = inGroups.get(s.id) ?? [];
      const label = gids.map((g) => names.get(g)).filter(Boolean).join(", ");
      // Whose it is (11.48): yours, then each group's color; public otherwise.
      // Only the layers that are on add a color (11.52): with Mine off, your
      // spot shows just its groups' colors; with a group off, not that group's.
      const colors = [...new Set<string>([
        ...(saved.mine && user && s.owner_id === user.id ? [MINE_COLOR] : []),
        ...gids.filter((g) => !saved.hidden.includes(g)).map((g) => colorOf.get(g)).filter((c): c is string => Boolean(c)),
      ])];
      const withColors = { ...s, colors: colors.length ? colors : [PUBLIC_COLOR] };
      shown.push(gids.length ? { ...withColors, group_ids: gids, group_name: label || null } : withColors);
    };
    if (saved.mine) mySpots.forEach(add);
    for (const s of groupSpots) if ((s.group_ids ?? []).some((g) => !saved.hidden.includes(g))) add(s);
    if (saved.public) publicSpots.forEach(add);
    return shown;
  }, [mySpots, groupSpots, publicSpots, saved, names, colorOf, user]);

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
