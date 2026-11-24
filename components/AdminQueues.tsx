"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { roadsById, type CheckKind, type RoadOnMap } from "@/lib/roadData";
import { getSupabase } from "@/lib/supabase";

interface PendingSpot {
  id: string;
  name: string;
  public_note: string | null;
  submitted_at: string | null;
}
interface PendingCheck {
  road_id: string;
  kind: CheckKind;
  flagged_at: string;
}

const CHECK_WORD: Record<CheckKind, string> = { gravel: "gravel or dirt", private: "private", closed: "closed", rough: "poor pavement" };

/**
 * Site admin only (11.45): what's waiting for review, tucked at the bottom of
 * the notifications. Closed by default; opening it lists each item.
 */
export default function AdminQueues() {
  const [admin, setAdmin] = useState(false);
  const [spots, setSpots] = useState<PendingSpot[]>([]);
  const [checks, setChecks] = useState<PendingCheck[]>([]);
  const [roads, setRoads] = useState<Record<string, RoadOnMap>>({});

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      const { data: ok } = await sb.rpc("am_site_admin");
      if (!ok || !live) return;
      setAdmin(true);
      const [s, c] = await Promise.all([
        sb.from("spots").select("id, name, public_note, submitted_at").eq("public_status", "pending").order("submitted_at"),
        sb.from("road_checks").select("road_id, kind, flagged_at").eq("status", "pending").order("flagged_at"),
      ]);
      if (!live) return;
      const cs = (c.data as PendingCheck[] | null) ?? [];
      setSpots((s.data as PendingSpot[] | null) ?? []);
      setChecks(cs);
      if (cs.length) setRoads(await roadsById(cs.map((x) => x.road_id)));
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!admin) return null;
  const waiting = spots.length + checks.length;
  return (
    <details className="admin-queues">
      <summary>
        Site admin: {spots.length} {spots.length === 1 ? "spot" : "spots"} and {checks.length} road{" "}
        {checks.length === 1 ? "check" : "checks"} waiting
      </summary>
      {waiting === 0 && <p className="fine">Nothing waiting.</p>}
      {spots.length > 0 && (
        <>
          <h3>Spots for the public map</h3>
          <ul>
            {spots.map((s) => (
              <li key={s.id}>
                <b>{s.name}</b>
                {s.public_note && <span className="fine"> · {s.public_note}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {checks.length > 0 && (
        <>
          <h3>Road checks</h3>
          <ul>
            {checks.map((c) => (
              <li key={`${c.road_id}:${c.kind}`}>
                <b>{roads[c.road_id]?.name ?? "A road"}</b>
                <span className="fine"> · flagged {CHECK_WORD[c.kind]}{roads[c.road_id]?.near ? ` · near ${roads[c.road_id]?.near}` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="row">
        <Link href="/admin/spots" className="button ghost small">Review spots</Link>
        <Link href="/admin/roads" className="button ghost small">Review road checks</Link>
        <Link href="/admin/stats" className="button ghost small">Site stats</Link>
      </p>
    </details>
  );
}
