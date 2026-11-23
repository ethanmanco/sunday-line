"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SpotCard from "@/components/spots/SpotCard";
import SpotEditor from "@/components/spots/SpotEditor";
import ScoreRoadControl from "@/components/spots/ScoreRoadControl";
import { can, type Membership } from "./GroupView";
import { getSupabase, PROFILE_COLUMNS, type Group, type Profile } from "@/lib/supabase";
import { linkedSpots, type Spot } from "@/lib/spots";

/** The group's places and roads. Members propose; spot managers accept and publish. */
export default function GroupSpots({ group, me, myId, onFocus, onChanged }: {
  group: Group;
  me: Membership | null;
  myId: string | null;
  /** Show a spot on the page's map. */
  onFocus: (id: string) => void;
  /** Spots changed: the page's map reloads. */
  onChanged: () => void;
}) {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [owners, setOwners] = useState<Record<string, Profile>>({});
  const [editing, setEditing] = useState<Spot | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const manager = can(me, "spots");
  const publicGroup = group.visibility === "public";

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("spot_groups").select("status, spot:spots!inner(*)").eq("group_id", group.id).order("created_at", { ascending: false });
    const list = linkedSpots(data);
    setSpots(list);
    const ids = [...new Set(list.map((s) => s.owner_id))];
    if (ids.length) {
      const { data: ps } = await sb.from("profiles").select(PROFILE_COLUMNS).in("id", ids);
      setOwners(Object.fromEntries(((ps as Profile[] | null) ?? []).map((p) => [p.id, p])));
    }
  }, [group.id]);

  useEffect(() => {
    load();
  }, [load]);

  const accepted = useMemo(() => (spots ?? []).filter((s) => s.group_status === "accepted"), [spots]);
  const proposals = useMemo(() => (spots ?? []).filter((s) => s.group_status === "proposed"), [spots]);

  async function run(fn: () => PromiseLike<{ data?: unknown; error: { message: string } | null }>, ok: string | ((d: unknown) => string)) {
    setMessage(null);
    const { data, error } = await fn();
    setMessage(error ? "That didn't work. You may not have permission." : typeof ok === "function" ? ok(data) : ok);
    load();
    onChanged();
  }
  const sb = getSupabase()!;

  if (!me) {
    // Visitors to a public group see only the spots it put on the public map.
    const shared = (spots ?? []).filter((s) => s.public_status === "approved" && s.group_status === "accepted");
    if (shared.length === 0) return null;
    return (
      <section aria-labelledby="public-spots">
        <h2 id="public-spots">Spots this group shared</h2>
        <ul className="spot-list">
          {shared.map((s) => (
            <SpotCard key={s.id} spot={s} onOpen={() => onFocus(s.id)} />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div className="group-spots">
      {editing ? (
        <SpotEditor
          groupId={editing === "new" ? group.id : null}
          groupName={group.name}
          inPrivateGroup={group.visibility === "private"}
          spot={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            setMessage(editing === "new" && !manager ? "Sent to the group's managers to accept." : null);
            load();
            onChanged();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <p>
            <button type="button" className="button" onClick={() => setEditing("new")}>{manager ? "Add a spot" : "Suggest a spot"}</button>
          </p>
        </>
      )}
      {message && <p className="hint" role="status">{message}</p>}

      {proposals.length > 0 && (
        <section aria-labelledby="proposals">
          <h2 id="proposals">{manager ? `Suggested by members (${proposals.length})` : "Your suggestions"}</h2>
          <ul className="spot-list">
            {proposals.map((s) => (
              <SpotCard key={s.id} spot={s} showStatus onOpen={() => onFocus(s.id)}>
                <span className="fine by-line">From {owners[s.owner_id]?.display_name ?? "a member"}</span>
                {manager && <button type="button" className="button small" onClick={() => run(() => sb.rpc("accept_group_spot", { p_spot: s.id, p_group: group.id }), `${s.name} added.`)}>Accept</button>}
                {(manager || s.owner_id === myId) && (
                  <button type="button" className="button ghost small" onClick={() => run(() => sb.rpc("remove_spot_from_group", { p_spot: s.id, p_group: group.id }), manager ? "Declined." : "Withdrawn.")}>
                    {manager ? "Decline" : "Withdraw"}
                  </button>
                )}
              </SpotCard>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="spots-list">
        <h2 id="spots-list">Group spots</h2>
        {!spots ? <p className="fine">Loading...</p> : accepted.length === 0 ? (
          <p className="fine">No spots yet. {manager ? "Add the places and roads the group uses." : "Suggest a meetup spot or a favorite road."}</p>
        ) : (
          <ul className="spot-list">
            {accepted.map((s) => (
              <SpotCard key={s.id} spot={s} showStatus={manager || s.owner_id === myId} onOpen={() => onFocus(s.id)}>
                <span className="fine by-line">Added by {owners[s.owner_id]?.display_name ?? "a member"}</span>
                {s.owner_id === myId && <button type="button" className="link" onClick={() => setEditing(s)}>Edit</button>}
                <ScoreRoadControl spot={s} onMessage={setMessage} />
                {/* The public map: public groups only. A private group's roads stay with the group (11.59). */}
                {publicGroup && (manager || s.owner_id === myId) && s.kind === "road" && (s.public_status === "none" || s.public_status === "rejected") && (
                  <button type="button" className="link" onClick={() => run(() => sb.rpc("submit_spot_public", { p_spot: s.id }),
                    (d) => (d === "approved" ? `${s.name} is on the public map.` : `${s.name} is waiting for a quick review.`))}>
                    Submit to public map
                  </button>
                )}
                {(manager || s.owner_id === myId) && (s.public_status === "approved" || s.public_status === "pending") && (
                  <button type="button" className="link" onClick={() => run(() => sb.rpc("withdraw_spot_public", { p_spot: s.id }), "Taken off the public map.")}>
                    Take off public map
                  </button>
                )}
                {(manager || s.owner_id === myId) && (
                  <button type="button" className="link danger" onClick={() => {
                    if (window.confirm(`Take ${s.name} out of ${group.name}? It stays in ${s.owner_id === myId ? "your" : "its owner's"} spots.`)) {
                      run(() => sb.rpc("remove_spot_from_group", { p_spot: s.id, p_group: group.id }), "Taken out of the group.");
                    }
                  }}>Remove from group</button>
                )}
              </SpotCard>
            ))}
          </ul>
        )}
        <p className="fine">
          Only members see group spots. {group.visibility === "public" ? "Ones a manager puts on the public map are visible to everyone." : ""}
        </p>
      </section>
    </div>
  );
}
