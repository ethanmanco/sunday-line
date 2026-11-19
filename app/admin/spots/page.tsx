"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import SpotCard from "@/components/spots/SpotCard";
import { getSupabase, PROFILE_COLUMNS, type Profile } from "@/lib/supabase";
import { loadRoads, type Spot } from "@/lib/spots";

const SpotMap = dynamic(() => import("@/components/spots/SpotMap"), { ssr: false, loading: () => <div className="spot-map map-loading" /> });

/** Site admin only: spots that tripped an automatic check, plus recent approvals. */
export default function ReviewSpots() {
  const { ready, user } = useAuth();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [pending, setPending] = useState<Spot[]>([]);
  const [recent, setRecent] = useState<Spot[]>([]);
  const [owners, setOwners] = useState<Record<string, Profile>>({});
  const [focus, setFocus] = useState<Spot | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data: ok } = await sb.rpc("am_site_admin");
    setAdmin(Boolean(ok));
    if (!ok) return;
    const [p, r] = await Promise.all([
      sb.from("spots").select("*").eq("public_status", "pending").order("submitted_at"),
      sb.from("spots").select("*").eq("public_status", "approved").order("submitted_at", { ascending: false }).limit(50),
    ]);
    const ps = (p.data as Spot[] | null) ?? [];
    const rs = (r.data as Spot[] | null) ?? [];
    setPending(ps);
    setRecent(rs);
    const ids = [...new Set([...ps, ...rs].map((s) => s.owner_id))];
    if (ids.length) {
      const { data } = await sb.from("profiles").select(PROFILE_COLUMNS).in("id", ids);
      setOwners(Object.fromEntries(((data as Profile[] | null) ?? []).map((x) => [x.id, x])));
    }
  }, []);

  useEffect(() => {
    if (ready && user) load();
    else if (ready) setAdmin(false);
    loadRoads().then((d) => setBbox(d.bbox)).catch(() => setBbox([-125, 24, -66, 50]));
  }, [ready, user, load]);

  async function decide(s: Spot, approve: boolean) {
    await getSupabase()?.rpc("review_spot", { p_spot: s.id, p_approve: approve, p_note: notes[s.id] ?? "" });
    setFocus(null);
    load();
  }

  if (admin === null) return <div className="page narrow"><p>Loading...</p></div>;
  if (!admin) return <div className="page narrow"><h1>Not found</h1><p><Link href="/">Back to the roads</Link></p></div>;

  const by = (s: Spot) => owners[s.owner_id];
  return (
    <div className="page spots-page">
      <h1>Spot review</h1>
      <p className="lead">Spots that tripped an automatic check. Everything else went straight to the public map.</p>
      {bbox && (pending.length > 0 || focus) && (
        <SpotMap spots={focus ? [focus] : pending} fallbackBbox={bbox} fitKey={focus?.id ?? "all"} />
      )}

      <h2>Waiting ({pending.length})</h2>
      {pending.length === 0 ? <p className="fine">Nothing waiting.</p> : (
        <ul className="spot-list">
          {pending.map((s) => (
            <SpotCard key={s.id} spot={s} showStatus>
              <span className="fine">
                By {by(s) ? <Link href={`/u/${by(s)!.username}`}>{by(s)!.display_name}</Link> : "someone"}
                {s.submitted_at ? ` · ${new Date(s.submitted_at).toLocaleDateString()}` : ""}
              </span>
              <button type="button" className="link" onClick={() => { setFocus(s); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Show on map</button>
              <input
                className="review-note"
                aria-label={`Note for ${s.name}`}
                placeholder="Note to the person (optional)"
                maxLength={300}
                value={notes[s.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
              />
              <button type="button" className="button small" onClick={() => decide(s, true)}>Approve</button>
              <button type="button" className="button ghost small" onClick={() => decide(s, false)}>Don&apos;t approve</button>
            </SpotCard>
          ))}
        </ul>
      )}

      <h2>Recently on the public map</h2>
      {recent.length === 0 ? <p className="fine">None yet.</p> : (
        <ul className="spot-list">
          {recent.map((s) => (
            <SpotCard key={s.id} spot={s}>
              <span className="fine">
                By {by(s)?.display_name ?? "someone"} · {s.reviewed_at ? "approved by you" : "passed the checks"}
              </span>
              <button type="button" className="link" onClick={() => { setFocus(s); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Show on map</button>
              <button type="button" className="link danger" onClick={() => decide(s, false)}>Take off the map</button>
            </SpotCard>
          ))}
        </ul>
      )}
    </div>
  );
}
