import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { thumbPath } from "./images";

// Both values are public. Row level security in the database decides what
// anyone can read or change.
const URL = projectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || undefined;

/** Accepts the full project URL or just the project ID. Anything else turns
 * accounts off instead of breaking the page. */
function projectUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim().replace(/\/+$/, "");
  if (!v) return undefined;
  if (/^[a-z0-9]{20}$/.test(v)) return `https://${v}.supabase.co`;
  return /^https?:\/\/[^\s/]+/.test(v) ? v : undefined;
}

/** For server-side reads with the public key (share previews, page titles). */
export const supabaseRest = URL && KEY ? { url: URL, key: KEY } : null;

let client: SupabaseClient | null = null;

/** True when this build has Supabase settings (accounts and ratings turn on). */
export const accountsEnabled = Boolean(URL && KEY);

/** True when the sign-in email has the 6-digit code (our own template, which
 * Supabase only allows with a custom email sender). Otherwise it has a link only. */
// The sign-in email carries a 6-digit code (supabase/templates/sign_in.html in
// the Supabase dashboard), so the sign-in page asks for it. That's what lets the
// installed app sign in: on iPhone a tapped link opens the browser, not the app.
// NEXT_PUBLIC_EMAIL_HAS_CODE=0 switches back to link-only.
export const emailHasCode = process.env.NEXT_PUBLIC_EMAIL_HAS_CODE !== "0";

/** The browser Supabase client, or null when accounts are not set up. */
export function getSupabase(): SupabaseClient | null {
  if (!accountsEnabled || typeof window === "undefined") return null;
  // Implicit flow: the emailed sign-in link works on any device, not only the
  // browser that asked for it. Sessions live in this browser's storage.
  if (!client) {
    try {
      client = createClient(URL!, KEY!, { auth: { flowType: "implicit", persistSession: true, autoRefreshToken: true } });
    } catch {
      return null; // A bad setting should hide accounts, not break the road pages.
    }
  }
  return client;
}

/** Usernames: 3 to 20 lowercase letters, numbers, or underscores (the database enforces this too). */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Kept in step with the username_not_reserved check in the database. */
export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "support", "help", "sundayline", "sunday_line", "official", "staff",
  "mod", "moderator", "root", "system", "api", "about", "me", "signin", "settings", "null", "undefined",
]);

/** Turns what someone typed into username form: lowercase, spaces to underscores, other symbols dropped. */
export function cleanUsername(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

export type PavementCondition = "smooth" | "patchy" | "rough" | "loose_gravel";
export type TrafficLevel = "empty" | "light" | "busy";
export type VehicleKind = "car" | "motorcycle";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_path: string | null;
  avatar_preset: string | null;
  banner_path: string | null;
  is_private: boolean;
  dm_policy: DmPolicy;
  spots_display: "all" | "selected" | "groups" | "none";
}

/** Extra columns only loaded for your own profile. */
export interface OwnProfile extends Profile {
  avatar_source_path: string | null;
  avatar_crop: CropBox | null;
  banner_source_path: string | null;
  banner_crop: CropBox | null;
}

export interface CropBox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export type DmPolicy = "everyone" | "following" | "nobody";

/** Columns safe to show anyone. */
export const PROFILE_COLUMNS = "id, username, display_name, bio, avatar_path, avatar_preset, banner_path, is_private, dm_policy, spots_display";
export const OWN_PROFILE_COLUMNS = `${PROFILE_COLUMNS}, avatar_source_path, avatar_crop, banner_source_path, banner_crop`;

export interface Vehicle {
  id: string;
  user_id: string;
  kind: VehicleKind;
  year: number | null;
  make: string | null;
  model: string;
  sort: number;
}

export interface VehiclePhoto {
  id: string;
  vehicle_id: string;
  user_id: string;
  path: string;
  sort: number;
  created_at: string;
}

/** Cover first, then upload order. */
export function sortPhotos<T extends { sort: number; created_at: string }>(photos: T[]): T[] {
  return [...photos].sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
}

export type GroupVisibility = "public" | "private";
export type JoinPolicy = "open" | "request";
export type GroupRole = "organizer" | "moderator" | "member";
export type GroupPermission = "approve" | "remove" | "invites" | "spots" | "events";

