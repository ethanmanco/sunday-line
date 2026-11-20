"use client";

import Link from "next/link";
import SpotCard from "@/components/spots/SpotCard";
import type { Spot } from "@/lib/spots";

/** Spots on someone's profile, as a list; the map sits beside it (or a tap away on phones). */
export default function ProfileSpots({ spots, groups = {}, isMe, onFocus }: {
  spots: Spot[] | null;
  /** Public groups each spot is in. */
  groups?: Record<string, { name: string; short_id: string }[]>;
  isMe: boolean;
  onFocus: (id: string) => void;
}) {
  if (!spots) return <p className="fine">Loading...</p>;
  if (!spots.length) {
    return <p className="fine">{isMe ? <>No spots on your profile. <Link href="/spots">Manage your spots</Link></> : "No spots to show."}</p>;
  }
  return (
    <>
      {isMe && <p className="fine">Which spots appear here is up to you. <Link href="/spots">Change it</Link></p>}
      <ul className="spot-list">
        {spots.map((s) => (
          <SpotCard key={s.id} spot={s} onOpen={() => onFocus(s.id)}>
            {(groups[s.id] ?? []).map((g) => (
              <Link key={g.short_id} className="chip" href={`/g/${g.short_id}`}>In {g.name}</Link>
            ))}
          </SpotCard>
        ))}
      </ul>
    </>
  );
}
