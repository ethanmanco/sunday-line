"use client";

import { useEffect, useState } from "react";
import PersonRow from "@/components/profile/PersonRow";
import { getSupabase, type Group, type Profile } from "@/lib/supabase";

interface Summary {
  organizer_username: string | null;
  organizer_display_name: string | null;
  organizer_avatar_path: string | null;
  organizer_avatar_preset: string | null;
  upcoming_events: number;
}

/**
 * What someone outside a public group sees (11.96): who runs it, how many
 * events are coming up, and how joining works. Never event titles, dates,
 * places, or the member list; the database hands out only these.
 */
export default function GroupVisitorInfo({ group }: { group: Group }) {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    let live = true;
    getSupabase()?.rpc("group_visitor_summary", { p_group: group.id }).maybeSingle()
      .then(({ data }) => { if (live) setS((data as Summary | null) ?? null); });
    return () => { live = false; };
  }, [group.id]);

  const organizer = s?.organizer_username
    ? ({
        username: s.organizer_username,
        display_name: s.organizer_display_name ?? s.organizer_username,
        avatar_path: s.organizer_avatar_path,
        avatar_preset: s.organizer_avatar_preset,
      } as Profile)
    : null;
  const started = new Date(group.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const n = s?.upcoming_events ?? 0;

  return (
    <section className="visitor-info" aria-label="About this group">
      {organizer && (
        <ul className="people">
          <PersonRow person={organizer} note="Organizer" />
        </ul>
      )}
      <ul className="facts">
        {s && (
          <li>
            <b>{n ? `${n} upcoming ${n === 1 ? "event" : "events"}` : "No events planned right now"}</b>
            {n > 0 && <span className="fine"> · members see the dates and meet spots</span>}
          </li>
        )}
        <li>{group.join_policy === "open" ? "Anyone can join" : "The organizers approve new members"}</li>
        <li>Started {started}</li>
      </ul>
    </section>
  );
}
