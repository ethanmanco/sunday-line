"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { linkedSpots, spotLabel, type Spot } from "@/lib/spots";
import { getRoute, type RouteStop } from "@/lib/dayRoute";
import {
  browserTimeZone, RELEASE_PRESETS, REMINDER_PRESETS, routePayload, routeStops, toLocalInput, type EventRoad, type GroupEvent,
} from "@/lib/events";

/** Create or edit a group event: when, where (a spot), when the location is shared, and chat posts. */
export default function EventForm({ groupId, userId, event, currentSpotId, onSaved, onCancel }: {
  groupId: string;
  userId: string;
  event?: GroupEvent | null;
  currentSpotId?: string | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [start, setStart] = useState(event ? toLocalInput(event.starts_at) : "");
  const [end, setEnd] = useState(event?.ends_at ? toLocalInput(event.ends_at) : "");
  const [spotId, setSpotId] = useState<string>(currentSpotId ?? "");
  const [release, setRelease] = useState<number | null>(event ? event.location_release_minutes : null);
  const [customHours, setCustomHours] = useState("");
  const [announce, setAnnounce] = useState(event?.announce_on_create ?? true);
  const [reminder, setReminder] = useState<number | null>(event ? event.remind_before_minutes : 1440);
  const [dayOf, setDayOf] = useState(event?.remind_day_of ?? true);
  const [groupSpots, setGroupSpots] = useState<Spot[]>([]);
  const [mySpots, setMySpots] = useState<Spot[]>([]);
  const [publicSpots, setPublicSpots] = useState<Spot[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The roads the group will drive (11.87), and whether they changed.
  const [route, setRouteStops] = useState<RouteStop[]>([]);
  const [routeChanged, setRouteChanged] = useState(false);
  const [dayRouteCount, setDayRouteCount] = useState(0);

  useEffect(() => {
    setDayRouteCount(getRoute().length);
    const sb = getSupabase();
    if (!sb || !event) return;
    sb.from("event_roads").select("*").eq("event_id", event.id).then(({ data }) => {
      setRouteStops(routeStops((data as EventRoad[] | null) ?? []));
    });
  }, [event]);
  const changeRoute = (r: RouteStop[]) => {
    setRouteStops(r);
    setRouteChanged(true);
  };

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    Promise.all([
      sb.from("spot_groups").select("status, spot:spots!inner(*)").eq("group_id", groupId).eq("status", "accepted"),
      sb.from("spots").select("*").eq("owner_id", userId).order("name"),
    ]).then(([g, m]) => {
      const inGroup = linkedSpots(g.data).sort((a, b) => a.name.localeCompare(b.name));
      const ids = new Set(inGroup.map((s) => s.id));
      setGroupSpots(inGroup);
      setMySpots(((m.data as Spot[] | null) ?? []).filter((s) => !ids.has(s.id)));
    });
  }, [groupId, userId]);

  // Public spots, searched by name.
  useEffect(() => {
    const sb = getSupabase();
    const term = q.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim();
    if (!sb || term.length < 2) {
      setPublicSpots([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await sb.from("spots").select("*").eq("public_status", "approved").ilike("name", `%${term}%`).limit(20);
      setPublicSpots((data as Spot[] | null) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const isPreset = RELEASE_PRESETS.some(([, v]) => v === release);
  const custom = !isPreset;
  const releaseLabel = useMemo(() => {
    if (!start || release === null) return null;
    const at = new Date(new Date(start).getTime() - release * 60000);
    return at.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }, [start, release]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setError(null);
    if (!start) return setError("Pick a start date and time.");
    const startsAt = new Date(start);
    if (!event && startsAt.getTime() < Date.now()) return setError("The start time has already passed.");
    if (end && new Date(end) <= startsAt) return setError("The end has to be after the start.");
    if (custom && (release === null || release < 0 || release > 20160)) return setError("Custom release is 0 to 336 hours before.");
    const row = {
      title: title.trim(),
      description: description.trim() || null,
      starts_at: startsAt.toISOString(),
      ends_at: end ? new Date(end).toISOString() : null,
      timezone: event?.timezone ?? browserTimeZone(),
      location_release_minutes: release,
      announce_on_create: announce,
      remind_before_minutes: reminder,
      remind_day_of: dayOf,
    };
    setBusy(true);
    let id = event?.id ?? null;
    if (event) {
      const { error } = await sb.from("events").update(row).eq("id", event.id);
      if (error) {
        setBusy(false);
        return setError("Couldn't save. Titles are 3 to 80 characters.");
      }
    } else {
      const { data, error } = await sb.from("events").insert({ ...row, group_id: groupId }).select("id").single();
      if (error || !data) {
        setBusy(false);
        return setError("Couldn't create the event. Titles are 3 to 80 characters.");
      }
      id = (data as { id: string }).id;
    }
    if (id && spotId !== (currentSpotId ?? "")) {
      const { error } = await sb.rpc("set_event_location", { p_event: id, p_spot: spotId || null });
      if (error) {
        setBusy(false);
        return setError("Saved, but the location couldn't be set. Pick another spot.");
      }
    }
    if (id && routeChanged) {
      const { error } = await sb.rpc("set_event_route", { p_event: id, p_roads: routePayload(route) });
      if (error) {
        setBusy(false);
        return setError("Saved, but the route couldn't be set. Try again.");
      }
    }
    setBusy(false);
    if (id) onSaved(id);
  }

  const option = (s: Spot) => <option key={s.id} value={s.id}>{s.name} ({spotLabel(s)})</option>;

  return (
    <form onSubmit={save} className="form spot-editor event-form">
      <h3>{event ? "Edit event" : "New event"}</h3>
      <label>
        <span>Title</span>
        <input required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday morning loop" />
      </label>
      <div className="row two">
        <label>
          <span>Starts</span>
          <input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span>Ends (optional)</span>
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label>
        <span>Details (optional)</span>
        <textarea maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Route, pace, what to bring" />
      </label>

      <fieldset>
        <legend>Location</legend>
        <select value={spotId} onChange={(e) => setSpotId(e.target.value)} aria-label="Location spot">
          <option value="">No location yet</option>
          {groupSpots.length > 0 && <optgroup label="This group's spots">{groupSpots.map(option)}</optgroup>}
          {mySpots.length > 0 && <optgroup label="Your spots">{mySpots.map(option)}</optgroup>}
          {publicSpots.length > 0 && <optgroup label="Public spots">{publicSpots.map(option)}</optgroup>}
        </select>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search public spots by name" aria-label="Search public spots" />
        <span className="fine">Add new places on the group&apos;s Spots tab or in your spots first.</span>
      </fieldset>

      <fieldset>
        <legend>Route (optional)</legend>
        {route.length > 0 ? (
          <ol className="event-route-edit">
            {route.map((s) => (
              <li key={s.id}>
                <span>{s.name}</span>
                <button type="button" className="link danger" aria-label={`Take ${s.name} off the route`}
                  onClick={() => changeRoute(route.filter((x) => x.id !== s.id))}>Remove</button>
              </li>
            ))}
          </ol>
        ) : (
          <span className="fine">The roads you&apos;ll drive, in order. Build a day route first (on any road, &ldquo;Add to day route&rdquo;), then add it here.</span>
        )}
        <div className="row">
          {dayRouteCount > 0 && (
            <button type="button" className="link" onClick={() => changeRoute(getRoute())}>
              {route.length ? "Replace with" : "Use"} my day route ({dayRouteCount} {dayRouteCount === 1 ? "road" : "roads"})
            </button>
          )}
          {route.length > 0 && <button type="button" className="link danger" onClick={() => changeRoute([])}>Clear the route</button>}
        </div>
        <span className="fine">Members see the route when they see the location.</span>
      </fieldset>

      <fieldset>
        <legend>Share the location with members</legend>
        <div className="seg">
          {RELEASE_PRESETS.map(([label, v]) => (
            <button key={label} type="button" aria-pressed={release === v} onClick={() => { setRelease(v); setCustomHours(""); }}>{label}</button>
          ))}
          <button type="button" aria-pressed={custom} onClick={() => { setRelease(Number(customHours || 6) * 60); setCustomHours(customHours || "6"); }}>Custom</button>
        </div>
        {custom && (
          <label className="inline">
            <input type="number" min={0} max={336} value={customHours}
              onChange={(e) => { setCustomHours(e.target.value); setRelease(e.target.value === "" ? null : Math.round(Number(e.target.value) * 60)); }} />
            <span>hours before the start</span>
          </label>
        )}
        <span className="fine">
          {release === null ? "Members see the location as soon as you save." : releaseLabel ? `Members see it ${releaseLabel}. Until then only event managers do.` : "Pick a start time to see when."}
        </span>
      </fieldset>

      <fieldset>
        <legend>Posts in the group chat</legend>
        <label className="check">
          <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
          <span>When the event is created{event ? " (and if it's canceled or the time changes)" : ""}</span>
        </label>
        <div className="seg">
          {REMINDER_PRESETS.map(([label, v]) => (
            <button key={label} type="button" aria-pressed={reminder === v} onClick={() => setReminder(v)}>{label}</button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={dayOf} onChange={(e) => setDayOf(e.target.checked)} />
          <span>The day of (8 AM, or an hour before an early start)</span>
        </label>
        <span className="fine">When the location is shared later, a post says it&apos;s out without naming the place.</span>
      </fieldset>

      <div className="row">
        <button type="submit" className="button" disabled={busy}>{busy ? "Saving..." : event ? "Save event" : "Create event"}</button>
        <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="hint warn" role="alert">{error}</p>}
    </form>
  );
}
