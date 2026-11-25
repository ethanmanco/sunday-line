import type { SpotCategory, SpotKind } from "./spots";

export interface GroupEvent {
  id: string;
  group_id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  status: "scheduled" | "cancelled";
  location_release_minutes: number | null;
  announce_on_create: boolean;
  remind_before_minutes: number | null;
  remind_day_of: boolean;
}

export interface EventLocation {
  event_id: string;
  spot_id: string | null;
  name: string;
  kind: SpotKind;
  category: SpotCategory | null;
  lat: number;
  lng: number;
  line: string | null;
  notes: string | null;
}

/** A road on a meet's route (11.87), in driving order. */
export interface EventRoad {
  event_id: string;
  position: number;
  road_id: string;
  name: string;
  from_lng: number;
  from_lat: number;
  to_lng: number;
  to_lat: number;
  line: string | null;
  miles: number | null;
}

/** An event route as day-route stops (driven from -> to), for directions and the map. */
export function routeStops(roads: EventRoad[]): import("./dayRoute").RouteStop[] {
  return [...roads].sort((a, b) => a.position - b.position).map((r) => ({
    id: r.road_id, name: r.name, near: null, state: null, cell: null,
    start: [r.from_lng, r.from_lat], end: [r.to_lng, r.to_lat], line: r.line ?? "", miles: r.miles ?? 0,
  }));
}

/** Day-route stops as what set_event_route takes. */
export function routePayload(stops: import("./dayRoute").RouteStop[]) {
  return stops.map((s) => ({
    road_id: s.id, name: s.name, line: s.line, miles: Math.round(s.miles * 10) / 10,
    from: s.reversed ? s.end : s.start, to: s.reversed ? s.start : s.end,
  }));
}

export type RsvpStatus = "going" | "maybe" | "no";

export const RSVP_LABEL: Record<RsvpStatus, string> = { going: "Going", maybe: "Maybe", no: "Can't make it" };

/** When the location is shared, before the start. null = right away. */
export const RELEASE_PRESETS: [string, number | null][] = [
  ["Right away", null],
  ["1 hour before", 60],
  ["3 hours before", 180],
  ["1 day before", 1440],
  ["2 days before", 2880],
  ["1 week before", 10080],
];

export const REMINDER_PRESETS: [string, number | null][] = [
  ["No reminder", null],
  ["1 day before", 1440],
  ["2 days before", 2880],
  ["1 week before", 10080],
];

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

/** "Sat, Nov 22, 9:00 AM" in the event's time zone (plus the zone if it differs from yours). */
export function eventWhen(iso: string, tz: string, withYear = false): string {
  const d = new Date(iso);
  const text = d.toLocaleString(undefined, {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    ...(withYear ? { year: "numeric" } : {}),
  });
  if (tz === browserTimeZone()) return text;
  const zone = d.toLocaleString(undefined, { timeZone: tz, timeZoneName: "short" }).split(" ").pop();
  return `${text} ${zone}`;
}

export function minutesText(m: number): string {
  if (m % 10080 === 0) return `${m / 10080} ${m === 10080 ? "week" : "weeks"}`;
  if (m % 1440 === 0) return `${m / 1440} ${m === 1440 ? "day" : "days"}`;
  if (m % 60 === 0) return `${m / 60} ${m === 60 ? "hour" : "hours"}`;
  return `${m} minutes`;
}

export function releaseAt(e: GroupEvent): Date | null {
  return e.location_release_minutes === null ? null : new Date(new Date(e.starts_at).getTime() - e.location_release_minutes * 60000);
}

/** For a datetime-local input: the given time in the browser's zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
