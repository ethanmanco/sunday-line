import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
export const emailHasCode = process.env.NEXT_PUBLIC_EMAIL_HAS_CODE === "1";

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
export const PROFILE_COLUMNS = "id, username, display_name, bio, avatar_path, avatar_preset, banner_path, is_private, dm_policy";
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
export type GroupPermission = "approve" | "remove" | "invites";

export const PERMISSION_LABEL: Record<GroupPermission, string> = {
  approve: "Approve join requests",
  remove: "Remove members",
  invites: "Make and revoke invite links",
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
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
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
  const sb = getSupabase();
  const out: Record<string, string> = {};
  if (!sb || !paths.length) return out;
  const { data } = await sb.storage.from("profile-media").createSignedUrls(paths, 3600);
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

export interface RoadRating {
  road_id: string;
  user_id: string;
  fun: number | null;
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
  fun_avg: number | null;
  fun_count: number;
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
  reported_limit: number | null;
  reported_limit_count: number;
}

export const PAVEMENT_LABEL: Record<PavementCondition, string> = {
  smooth: "Smooth",
  patchy: "Some patches",
  rough: "Rough",
  loose_gravel: "Loose gravel on the surface",
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