export const PERMISSION_LABEL: Record<GroupPermission, string> = {
  approve: "Approve join requests",
  remove: "Remove members",
  invites: "Make and revoke invite links",
  spots: "Add, accept, and publish group spots",
  events: "Create and change events (and see locations before they're shared)",
};

export interface Group {
  id: string;
  short_id: string;
  name: string;
  description: string | null;
  home_area: string | null;
  visibility: GroupVisibility;
  join_policy: JoinPolicy;
  created_at: string;
  avatar_path: string | null;
  avatar_source_path: string | null;
  avatar_crop: CropBox | null;
  banner_path: string | null;
  banner_source_path: string | null;
  banner_crop: CropBox | null;
  /** Palette index 0-6 (lib/spots GROUP_COLORS), 11.48. */
  color: number;
}

/** Group pictures are private files: short-lived signed links for people who can see the group. */
export async function signedGroupUrls(paths: (string | null)[]): Promise<Record<string, string>> {
  return signCached("group-images", paths.filter((p): p is string => !!p));
}

// Signed links are reused while they have time left (11.94). A fresh link is a
// new address, so the browser would download the same photo again; reusing it
// lets going back to a profile or group show photos from the browser's cache.
// Keyed by who is signed in, so a link is never handed to someone else.
const SIGN_SECONDS = 3600;
const signCache = new Map<string, { url: string | null; until: number }>();

async function signCached(bucket: string, paths: string[]): Promise<Record<string, string>> {
  const sb = getSupabase();
  const out: Record<string, string> = {};
  if (!sb || !paths.length) return out;
  const who = (await sb.auth.getSession()).data.session?.user.id ?? "anon";
  const now = Date.now();
  const need: string[] = [];
  for (const p of new Set(paths)) {
    const hit = signCache.get(`${who}|${bucket}|${p}`);
    if (hit && hit.until > now) {
      if (hit.url) out[p] = hit.url;
    } else need.push(p);
  }
  if (!need.length) return out;
  const { data } = await sb.storage.from(bucket).createSignedUrls(need, SIGN_SECONDS);
  const found = new Set<string>();
  for (const d of data ?? []) {
    if (!d.path || !d.signedUrl) continue;
    out[d.path] = d.signedUrl;
    found.add(d.path);
    // Hand it out for 50 of its 60 minutes, so a page never gets one about to lapse.
    signCache.set(`${who}|${bucket}|${d.path}`, { url: d.signedUrl, until: now + (SIGN_SECONDS - 600) * 1000 });
  }
  // Missing files (a photo without a small copy yet): don't ask again for a few minutes.
  for (const p of need) if (!found.has(p)) signCache.set(`${who}|${bucket}|${p}`, { url: null, until: now + 5 * 60_000 });
  return out;
}

/** Forget cached links for these files (after uploading or removing them). */
export function forgetSigned(bucket: string, paths: string[]) {
  for (const key of [...signCache.keys()]) if (paths.some((p) => key.endsWith(`|${bucket}|${p}`))) signCache.delete(key);
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: GroupRole;
  permissions: string[];
  joined_at: string;
  person: Profile | null;
}

export interface ConversationSummary {
  id: string;
  kind: "direct" | "group";
  group_name: string | null;
  group_short_id: string | null;
  other_id: string | null;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar_path: string | null;
  other_avatar_preset: string | null;
  last_message_at: string | null;
  last_body: string | null;
  last_has_media: boolean | null;
  last_sender_id: string | null;
  unread: number;
  can_send: boolean;
  /** Direct chats: your messages wait until they accept your follow request (11.75). */
  waiting: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  /** null for posts from Sunday Line itself (event announcements). */
  sender_id: string | null;
  event_id?: string | null;
  body: string | null;
  media_path: string | null;
  media_kind: "image" | "gif" | null;
  created_at: string;
  edited_at: string | null;
}

