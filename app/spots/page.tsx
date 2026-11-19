"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import SpotCard from "@/components/spots/SpotCard";
import SpotEditor from "@/components/spots/SpotEditor";
import { getSupabase, rememberReturn, type Group } from "@/lib/supabase";
import { loadRoads, type Spot, type SpotsDisplay } from "@/lib/spots";

const SpotMap = dynamic(() => import("@/components/spots/SpotMap"), { ssr: false, loading: () => <div className="spot-map map-loading" /> });

const DISPLAY: [SpotsDisplay, string][] = [
  ["all", "All my spots"],
  ["selected", "Only ones I pick"],
  ["groups", "From groups I pick"],
  ["none", "None"],
];

export default function SpotsPage() {
  const { ready, user, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [shownGroups, setShownGroups] = useState<Set<string>>(new Set());
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Spot | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState("first");

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user) return;
    const [s, g, pg] = await Promise.all([
      sb.from("spots").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }),
      sb.from("group_members").select("group:groups(*)").eq("user_id", user.id),
      sb.from("profile_spot_groups").select("group_id").eq("user_id", user.id),
    ]);
    setSpots((s.data as Spot[] | null) ?? []);
    setGroups(((g.data as unknown as { group: Group | null }[]) ?? []).flatMap((r) => (r.group ? [r.group] : [])));
    setShownGroups(new Set(((pg.data as { group_id: string }[] | null) ?? []).map((r) => r.group_id)));
  }, [user]);

  useEffect(() => {
    if (ready && user) load();
  }, [ready, user, load]);

  useEffect(() => {
    loadRoads().then((d) => setBbox(d.bbox)).catch(() => setBbox([-95, 31, -92, 34]));
  }, []);

  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const visible = useMemo(
    () => (spots ?? []).filter((s) => filter === "all" || (filter === "personal" ? !s.group_id : s.group_id === filter)),
    [spots, filter],
  );

  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user || !profile) {
    return (
      <div className="page narrow">
        <h1>Your spots</h1>
        <p>
          {!user ? <Link href="/signin" onClick={() => rememberReturn("/spots")}>Sign in</Link> : <Link href="/me">Set up your profile</Link>} to
          save meetup spots and favorite roads.
        </p>
      </div>
    );
  }

  const sb = getSupabase()!;
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    setMessage(null);
    const { error } = await fn();
    setMessage(error ? (error.message.includes("accept") ? "The group has to accept it first." : "That didn't work. Try again.") : ok ?? null);
    load();
  }

  async function setDisplay(d: SpotsDisplay) {
    await sb.from("profiles").update({ spots_display: d }).eq("id", user!.id);
    refreshProfile();
  }
  async function toggleGroup(id: string, on: boolean) {
    if (on) await sb.from("profile_spot_groups").insert({ group_id: id });
    else await sb.from("profile_spot_groups").delete().eq("user_id", user!.id).eq("group_id", id);
    load();
  }
  async function addToGroup(s: Spot, groupId: string) {
    const copy = {
      kind: s.kind, name: s.name, description: s.description, category: s.category, lat: s.lat, lng: s.lng,
      road_id: s.road_id, road_region: s.road_region, start_frac: s.start_frac, end_frac: s.end_frac, line: s.line,
      group_id: groupId,
    };
    await run(() => sb.from("spots").insert(copy), `Added to ${groupName.get(groupId)}.`);
  }
  async function submit(s: Spot) {
    setMessage(null);
    const { data, error } = await sb.rpc("submit_spot_public", { p_spot: s.id });
    if (error) setMessage(error.message.includes("accept") ? "The group has to accept it first." : "Couldn't submit.");
    else setMessage(data === "approved" ? `${s.name} is on the public map.` : `${s.name} is waiting for a quick review.`);
    load();
  }

  const display = (profile as { spots_display?: SpotsDisplay }).spots_display ?? "selected";

  return (
    <div className="page spots-page">
      <h1>Your spots</h1>
      <p className="lead">Meetup spots, stops, and favorite roads. Keep them to yourself, add them to groups, or put them on the public map.</p>

      {editing ? (
        <SpotEditor
          spot={editing === "new" ? null : editing}
          onSaved={() => { setEditing(null); load(); setFitKey(`s${Date.now()}`); }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <p><button type="button" className="button" onClick={() => setEditing("new")}>Add a spot</button></p>
          {bbox && spots && spots.length > 0 && (
            <SpotMap
              spots={visible}
              fallbackBbox={bbox}
              fitKey={`${filter}-${fitKey}`}
              onSpotClick={(id) => document.getElementById(`spot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
            />
          )}
        </>
      )}
      {message && <p className="hint" role="status">{message}</p>}

      <section aria-labelledby="on-profile">
        <h2 id="on-profile">On your profile</h2>
        <div className="seg">
          {DISPLAY.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={display === k} onClick={() => setDisplay(k)}>{label}</button>
          ))}
        </div>
        <p className="fine">
          {display === "all" && "Everyone who can see your profile sees all your spots, including ones in public groups."}
          {display === "selected" && "Only spots marked \"Show on my profile\" appear."}
          {display === "groups" && "Your own spots from the public groups you check below appear on your profile."}
          {display === "none" && "Your profile shows no spots."}
          {profile.is_private && " Your profile is private, so only approved followers see them."}
          {display !== "none" && " Spots in private groups never show on your profile."}
        </p>
        {display === "groups" && (
          <div className="form">
            {groups.filter((g) => g.visibility === "public").length === 0 && <p className="fine">You&apos;re not in any public groups yet.</p>}
            {groups.filter((g) => g.visibility === "public").map((g) => (
              <label key={g.id} className="check">
                <input type="checkbox" checked={shownGroups.has(g.id)} onChange={(e) => toggleGroup(g.id, e.target.checked)} />
                <span>{g.name}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="list">
        <h2 id="list">All your spots</h2>
        {groups.length > 0 && (
          <div className="seg filter-seg">
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
            <button type="button" aria-pressed={filter === "personal"} onClick={() => setFilter("personal")}>Just mine</button>
            {groups.map((g) => (
              <button key={g.id} type="button" aria-pressed={filter === g.id} onClick={() => setFilter(g.id)}>{g.name}</button>
            ))}
          </div>
        )}
        {!spots ? <p className="fine">Loading...</p> : visible.length === 0 ? (
          <p className="fine">No spots here yet.</p>
        ) : (
          <ul className="spot-list">
            {visible.map((s) => (
              <SpotCard key={s.id} spot={s} groupName={s.group_id ? groupName.get(s.group_id) ?? "a group" : null} showStatus
                onOpen={() => router.push(`/?spot=${s.id}`)}>
                <button type="button" className="link" onClick={() => { setEditing(s); window.scrollTo({ top: 0 }); }}>Edit</button>
                {display === "selected" && !(s.group_id && groups.find((g) => g.id === s.group_id)?.visibility === "private") && (
                  <button type="button" className="link" onClick={() => run(() => sb.from("spots").update({ show_on_profile: !s.show_on_profile }).eq("id", s.id))}>
                    {s.show_on_profile ? "Hide from profile" : "Show on profile"}
                  </button>
                )}
                {s.public_status === "none" || s.public_status === "rejected" ? (
                  <button type="button" className="link" onClick={() => submit(s)}>Submit to public map</button>
                ) : (
                  <button type="button" className="link" onClick={() => run(() => sb.rpc("withdraw_spot_public", { p_spot: s.id }), "Taken off the public map.")}>
                    Take off public map
                  </button>
                )}
                {!s.group_id && groups.length > 0 && (
                  <select aria-label={`Add ${s.name} to a group`} value="" onChange={(e) => e.target.value && addToGroup(s, e.target.value)}>
                    <option value="">Add to a group...</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
                {s.group_id && (
                  <button type="button" className="link" onClick={() => run(() => sb.rpc("remove_spot_from_group", { p_spot: s.id }), "Taken out of the group. It's still in your spots.")}>
                    Take out of group
                  </button>
                )}
                <button type="button" className="link danger" onClick={() => {
                  if (window.confirm(`Delete ${s.name}? This removes it everywhere, including groups and the public map.`)) {
                    run(() => sb.from("spots").delete().eq("id", s.id));
                  }
                }}>Delete</button>
              </SpotCard>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
