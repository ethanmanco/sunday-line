"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { roadsById, type CheckKind, type RoadOnMap } from "@/lib/roadData";
import { FLAG_LABEL, getSupabase } from "@/lib/supabase";
import { bountyPoints, isBounty } from "@/lib/bounties";

interface Check {
  road_id: string;
  kind: CheckKind;
  status: "pending" | "accepted" | "dismissed";
  flagged_at: string;
  decided_at: string | null;
}

interface Review {
  road_id: string;
  flags: string[];
  pavement: string | null;
  note: string | null;
  updated_at: string;
}

const KIND_LABEL: Record<CheckKind, string> = {
  gravel: FLAG_LABEL.gravel,
  private: FLAG_LABEL.private,
  closed: FLAG_LABEL.closed,
  rough: "Poor pavement",
  paved: "Paved (surface needed a check)",
};

/** Site admin only (11.38): roads members flagged three times, plus what's been accepted. */
export default function RoadChecks() {
  const { ready, user } = useAuth();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [roads, setRoads] = useState<Record<string, RoadOnMap>>({});
  const [reviews, setReviews] = useState<Record<string, Review[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data: ok } = await sb.rpc("am_site_admin");
    setAdmin(Boolean(ok));
    if (!ok) return;
    const { data } = await sb.from("road_checks").select("*").in("status", ["pending", "accepted"])
      .order("flagged_at", { ascending: false }).limit(200);
    const cs = (data as Check[] | null) ?? [];
    setChecks(cs);
    const ids = [...new Set(cs.map((c) => c.road_id))];
    if (!ids.length) return;
    const { data: rv } = await sb.from("road_ratings").select("road_id, flags, pavement, note, updated_at").in("road_id", ids)
      .order("updated_at", { ascending: false });
    const byRoad: Record<string, Review[]> = {};
    for (const r of (rv as Review[] | null) ?? []) (byRoad[r.road_id] ??= []).push(r);
    setReviews(byRoad);
    setRoads(await roadsById(ids));
  }, []);

  useEffect(() => {
    if (ready && user) load();
    else if (ready) setAdmin(false);
  }, [ready, user, load]);

  // Rep paid to each flagger when accepted (11.78): the bounty for a road that
  // needed a check, the base amount otherwise.
  const pointsFor = (c: Check) => (roads[c.road_id] ? bountyPoints(roads[c.road_id]) : 5);

  async function decide(c: Check, accept: boolean) {
    setBusy(`${c.road_id}:${c.kind}`);
    await getSupabase()?.rpc("review_road_check", {
      p_road: c.road_id, p_kind: c.kind, p_accept: accept, ...(accept ? { p_points: pointsFor(c) } : {}),
    });
    setBusy(null);
    load();
  }

  if (admin === null) return <div className="page narrow"><p>Loading...</p></div>;
  if (!admin) return <div className="page narrow"><h1>Not found</h1><p><Link href="/">Back to the roads</Link></p></div>;

  const pending = checks.filter((c) => c.status === "pending");
  const accepted = checks.filter((c) => c.status === "accepted");
  const row = (c: Check, accept: boolean) => {
    const r = roads[c.road_id];
    const notes = (reviews[c.road_id] ?? []).filter((v) => v.note);
    return (
      <li key={`${c.road_id}:${c.kind}`} className="check-row">
        <p>
          <b>{KIND_LABEL[c.kind]}</b>: <Link href={`/road/${c.road_id}`}>{r ? r.name : c.road_id}</Link>
          {r?.near ? <span className="fine"> near {r.near}{r.state ? `, ${r.state}` : ""}</span> : null}
        </p>
        <p className="fine">
          {(() => {
            const n = (reviews[c.road_id] ?? []).filter((v) => (c.kind === "rough" ? v.pavement === "rough" : v.flags.includes(c.kind))).length;
            return `${n} ${n === 1 ? "flag" : "flags"}`;
          })()}
          {" · "}{new Date(c.decided_at ?? c.flagged_at).toLocaleDateString()}
          {accept && <>{" · "}{r && isBounty(r) ? "bounty, " : ""}pays +{pointsFor(c)} rep each</>}
        </p>
        {notes.slice(0, 3).map((v, i) => <p key={i} className="fine">&ldquo;{v.note}&rdquo;</p>)}
        <div className="row">
          {accept ? (
            <>
              <button type="button" className="button small" disabled={busy !== null} onClick={() => decide(c, true)}>Accept</button>
              <button type="button" className="button ghost small" disabled={busy !== null} onClick={() => decide(c, false)}>It&apos;s fine</button>
            </>
          ) : (
            <button type="button" className="button ghost small" disabled={busy !== null} onClick={() => decide(c, false)}>Undo</button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="page narrow">
      <h1>Road checks</h1>
      <p className="lead">
        Roads three members flagged the same way. Accepting one moves the road off Driver&apos;s roads (gravel goes to
        the Gravel list; paved brings a road that needed a check onto Driver&apos;s roads) right away. Your own flags are
        accepted as soon as you save them.
      </p>
      <p className="fine">
        Accepting pays rep to each member whose review flags it (accounts a week old, at most 50 a day): a bounty pays a
        fifth of the road&apos;s Overall score, other checks 5. &ldquo;It&apos;s fine&rdquo; and Undo cost each flagger 3
        (poor pavement costs nothing). Check before you accept: rep only means something if it&apos;s right.
      </p>
      <h2>Waiting ({pending.length})</h2>
      {pending.length === 0 ? <p className="fine">Nothing waiting.</p> : <ul className="check-list">{pending.map((c) => row(c, true))}</ul>}
      <h2>Accepted ({accepted.length})</h2>
      {accepted.length === 0 ? <p className="fine">None yet.</p> : <ul className="check-list">{accepted.map((c) => row(c, false))}</ul>}
    </div>
  );
}
