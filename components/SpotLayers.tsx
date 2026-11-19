"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { getSupabase, type Group } from "@/lib/supabase";
import type { Spot } from "@/lib/spots";

const KEY = "sl-map-layers";

interface Saved {
  public: boolean;
  /** Group IDs turned off (new groups show by default). */
  hidden: string[];
}

function readSaved(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    if (s && typeof s.public === "boolean" && Array.isArray(s.hidden)) return s;
  } catch {
    // Storage blocked or bad value: use the defaults.
  }
  return { public: true, hidden: [] };
}

/**
 * Which spots show on the main map: public ones, your groups' ones, or both.
 * Returns the spots to draw and the button plus panel to choose.
 */
export function useSpotLayers() {
  const { ready, user } = useAuth();
  const [publicSpots, setPublicSpots] = useState<Spot[]>([]);
  const [groupSpots, setGroupSpots] = useState<Spot[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [saved, setSaved] = useState<Saved>({ public: true, hidden: [] });

  useEffect(() => setSaved(readSaved()), []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("spots").select("*").eq("public_status", "approved").limit(3000)
      .then(({ data }) => setPublicSpots((data as Spot[] | null) ?? []));
  }, []);

  // Spots from groups you're in (members see accepted ones).
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !ready) return;
    if (!user) {
      setGroups([]);
      setGroupSpots([]);
      return;
    }
    (async () => {
      const { data: m } = await sb.from("group_members").select("group:groups(*)").eq("user_id", user.id);
      const gs = ((m as unknown as { group: Group | null }[]) ?? []).flatMap((r) => (r.group ? [r.group] : []));
      if (!gs.length) return;
      const { data } = await sb.from("spots").select("*").in("group_id", gs.map((g) => g.id)).eq("group_status", "accepted").limit(3000);
      const spots = (data as Spot[] | null) ?? [];
      const withSpots = new Set(spots.map((s) => s.group_id));
      setGroups(gs.filter((g) => withSpots.has(g.id)));
      setGroupSpots(spots);
    })();
  }, [ready, user]);

  function save(next: Saved) {
    setSaved(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not saved for next time; still applies now.
    }
  }

  const names = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const spots = useMemo(() => {
    const shown: Spot[] = [];
    const seen = new Set<string>();
    for (const s of groupSpots) {
      if (s.group_id && !saved.hidden.includes(s.group_id)) {
        shown.push({ ...s, group_name: names.get(s.group_id) ?? null });
        seen.add(s.id);
      }
    }
    if (saved.public) for (const s of publicSpots) if (!seen.has(s.id)) shown.push(s);
    return shown;
  }, [groupSpots, publicSpots, saved, names]);

  return { spots, groups, saved, save, hasGroups: groups.length > 0 };
}

export function SpotLayersControl({ groups, saved, save }: {
  groups: Group[];
  saved: Saved;
  save: (s: Saved) => void;
}) {
  const [open, setOpen] = useState(false);
  const allGroupsOn = groups.every((g) => !saved.hidden.includes(g.id));
  return (
    <div className="layers">
      <button type="button" className="layers-toggle" aria-expanded={open} aria-controls="layers-panel" onClick={() => setOpen(!open)}>
        Spots
      </button>
      {open && (
        <div id="layers-panel" className="layers-panel" role="group" aria-label="Spots on the map">
          <label className="check">
            <input type="checkbox" checked={saved.public} onChange={(e) => save({ ...saved, public: e.target.checked })} />
            <span>Public spots</span>
          </label>
          {groups.length > 0 && (
            <>
              <p className="fine">Your groups</p>
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
              <div className="row">
                <button type="button" className="link" onClick={() => save({ public: false, hidden: [] })}>Only my groups</button>
                <button type="button" className="link" onClick={() => save({ public: true, hidden: groups.map((g) => g.id) })}>Only public</button>
                {!(saved.public && allGroupsOn) && (
                  <button type="button" className="link" onClick={() => save({ public: true, hidden: [] })}>Both</button>
                )}
              </div>
            </>
          )}
          {groups.length === 0 && <p className="fine">Spots from groups you&apos;re in show up here too.</p>}
        </div>
      )}
    </div>
  );
}
