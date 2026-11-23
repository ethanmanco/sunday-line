"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import SpotCard from "@/components/spots/SpotCard";
import SpotEditor from "@/components/spots/SpotEditor";
import ScoreRoadControl from "@/components/spots/ScoreRoadControl";
import { getSupabase, rememberReturn, type Group } from "@/lib/supabase";
import type { Spot, SpotLink } from "@/lib/spots";
import { usePageOnMap } from "@/lib/usePageOnMap";

type MySpot = Spot & { links: SpotLink[] };

/**
 * Your own spots, on the main map. Each spot is one spot: it can be in any
 * number of groups and still shows once here.
 */
export default function SpotsLibrary() {
  const { ready, user, profile } = useAuth();
  const [spots, setSpots] = useState<MySpot[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<MySpot | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user) return;
    const [s, g] = await Promise.all([
      sb.from("spots").select("*, links:spot_groups(group_id, status)").eq("owner_id", user.id).order("created_at", { ascending: false }),
      sb.from("group_members").select("group:groups(*)").eq("user_id", user.id),
    ]);
    setSpots(((s.data as MySpot[] | null) ?? []).map((x) => ({ ...x, links: x.links ?? [] })));
    setGroups(((g.data as unknown as { group: Group | null }[]) ?? []).flatMap((r) => (r.group ? [r.group] : [])));
  }, [user]);

  useEffect(() => {
    if (ready && user) load();
  }, [ready, user, load]);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const visible = useMemo(
    () => (spots ?? []).filter((s) =>
      filter === "all" || (filter === "personal" ? s.links.length === 0 : s.links.some((l) => l.group_id === filter))),
    [spots, filter],
  );
  const shell = usePageOnMap(user && profile ? "Your spots" : null, user && profile ? (spots ? visible : null) : null);

  if (!ready) return <div className="page"><p>Loading...</p></div>;
  if (!user || !profile) {
    return (
      <div className="page">
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
    setMessage(error ? "That didn't work. Try again." : ok ?? null);
    load();
  }

  async function addToGroup(s: Spot, groupId: string) {
    setMessage(null);
    const { data, error } = await sb.rpc("add_spot_to_group", { p_spot: s.id, p_group: groupId });
    const name = groupById.get(groupId)?.name ?? "the group";
    setMessage(error
      ? (error.message.includes("private") ? "A spot in a private group can't go in a public group." : "Couldn't add it to the group.")
      : data === "accepted" ? `Added to ${name}.` : `Suggested to ${name}. A manager will accept it.`);
    load();
  }
  async function submit(s: Spot) {
    setMessage(null);
    const { data, error } = await sb.rpc("submit_spot_public", { p_spot: s.id });
    if (error) setMessage("Couldn't submit.");
    else setMessage(data === "approved" ? `${s.name} is on the public map.` : `${s.name} is waiting for a quick review.`);
    load();
  }

  const inPrivate = (s: MySpot) => s.links.some((l) => groupById.get(l.group_id)?.visibility === "private");

  if (editing) {
    return (
      <div className="page">
        <SpotEditor
          spot={editing === "new" ? null : editing}
          inPrivateGroup={editing !== "new" && inPrivate(editing)}
          onSaved={(id) => {
            setEditing(null);
            load().then(() => shell?.focusSpot(id));
          }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="page spots-page">
      <div className="page-head">
        <h1>Your spots</h1>
        <button type="button" className="button" onClick={() => setEditing("new")}>Add a spot</button>
      </div>
      {message && <p className="hint" role="status">{message}</p>}

      <section aria-labelledby="list">
        {groups.length > 0 && (
          <div className="chips" role="group" aria-label="Which spots">
            <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
            <button type="button" className="chip" aria-pressed={filter === "personal"} onClick={() => setFilter("personal")}>Not in a group</button>
            {groups.map((g) => (
              <button key={g.id} type="button" className="chip" aria-pressed={filter === g.id} onClick={() => setFilter(g.id)}>{g.name}</button>
            ))}
          </div>
        )}
        <h2 id="list" className="visually-hidden">Spots</h2>
        {!spots ? <p className="fine">Loading...</p> : visible.length === 0 ? (
          <p className="fine">{spots.length === 0 ? "No spots yet. Add a meetup spot or a favorite road." : "No spots here."}</p>
        ) : (
          <ul className="spot-list">
            {visible.map((s) => {
              // Private groups can always take a spot; public ones can't once it's in a private group (11.44).
              const priv = inPrivate(s);
              const free = groups.filter((g) => !s.links.some((l) => l.group_id === g.id) && (g.visibility === "private" || !priv));
              return (
                <SpotCard key={s.id} spot={s} showStatus onOpen={() => shell?.focusSpot(s.id)}>
                  {s.links.map((l) => (
                    <button key={l.group_id} type="button" className="chip"
                      aria-label={`Take ${s.name} out of ${groupById.get(l.group_id)?.name ?? "this group"}`}
                      onClick={() => {
                        const gname = groupById.get(l.group_id)?.name ?? "this group";
                        if (window.confirm(`Take ${s.name} out of ${gname}? It stays in your spots.`)) {
                          run(() => sb.rpc("remove_spot_from_group", { p_spot: s.id, p_group: l.group_id }), `Taken out of ${gname}.`);
                        }
                      }}>
                      {groupById.get(l.group_id)?.name ?? "A group"}{l.status === "proposed" ? " (waiting)" : ""} <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  {free.length > 0 && (
                    <select className="chip" aria-label={`Add ${s.name} to a group`} value="" onChange={(e) => e.target.value && addToGroup(s, e.target.value)}>
                      <option value="">Add to a group</option>
                      {free.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                  <button type="button" className="link" onClick={() => setEditing(s)}>Edit</button>
                  <ScoreRoadControl spot={s} onMessage={setMessage} />
                  {priv ? (
                    <span className="chip" title="Spots in a private group stay off your profile.">Private group: not on profile</span>
                  ) : (
                    <button type="button" className="chip" aria-pressed={s.show_on_profile}
                      onClick={() => run(() => sb.from("spots").update({ show_on_profile: !s.show_on_profile }).eq("id", s.id),
                        s.show_on_profile ? `${s.name} is off your profile.` : `${s.name} is on your profile.`)}>
                      {s.show_on_profile ? "On profile" : "Show on profile"}
                    </button>
                  )}
                  {s.kind === "point" && s.public_status === "none" ? null : s.public_status === "none" || s.public_status === "rejected" ? (
                    <button type="button" className="link" onClick={() => submit(s)}>Submit to public map</button>
                  ) : (
                    <button type="button" className="link" onClick={() => run(() => sb.rpc("withdraw_spot_public", { p_spot: s.id }), "Taken off the public map.")}>
                      Take off public map
                    </button>
                  )}
                  <button type="button" className="link danger" onClick={() => {
                    if (window.confirm(`Delete ${s.name}? This removes it everywhere, including groups and the public map.`)) {
                      run(() => sb.from("spots").delete().eq("id", s.id));
                    }
                  }}>Delete</button>
                </SpotCard>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="on-profile">
        <h2 id="on-profile">On your profile</h2>
        <p className="fine">
          Turn on &quot;Show on profile&quot; for each spot you want people to see.
          {profile.is_private ? " Your profile is private, so only approved followers see them." : " Anyone who visits your profile sees them."}
          {" "}Spots in a private group never show on your profile.
        </p>
      </section>
    </div>
  );
}
