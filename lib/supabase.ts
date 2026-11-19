import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Both values are public. Row level security in the database decides what
// anyone can read or change.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
  client ??= createClient(URL!, KEY!, { auth: { flowType: "implicit", persistSession: true, autoRefreshToken: true } });
  return client;
}

export type PavementCondition = "smooth" | "patchy" | "rough" | "loose_gravel";
export type TrafficLevel = "empty" | "light" | "busy";
export type VehicleKind = "car" | "motorcycle";

export interface Profile {
  id: string;
  display_name: string;
  vehicle_note: string | null;
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
