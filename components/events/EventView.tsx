"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import PersonRow from "@/components/profile/PersonRow";
import EventForm from "./EventForm";
import { can, type Membership } from "@/components/groups/GroupView";
import { directionsLinks } from "@/lib/roads";
import { getSupabase, PROFILE_COLUMNS, rememberReturn, type Group, type Profile } from "@/lib/supabase";
import { loadRoads, spotLabel, type Spot } from "@/lib/spots";
import {
  eventWhen, minutesText, releaseAt, RSVP_LABEL, type EventLocation, type GroupEvent, type RsvpStatus,
} from "@/lib/events";

const SpotMap = dynamic(() => import("@/components/spots/SpotMap"), { ssr: false, loading: () => <div className="spot-map map-loading" /> });

interface Rsvp {
  user_id: string;
  status: RsvpStatus;
  person: Profile | null;
}

export default function EventView({ eventId }: { eventId: string }) {
  const router = useRouter();
  const { ready, user } = useAuth();
  const [event, setEvent] = useState<GroupEvent | null>(null);
  const [missing, setMissing] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [me, setMe] = useState<Membership | null>(null);
  const [location, setLocation] = useState<EventLocation | null>(null);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user || !/^[0-9a-f-]{36}$/.test(eventId)) {
      setMissing(true);
      return;
    }
    const { data } = await sb.from("events").select("*").eq("id", eventId).maybeSingle();
    if (!data) {
      setMissing(true);
      return;
    }
    const ev = data as GroupEvent;
    setEvent(ev);
    const [g, m, l, r] = await Promise.all([
      sb.from("groups").select("*").eq("id", ev.group_id).single(),
      sb.from("group_members").select("role, permissions").eq("group_id", ev.group_id).eq("user_id", user.id).maybeSingle(),
      sb.from("event_locations").select("*").eq("event_id", ev.id).maybeSingle(),
      sb.from("event_rsvps").select(`user_id, status, person:profiles!event_rsvps_user_id_fkey(${PROFILE_COLUMNS})`).eq("event_id", ev.id),
    ]);
    setGroup((g.data as Group | null) ?? null);
    setMe((m.data as Membership | null) ?? null);
    setLocation((l.data as EventLocation | null) ?? null);
    setRsvps((r.data as unknown as Rsvp[]) ?? []);
  }, [eventId, user]);

  useEffect(() => {
    if (ready) load();
    loadRoads().then((d) => setBbox(d.bbox)).catch(() => setBbox([-95, 31, -92, 34]));
  }, [ready, load]);

  // Check again when the location is due, so it appears without a reload.
  useEffect(() => {
    if (!event || location) return;
    const at = releaseAt(event);
    if (!at) return;
    const wait = at.getTime() - Date.now();
    if (wait < 0 || wait > 6 * 3600000) return;
    const t = setTimeout(load, wait + 2000);
    return () => clearTimeout(t);
  }, [event, location, load]);

  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user) {
    return (
      <div className="page narrow">
        <h1>Event</h1>
        <p><Link href="/signin" onClick={() => rememberReturn(`/e/${eventId}`)}>Sign in</Link> to see this event. Events are for group members.</p>
      </div>
    );
  }
  if (missing) {
    return <div className="page narrow"><h1>Event not found</h1><p>It may be in a group you&apos;re not in, or it was deleted. <Link href="/groups">Your groups</Link></p></div>;
  }
  if (!event || !group) return <div className="page narrow"><p>Loading...</p></div>;

  const ev = event;
  const manager = can(me, "events");
  const sb = getSupabase()!;
  const my = rsvps.find((r) => r.user_id === user.id)?.status ?? null;
  const release = releaseAt(ev);
  const past = new Date(ev.starts_at).getTime() < Date.now() - 6 * 3600000;

  async function rsvp(status: RsvpStatus) {
    setBusy(true);
    if (my === status) await sb.from("event_rsvps").delete().eq("event_id", ev.id).eq("user_id", user!.id);
    else if (my) await sb.from("event_rsvps").update({ status }).eq("event_id", ev.id).eq("user_id", user!.id);
    else await sb.from("event_rsvps").insert({ event_id: ev.id, status });
    setBusy(false);
    load();
  }

  async function cancel() {
    if (!window.confirm(`Cancel ${ev.title}?${ev.announce_on_create ? " The group chat gets a post." : ""}`)) return;
    await sb.from("events").update({ status: "cancelled" }).eq("id", ev.id);
    load();
  }

  async function remove() {
    if (!window.confirm(`Delete ${ev.title} for everyone? This can't be undone.`)) return;
    await sb.from("events").delete().eq("id", ev.id);
    router.replace(`/g/${group!.short_id}`);
  }

  if (editing) {
    return (
      <div className="page narrow">
        <EventForm
          groupId={ev.group_id}
          userId={user.id}
          event={ev}
          currentSpotId={location?.spot_id ?? null}
          onSaved={() => { setEditing(false); load(); }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const asSpot: Spot[] = location
    ? [{
      id: `event-${ev.id}`, owner_id: "", kind: location.kind, name: location.name, description: null, category: location.category,
      lat: location.lat, lng: location.lng, road_id: null, road_region: null, start_frac: null, end_frac: null, line: location.line,
      group_id: null, group_status: null, show_on_profile: false, public_status: "none", public_note: null,
      submitted_at: null, reviewed_at: null, created_at: "",
    }]
    : [];
  const byStatus = (s: RsvpStatus) => rsvps.filter((r) => r.status === s && r.person);
  const locationHidden = !location && release && release.getTime() > Date.now();

  return (
    <div className="page narrow event-page">
      <p className="fine"><Link href={`/g/${group.short_id}`}>{group.name}</Link></p>
      <h1>{ev.title}</h1>
      {ev.status === "cancelled" && <p className="hint warn">This event was canceled.</p>}
      <p className="event-when">
        <b>{eventWhen(ev.starts_at, ev.timezone, true)}</b>
        {ev.ends_at && <> to {eventWhen(ev.ends_at, ev.timezone)}</>}
      </p>
      {ev.description && <p className="bio">{ev.description}</p>}

      <section aria-labelledby="where">
        <h2 id="where">Where</h2>
        {location ? (
          <>
            <p>
              <b>{location.name}</b> <span className="fine">{spotLabel({ kind: location.kind, category: location.category })}</span>
            </p>
            {location.notes && <p className="fine">{location.notes}</p>}
            {bbox && <SpotMap spots={asSpot} fallbackBbox={bbox} fitKey={ev.id} />}
            <p className="fine">
              {location.kind === "road" ? "Directions to the start: " : "Directions: "}
              {directionsLinks([location.lng, location.lat]).map((l, i) => (
                <span key={l.label}>{i > 0 && " · "}<a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a></span>
              ))}
            </p>
            {manager && release && release.getTime() > Date.now() && (
              <p className="fine">Members see this {release.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. You see it now because you manage events.</p>
            )}
          </>
        ) : locationHidden ? (
          <p className="panel-note">
            The location is shared {minutesText(ev.location_release_minutes!)} before the start:{" "}
            <b>{release!.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>.
          </p>
        ) : (
          <p className="fine">No location yet.</p>
        )}
      </section>

      {ev.status === "scheduled" && !past && me && (
        <section aria-labelledby="rsvp">
          <h2 id="rsvp">Are you going?</h2>
          <div className="seg">
            {(Object.keys(RSVP_LABEL) as RsvpStatus[]).map((s) => (
              <button key={s} type="button" aria-pressed={my === s} disabled={busy} onClick={() => rsvp(s)}>{RSVP_LABEL[s]}</button>
            ))}
          </div>
        </section>
      )}

      {(["going", "maybe"] as RsvpStatus[]).map((s) => byStatus(s).length > 0 && (
        <section key={s}>
          <h3>{RSVP_LABEL[s]} ({byStatus(s).length})</h3>
          <ul className="people">{byStatus(s).map((r) => <PersonRow key={r.user_id} person={r.person!} />)}</ul>
        </section>
      ))}

      {manager && (
        <section aria-labelledby="manage-event">
          <h2 id="manage-event">Manage</h2>
          <p className="fine">
            Chat posts: {[
              ev.announce_on_create ? "when created" : null,
              ev.remind_before_minutes ? `${minutesText(ev.remind_before_minutes)} before` : null,
              ev.remind_day_of ? "the day of" : null,
            ].filter(Boolean).join(", ") || "none"}.
          </p>
          <div className="row">
            <button type="button" className="button ghost small" onClick={() => setEditing(true)}>Edit</button>
            {ev.status === "scheduled" && <button type="button" className="button ghost small" onClick={cancel}>Cancel event</button>}
            {ev.status === "cancelled" && (
              <button type="button" className="button ghost small" onClick={async () => { await sb.from("events").update({ status: "scheduled" }).eq("id", ev.id); load(); }}>
                Put it back on
              </button>
            )}
            <button type="button" className="link danger" onClick={remove}>Delete</button>
          </div>
        </section>
      )}
    </div>
  );
}
