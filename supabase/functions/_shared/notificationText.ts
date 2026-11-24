// What each notification says and where it goes (11.40). Shared by the app
// (lib/notifications.ts) and the push sender (supabase/functions/push), so a
// push reads exactly like the list. Plain TypeScript: no imports.

export type NotificationKind =
  | "follow_request" | "new_follower" | "follow_accepted"
  | "group_invite" | "join_request" | "join_approved"
  | "event_new" | "event_changed" | "event_cancelled" | "event_soon" | "event_location"
  | "message" | "mention"
  | "road_scored" | "spot_reviewed" | "group_spot_proposed" | "group_spot_accepted"
  | "road_check_helped" | "admin_road_check" | "admin_spot_review";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  actor_id: string | null;
  group_id: string | null;
  event_id: string | null;
  spot_id: string | null;
  conversation_id: string | null;
  road_id: string | null;
  title: string | null;
  detail: { count?: number; starts_at?: string; status?: string; note?: string | null; kind?: string; spot?: string };
  created_at: string;
  read_at: string | null;
  actor: { username: string; display_name: string } | null;
  group: { short_id: string } | null;
}

const CHECK_WORDS: Record<string, string> = {
  gravel: "gravel or dirt",
  private: "private or no entry",
  closed: "closed",
  rough: "poor pavement",
};

function when(iso?: string, tz?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!tz) return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  // Pushes are written on the server, so they use the event's own time zone
  // and name it (11.77): "Sat, Nov 29, 9:00 AM CST".
  try {
    const text = d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const zone = d.toLocaleString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop();
    return zone ? `${text} ${zone}` : text;
  } catch {
    return when(iso);
  }
}

/** The sentence and the link for a notification. `roadName` fills in road names looked up from the road data. */
export function describe(n: AppNotification, roadName: (id: string) => string): { text: string; href: string } {
  const who = n.actor?.display_name ?? "Someone";
  const profile = n.actor ? `/u/${n.actor.username}` : "/me";
  const group = n.group ? `/g/${n.group.short_id}` : "/groups";
  const title = n.title ?? "";
  const road = n.road_id ? roadName(n.road_id) : "a road";
  switch (n.kind) {
    case "follow_request": return { text: `${who} asked to follow you`, href: profile };
    case "new_follower": return { text: `${who} started following you`, href: profile };
    case "follow_accepted": return { text: `${who} accepted your follow request`, href: profile };
    case "group_invite": return { text: `${who} invited you to join ${title}`, href: group };
    case "join_request": return { text: `${who} asked to join ${title}`, href: `${group}?tab=manage` };
    case "join_approved": return { text: `You're in! ${title} approved your request`, href: group };
    case "event_new": return { text: `New event: ${title}, ${when(n.detail.starts_at)}`, href: `/e/${n.event_id}` };
    case "event_changed": return { text: `New time for ${title}: ${when(n.detail.starts_at)}`, href: `/e/${n.event_id}` };
    case "event_cancelled": return { text: `${title} was canceled`, href: `/e/${n.event_id}` };
    case "event_soon": return { text: `Coming up: ${title}, ${when(n.detail.starts_at)}`, href: `/e/${n.event_id}` };
    case "event_location": return { text: `The location for ${title} is out`, href: `/e/${n.event_id}` };
    case "message": {
      const k = n.detail.count ?? 1;
      return n.title
        ? { text: `${k} new ${k === 1 ? "message" : "messages"} in ${title}`, href: `/messages/${n.conversation_id}` }
        : { text: `${who} sent you ${k === 1 ? "a message" : `${k} messages`}`, href: `/messages/${n.conversation_id}` };
    }
    case "mention":
      return n.title
        ? { text: `${who} mentioned you in ${title}`, href: `/messages/${n.conversation_id}` }
        : { text: `${who} mentioned you in a message`, href: `/messages/${n.conversation_id}` };
    case "road_scored":
      return n.detail.status === "done"
        ? { text: `${title} has its scores`, href: `/?spot=${n.spot_id}` }
        : { text: `We couldn't score ${title}. Try drawing it again.`, href: `/?spot=${n.spot_id}` };
    case "spot_reviewed":
      return n.detail.status === "approved"
        ? { text: `${title} is on the public map`, href: `/?spot=${n.spot_id}` }
        : { text: `${title} wasn't added to the public map${n.detail.note ? `: ${n.detail.note}` : ""}`, href: `/?spot=${n.spot_id}` };
    case "group_spot_proposed": return { text: `${who} suggested ${n.detail.spot ?? "a spot"} for ${title}`, href: `${group}?tab=spots` };
    case "group_spot_accepted": return { text: `${n.detail.spot ?? "Your spot"} was added to ${title}`, href: `${group}?tab=spots` };
    case "road_check_helped":
      return { text: `Your flag helped mark ${road} as ${CHECK_WORDS[n.detail.kind ?? ""] ?? "checked"}. Thanks!`, href: `/road/${n.road_id}` };
    case "admin_road_check":
      return { text: `Road check waiting: ${road} (${CHECK_WORDS[n.detail.kind ?? ""] ?? n.detail.kind})`, href: "/admin/roads" };
    case "admin_spot_review": return { text: `Spot waiting for review: ${title}`, href: "/admin/spots" };
  }
}