/** Signed links for chat photos (only people in the conversation get them). */
export async function signedChatUrls(paths: string[]): Promise<Record<string, string>> {
  const sb = getSupabase();
  const out: Record<string, string> = {};
  if (!sb || !paths.length) return out;
  const { data } = await sb.storage.from("message-media").createSignedUrls(paths, 3600);
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

/** Short relative time: "now", "5m", "3h", "2d", or a date. */
export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

export interface Media {
  id: string;
  user_id: string;
  path: string;
  kind: "image" | "gif";
  caption: string | null;
  sort: number;
  created_at: string;
}

export type FollowStatus = "pending" | "accepted";

export function vehicleName(v: Pick<Vehicle, "year" | "make" | "model">): string {
  return [v.year, v.make, v.model].filter(Boolean).join(" ");
}

/** Avatars and banners are public files. */
export function publicImageUrl(path: string | null): string | null {
  return path && URL ? `${URL}/storage/v1/object/public/profile-images/${path}` : null;
}

/** Vehicle and gallery photos need a short-lived signed link (the database decides who may see them). */
export async function signedMediaUrls(paths: string[]): Promise<Record<string, string>> {
  return signCached("profile-media", paths);
}

/**
 * Links to the small copies of these gallery photos, keyed by the photo's own
 * path (11.94). Photos without one yet are left out; show the full photo then.
 */
export async function signedThumbUrls(paths: string[]): Promise<Record<string, string>> {
  const signed = await signCached("profile-media", paths.map(thumbPath));
  const out: Record<string, string> = {};
  for (const p of paths) if (signed[thumbPath(p)]) out[p] = signed[thumbPath(p)];
  return out;
}

/** How far you'd drive for a road (11.37): 1 skip it ... 4 worth a road trip. */
export type Worth = 1 | 2 | 3 | 4;
export type RoadFlag = "gravel" | "private" | "closed" | "police" | "paved";

export interface RoadRating {
  road_id: string;
  user_id: string;
  worth: Worth | null;
  local_best: boolean;
  flags: RoadFlag[];
  pavement: PavementCondition | null;
  traffic: TrafficLevel | null;
  vehicle: VehicleKind | null;
  drove_it: boolean;
  note: string | null;
  updated_at: string;
}

export interface RoadCommunity {
  road_id: string;
  ratings: number;
  worth_count: number;
  worth_skip: number;
  worth_nearby: number;
  worth_detour: number;
  worth_trip: number;
  local_best: number;
  drove_count: number;
  pavement_smooth: number;
  pavement_patchy: number;
  pavement_rough: number;
  pavement_loose_gravel: number;
  traffic_empty: number;
  traffic_light: number;
  traffic_busy: number;
  by_car: number;
  by_motorcycle: number;
  flag_gravel: number;
  flag_private: number;
  flag_closed: number;
  flag_police: number;
  reported_limit: number | null;
  reported_limit_count: number;
  flag_paved: number;
}

export const PAVEMENT_LABEL: Record<PavementCondition, string> = {
  smooth: "Smooth",
  patchy: "Some patches",
  rough: "Poor, broken up",
  loose_gravel: "Loose gravel on the surface",
};

/** The answers to "How far would you drive for it?", best last. */
export const WORTH_LABEL: Record<Worth, string> = {
  1: "Skip it",
  2: "Fun if you're nearby",
  3: "Worth a detour",
  4: "Worth a road trip",
};
export const WORTH_HINT: Record<Worth, string> = {
  1: "Not worth driving for fun",
  2: "A good loop when you're already close",
  3: "Worth an hour's drive",
  4: "Worth planning a weekend around",
};

export const FLAG_LABEL: Record<RoadFlag, string> = {
  gravel: "Gravel or dirt road",
  private: "Private, gated, or no entry",
  closed: "Closed or doesn't go through",
  police: "Police often here",
  // Only offered on roads whose surface needs a check (11.78).
  paved: "Paved, I checked it",
};

export const TRAFFIC_LABEL: Record<TrafficLevel, string> = {
  empty: "Empty",
  light: "Light",
  busy: "Busy",
};

/** Remember where to return after signing in (this browser only). */
export function rememberReturn(path: string) {
  try {
    localStorage.setItem("sl-return", path);
  } catch {
    // Storage blocked: signing in still works, it just lands on the profile page.
  }
}

export function takeReturn(): string | null {
  try {
    const v = localStorage.getItem("sl-return");
    localStorage.removeItem("sl-return");
    return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
  } catch {
    return null;
  }
}
