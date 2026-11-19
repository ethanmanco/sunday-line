"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import SpotCard from "@/components/spots/SpotCard";
import { getSupabase } from "@/lib/supabase";
import { loadRoads, type Spot } from "@/lib/spots";

const SpotMap = dynamic(() => import("@/components/spots/SpotMap"), { ssr: false, loading: () => <div className="spot-map map-loading" /> });

/** Spots on someone's profile. The database decides which ones you may see. */
export default function ProfileSpots({ personId, isMe }: { personId: string; isMe: boolean }) {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    // Public spots plus the ones the owner chose to show (the same for owner and visitors).
    sb.rpc("profile_spots", { p_user: personId }).then(({ data }) => setSpots((data as Spot[] | null) ?? []));
    loadRoads().then((d) => setBbox(d.bbox)).catch(() => setBbox([-95, 31, -92, 34]));
  }, [personId, isMe]);

  if (!spots) return <p className="fine">Loading...</p>;
  if (!spots.length) {
    return <p className="fine">{isMe ? <>No spots on your profile. <Link href="/spots">Manage your spots</Link></> : "No spots to show."}</p>;
  }
  return (
    <>
      {isMe && <p className="fine">Which spots appear here is up to you. <Link href="/spots">Change it</Link></p>}
      {bbox && <SpotMap spots={spots} fallbackBbox={bbox} fitKey="p"
        onSpotClick={(id) => document.getElementById(`spot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />}
      <ul className="spot-list">{spots.map((s) => <SpotCard key={s.id} spot={s} />)}</ul>
    </>
  );
}