/**
 * A push notification's bold title and its text (11.76). The phone already
 * shows the app's name above it, so the title says who or what it's about.
 * `said` is the start of the latest message, for message and mention pushes.
 */
export function pushText(
  n: AppNotification,
  roadName: (id: string) => string,
  said?: { body: string | null; photo: boolean } | null,
  timeZone?: string,
): { title: string; body: string } {
  const who = n.actor?.display_name ?? "Someone";
  const title = n.title ?? "";
  const road = n.road_id ? roadName(n.road_id) : "A road";
  const quote = said ? (said.body ? clip(said.body) : said.photo ? "Sent a photo" : null) : null;
  const k = n.detail.count ?? 1;
  switch (n.kind) {
    case "follow_request": return { title: who, body: "Asked to follow you" };
    case "new_follower": return { title: who, body: "Started following you" };
    case "follow_accepted": return { title: who, body: "Accepted your follow request" };
    case "group_invite": return { title: who, body: `Invited you to join ${title}` };
    case "join_request": return { title, body: `${who} asked to join` };
    case "join_approved": return { title, body: "You're in! Your request was approved" };
    case "event_new": return { title, body: `New drive, ${when(n.detail.starts_at, timeZone)}` };
    case "event_changed": return { title, body: `New time: ${when(n.detail.starts_at, timeZone)}` };
    case "event_cancelled": return { title, body: "Canceled" };
    case "event_soon": return { title, body: `Coming up: ${when(n.detail.starts_at, timeZone)}` };
    case "event_location": return { title, body: "The location is out" };
    case "message":
      if (n.title) return { title, body: quote ? `${who}: ${quote}` : `${k} new ${k === 1 ? "message" : "messages"}` };
      return { title: who, body: quote ?? (k === 1 ? "Sent you a message" : `Sent you ${k} messages`) };
    case "mention":
      if (n.title) return { title, body: quote ? `${who} mentioned you: ${quote}` : `${who} mentioned you` };
      return { title: who, body: quote ? `Mentioned you: ${quote}` : "Mentioned you in a message" };
    case "road_scored":
      return n.detail.status === "done"
        ? { title, body: "Has its scores" }
        : { title, body: "Couldn't be scored. Try drawing it again." };
    case "spot_reviewed":
      return n.detail.status === "approved"
        ? { title, body: "Is on the public map" }
        : { title, body: `Wasn't added to the public map${n.detail.note ? `: ${n.detail.note}` : ""}` };
    case "group_spot_proposed": return { title, body: `${who} suggested ${n.detail.spot ?? "a spot"}` };
    case "group_spot_accepted": return { title, body: `${n.detail.spot ?? "Your spot"} was added` };
    case "road_check_helped":
      return { title: road, body: `Your flag helped mark it as ${CHECK_WORDS[n.detail.kind ?? ""] ?? "checked"}. Thanks!` };
    case "admin_road_check":
      return { title: "Road check waiting", body: `${road} (${CHECK_WORDS[n.detail.kind ?? ""] ?? n.detail.kind})` };
    case "admin_spot_review": return { title: "Spot waiting for review", body: title };
  }
  return { title: "Sunday Line", body: describe(n, roadName).text };
}

/** One line of a message, at most about 140 characters. */
function clip(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 140 ? `${one.slice(0, 139).trimEnd()}…` : one;
}
