"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { useMapShell } from "@/lib/mapShell";
import { encodePolyline, groupColor, MINE_COLOR, ROAD_REGION, simplifyLine } from "@/lib/spots";
import { getSupabase, rememberReturn, type Group } from "@/lib/supabase";
import type { LoadedRoad } from "@/lib/types";

/**
 * "Save" on a road's page (11.48): save the whole road to your spots, or to one
 * of your groups. One spot per road: saving to a group again reuses it. Trim it
 * to a stretch later with Edit in Your spots.
 */
export default function SaveRoad({ road }: { road: LoadedRoad }) {
  const { user, profile } = useAuth();
  const shell = useMapShell();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [spotId, setSpotId] = useState<string | null>(null);
  const [inGroups, setInGroups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Is it saved already, and in which groups?
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !user) return;
    let live = true;
    (async () => {
      const [{ data: s }, { data: m }] = await Promise.all([
        sb.from("spots").select("id, links:spot_groups(group_id)").eq("owner_id", user.id).eq("road_id", road.id).limit(1).maybeSingle(),
        sb.from("group_members").select("group:groups(*)").eq("user_id", user.id),
      ]);
      if (!live) return;
      const found = s as { id: string; links: { group_id: string }[] } | null;
      setSpotId(found?.id ?? null);
      setInGroups(found?.links.map((l) => l.group_id) ?? []);
      setGroups(((m as unknown as { group: Group | null }[]) ?? []).flatMap((r) => (r.group ? [r.group] : [])));
    })();
    return () => {
      live = false;
    };
  }, [user, road.id]);

  // The note says what happened, then gets out of the way.
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [note]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!user || !profile) {
    return (
      <Link href={user ? "/me" : "/signin"} className="share save-road" onClick={() => rememberReturn(`/road/${road.id}`)}>
        Save
      </Link>
    );
  }

  async function ensureSpot(): Promise<string | null> {
    if (spotId) return spotId;
    const sb = getSupabase();
    if (!sb) return null;
    const start = road.coords[0];
    const { data, error } = await sb
      .from("spots")
      .insert({
        kind: "road", category: null, name: road.name.slice(0, 60), lat: start[1], lng: start[0],
        road_id: road.id, road_region: ROAD_REGION, start_frac: null, end_frac: null,
        line: encodePolyline(simplifyLine(road.coords)), show_on_profile: false,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    setSpotId((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function save(groupId: string | null) {
    setBusy(true);
    setNote(null);
    const id = await ensureSpot();
    if (!id) {
      setBusy(false);
      return setNote("Couldn't save it. Try again.");
    }
    if (groupId) {
      const { data, error } = (await getSupabase()?.rpc("add_spot_to_group", { p_spot: id, p_group: groupId })) ?? {};
      const g = groups.find((x) => x.id === groupId);
      if (error) {
        setNote(error.message.includes("private") ? "It's in a private group, so it can't go in a public one." : "Couldn't add it to the group.");
      } else {
        setInGroups((xs) => [...new Set([...xs, groupId])]);
        setNote(data === "accepted" ? `Saved to ${g?.name}.` : `Suggested to ${g?.name}. A manager will accept it.`);
      }
    } else {
      setNote("Saved to your spots.");
    }
    setBusy(false);
    setOpen(false);
    shell?.reloadSpots?.();
  }

  return (
    <div className="save-road-box" ref={box}>
      <button type="button" className="share save-road" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>
        {spotId ? "Saved" : "Save"}
      </button>
      {open && (
        <ul className="save-menu" role="menu" aria-label="Save this road to">
          <li role="none">
            <button type="button" role="menuitem" disabled={busy || !!spotId} onClick={() => save(null)}>
              <span className="dot" style={{ background: MINE_COLOR }} aria-hidden="true" />
              Your spots{spotId ? " (saved)" : ""}
            </button>
          </li>
          {groups.map((g) => (
            <li key={g.id} role="none">
              <button type="button" role="menuitem" disabled={busy || inGroups.includes(g.id)} onClick={() => save(g.id)}>
                <span className="dot" style={{ background: groupColor(g.color) }} aria-hidden="true" />
                {g.name}{inGroups.includes(g.id) ? " (saved)" : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <span className="save-note" role="status">{note}</span>}
    </div>
  );
}
