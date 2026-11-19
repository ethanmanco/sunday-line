"use client";

import { useCallback, useEffect, useState } from "react";
import PersonRow from "@/components/profile/PersonRow";
import { getSupabase, PROFILE_COLUMNS, type Profile } from "@/lib/supabase";

/** Follow requests, followers, and blocked people. */
export default function PeopleManager({ userId }: { userId: string }) {
  const [requests, setRequests] = useState<Profile[]>([]);
  const [followers, setFollowers] = useState<Profile[]>([]);
  const [blocked, setBlocked] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [f, b] = await Promise.all([
      sb.from("follows")
        .select(`status, person:profiles!follows_follower_id_fkey(${PROFILE_COLUMNS})`)
        .eq("followee_id", userId).order("created_at", { ascending: false }).limit(500),
      sb.from("blocks")
        .select(`person:profiles!blocks_blocked_id_fkey(${PROFILE_COLUMNS})`)
        .eq("blocker_id", userId).order("created_at", { ascending: false }),
    ]);
    const rows = (f.data as unknown as { status: string; person: Profile | null }[]) ?? [];
    setRequests(rows.flatMap((r) => (r.status === "pending" && r.person ? [r.person] : [])));
    setFollowers(rows.flatMap((r) => (r.status === "accepted" && r.person ? [r.person] : [])));
    setBlocked(((b.data as unknown as { person: Profile | null }[]) ?? []).flatMap((r) => (r.person ? [r.person] : [])));
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(p: Profile) {
    await getSupabase()?.from("follows").update({ status: "accepted" }).eq("follower_id", p.id).eq("followee_id", userId);
    load();
  }
  async function removeFollower(p: Profile, asking: boolean) {
    if (!asking && !window.confirm(`Remove @${p.username} from your followers? They aren't told.`)) return;
    await getSupabase()?.from("follows").delete().eq("follower_id", p.id).eq("followee_id", userId);
    load();
  }
  async function unblock(p: Profile) {
    await getSupabase()?.from("blocks").delete().eq("blocker_id", userId).eq("blocked_id", p.id);
    load();
  }

  if (!loaded) return null;
  return (
    <section aria-labelledby="people">
      <h2 id="people">People</h2>
      {requests.length > 0 && (
        <>
          <h3>Requests to follow you ({requests.length})</h3>
          <ul className="people">
            {requests.map((p) => (
              <PersonRow key={p.id} person={p}>
                <button type="button" className="button small" onClick={() => approve(p)}>Approve</button>
                <button type="button" className="button ghost small" onClick={() => removeFollower(p, true)}>Decline</button>
              </PersonRow>
            ))}
          </ul>
        </>
      )}
      <h3>Followers ({followers.length})</h3>
      {followers.length === 0 ? (
        <p className="fine">No followers yet.</p>
      ) : (
        <ul className="people">
          {followers.map((p) => (
            <PersonRow key={p.id} person={p}>
              <button type="button" className="link" onClick={() => removeFollower(p, false)}>Remove</button>
            </PersonRow>
          ))}
        </ul>
      )}
      {blocked.length > 0 && (
        <>
          <h3>Blocked ({blocked.length})</h3>
          <ul className="people">
            {blocked.map((p) => (
              <PersonRow key={p.id} person={p}>
                <button type="button" className="link" onClick={() => unblock(p)}>Unblock</button>
              </PersonRow>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
