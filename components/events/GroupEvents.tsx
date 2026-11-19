"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import EventForm from "./EventForm";
import { can, type Membership } from "@/components/groups/GroupView";
import { getSupabase, type Group } from "@/lib/supabase";
import { eventWhen, type GroupEvent } from "@/lib/events";

/** A group's upcoming and recent events. Event managers create them here. */
export default function GroupEvents({ group, me, myId }: { group: Group; me: Membership; myId: string }) {
  const router = useRouter();
  const [events, setEvents] = useState<GroupEvent[] | null>(null);
  const [going, setGoing] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const manager = can(me, "events");

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const since = new Date(Date.now() - (showPast ? 365 : 1) * 86400000).toISOString();
    const { data } = await sb.from("events").select("*").eq("group_id", group.id).gte("starts_at", since).order("starts_at").limit(100);
    const list = (data as GroupEvent[] | null) ?? [];
    setEvents(list);
    if (list.length) {
      const { data: r } = await sb.from("event_rsvps").select("event_id, user_id, status").in("event_id", list.map((e) => e.id));
      const rows = (r as { event_id: string; user_id: string; status: string }[] | null) ?? [];
      const counts: Record<string, number> = {};
      const my: Record<string, string> = {};
      for (const x of rows) {
        if (x.status === "going") counts[x.event_id] = (counts[x.event_id] ?? 0) + 1;
        if (x.user_id === myId) my[x.event_id] = x.status;
      }
      setGoing(counts);
      setMine(my);
    }
  }, [group.id, myId, showPast]);

  useEffect(() => {
    load();
  }, [load]);

  const now = Date.now();
  const upcoming = (events ?? []).filter((e) => new Date(e.starts_at).getTime() >= now - 6 * 3600000);
  const past = (events ?? []).filter((e) => new Date(e.starts_at).getTime() < now - 6 * 3600000).reverse();

  const row = (e: GroupEvent) => (
    <li key={e.id}>
      <Link href={`/e/${e.id}`} className={`event-row${e.status === "cancelled" ? " cancelled" : ""}`}>
        <span className="event-date" aria-hidden="true">
          <b>{new Date(e.starts_at).toLocaleString(undefined, { timeZone: e.timezone, day: "numeric" })}</b>
          <span>{new Date(e.starts_at).toLocaleString(undefined, { timeZone: e.timezone, month: "short" })}</span>
        </span>
        <span className="event-text">
          <b>{e.title}</b>
          <span className="fine">
            {[
              e.status === "cancelled" ? "Canceled" : eventWhen(e.starts_at, e.timezone),
              going[e.id] ? `${going[e.id]} going` : null,
              mine[e.id] === "going" ? "You're going" : mine[e.id] === "maybe" ? "You're a maybe" : null,
            ].filter(Boolean).join(" · ")}
          </span>
        </span>
      </Link>
    </li>
  );

  return (
    <div className="group-events">
      {creating ? (
        <EventForm groupId={group.id} userId={myId} onSaved={(id) => router.push(`/e/${id}`)} onCancel={() => setCreating(false)} />
      ) : (
        manager && <p><button type="button" className="button" onClick={() => setCreating(true)}>New event</button></p>
      )}
      <h2>Coming up</h2>
      {!events ? <p className="fine">Loading...</p> : upcoming.length === 0 ? (
        <p className="fine">No events planned.{manager ? " Make the first one." : ""}</p>
      ) : (
        <ul className="event-list">{upcoming.map(row)}</ul>
      )}
      {showPast ? (
        past.length > 0 && (
          <>
            <h2>Past events</h2>
            <ul className="event-list">{past.map(row)}</ul>
          </>
        )
      ) : (
        <button type="button" className="link" onClick={() => setShowPast(true)}>Show past events</button>
      )}
    </div>
  );
}
