"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import type { Spot } from "@/lib/spots";

/** Who added a spot and the groups it's in (only ones the viewer can see), as links. */
export default function SpotFacts({ spot }: { spot: Spot }) {
  const [owner, setOwner] = useState<{ username: string; display_name: string } | null>(null);
  const [groups, setGroups] = useState<{ name: string; short_id: string }[]>([]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !spot.owner_id) return;
    let live = true;
    sb.from("profiles").select("username, display_name").eq("id", spot.owner_id).maybeSingle()
      .then(({ data }) => live && setOwner(data as { username: string; display_name: string } | null));
    sb.from("spot_groups").select("group:groups(name, short_id)").eq("spot_id", spot.id).eq("status", "accepted")
      .then(({ data }) => {
        if (!live) return;
        setGroups(((data as unknown as { group: { name: string; short_id: string } | null }[] | null) ?? []).flatMap((r) => (r.group ? [r.group] : [])));
      });
    return () => {
      live = false;
    };
  }, [spot.id, spot.owner_id]);

  if (!owner && !groups.length) return null;
  return (
    <p className="chips spot-facts">
      {owner && <Link className="chip" href={`/u/${owner.username}`}>By {owner.display_name}</Link>}
      {groups.map((g) => <Link key={g.short_id} className="chip" href={`/g/${g.short_id}`}>In {g.name}</Link>)}
    </p>
  );
}
