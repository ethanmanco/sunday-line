"use client";

import Link from "next/link";
import SpotCard from "@/components/spots/SpotCard";
import type { Spot } from "@/lib/spots";

/** Spots on someone's profile, as a list; the map sits beside it (or a tap away on phones). */
export default function ProfileSpots({ spots, isMe, onFocus }: {
  spots: Spot[] | null;
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
          <SpotCard key={s.id} spot={s} onOpen={() => onFocus(s.id)} />
        ))}
      </ul>
    </>
  );
}
