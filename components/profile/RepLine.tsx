"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useMapShell } from "@/lib/mapShell";

interface Rep {
  points: number;
  confirmed: number;
  dismissed: number;
  trusted: boolean;
}

/**
 * A member's rep (11.78): points from road checks the site admin confirmed,
 * and how often their checks held up. Accuracy is the point, so it's shown
 * next to the number. Nothing shows for members without a decided check,
 * except a pointer to Bounties on your own profile.
 */
export default function RepLine({ userId, isMe }: { userId: string; isMe: boolean }) {
  const [rep, setRep] = useState<Rep | null>(null);
  const shell = useMapShell();

  useEffect(() => {
    let live = true;
    getSupabase()?.rpc("rep_summary", { p_user: userId }).single()
      .then(({ data }) => { if (live) setRep((data as Rep | null) ?? null); });
    return () => { live = false; };
  }, [userId]);

  if (!rep) return null;
  const decided = rep.confirmed + rep.dismissed;
  if (!decided) {
    return isMe ? (
      <p className="rep-line fine">
        Rep 0. Answer{" "}
        <Link href="/" onClick={() => { shell?.setFilters({ ...shell.filters, view: "bounties", sort: "overall" }); shell?.setShowRoads(true); }}>
          Bounties
        </Link>{" "}
        near you: roads that need a check.
      </p>
    ) : null;
  }
  const right = Math.round((rep.confirmed / decided) * 100);
  return (
    <p className="rep-line">
      <b>Rep {rep.points}</b>
      <span className="fine">
        {" "}· {rep.confirmed} confirmed road {rep.confirmed === 1 ? "check" : "checks"}, {right}% right
      </span>
      {rep.trusted && <span className="trusted-badge" title="5 or more confirmed checks, at least 80% right">Trusted checker</span>}
    </p>
  );
}
