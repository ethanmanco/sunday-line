// Heads-ups (11.39): short-lived notes on the map about something on a road
// right now. They end by themselves; "Still there" keeps one going and two
// "Gone" votes (or the poster) end it early. Shown without who posted them.

import { getSupabase } from "./supabase";

export type HeadsUpKind = "police" | "crash" | "stalled" | "debris" | "spill" | "animal" | "work" | "flooding";

export interface HeadsUp {
  id: string;
  kind: HeadsUpKind;
  lng: number;
  lat: number;
  note: string | null;
  created_at: string;
  expires_at: string;
  still_count: number;
  mine: boolean;
}

export const HEADS_UP_LABEL: Record<HeadsUpKind, string> = {
  police: "Police",
  crash: "Crash",
  stalled: "Stalled car",
  debris: "Something on the road",
  spill: "Oil or spill",
  animal: "Animal",
  work: "Road work",
  flooding: "Flooding",
};

/** How long each kind lasts before it needs a "still there" (matches the database). */
export const HEADS_UP_LIFE: Record<HeadsUpKind, string> = {
  police: "1 hour",
  animal: "1 hour",
  crash: "2 hours",
  stalled: "2 hours",
  debris: "3 hours",
  spill: "4 hours",
  work: "12 hours",
  flooding: "12 hours",
};

export const HEADS_UP_KINDS = Object.keys(HEADS_UP_LABEL) as HeadsUpKind[];

const COLOR: Record<HeadsUpKind, string> = {
  police: "#5b8def",
  crash: "#ef5b5b",
  stalled: "#f0a050",
  debris: "#f0c040",
  spill: "#b48cf0",
  animal: "#7cc49a",
  work: "#f08a3c",
  flooding: "#4fb3e8",
};

/** Map icon id for a kind. */
export const headsUpIconId = (k: HeadsUpKind) => `hu-${k}`;

/** Draws a heads-up icon (a colored warning triangle with a mark), 2x for sharp phones. */
export function headsUpIcon(id: string): ImageData | null {
  if (!id.startsWith("hu-") || typeof document === "undefined") return null;
  const kind = id.slice(3) as HeadsUpKind;
  if (!(kind in COLOR)) return null;
  const S = 40;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  if (!g) return null;
  g.beginPath();
  g.moveTo(20, 3);
  g.lineTo(37, 35);
  g.lineTo(3, 35);
  g.closePath();
  g.fillStyle = COLOR[kind];
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "#0c0e11";
  g.stroke();
  g.fillStyle = "#0c0e11";
  if (kind === "police") {
    g.beginPath();
    g.arc(20, 24, 6, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillRect(18, 13, 4, 12);
    g.fillRect(18, 28, 4, 4);
  }
  return g.getImageData(0, 0, S, S);
}

/** "12 min ago", "2 hr ago". */
export function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} hr ago`;
}

/** Live heads-ups in a box (empty if accounts are off or offline). */
export async function loadHeadsUps(b: [number, number, number, number]): Promise<HeadsUp[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("live_heads_ups", { w: b[0], s: b[1], e: b[2], n: b[3] });
  if (error) return [];
  return (data as HeadsUp[] | null) ?? [];
}

export async function addHeadsUp(kind: HeadsUpKind, ll: [number, number], note: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Accounts aren't set up on this site.";
  const { error } = await sb.rpc("add_heads_up", { p_kind: kind, p_lng: ll[0], p_lat: ll[1], p_note: note.trim() || null });
  if (!error) return null;
  if (error.code === "54000") return "That's the limit for today.";
  return "Couldn't post it. Check your connection and try again.";
}

export async function voteHeadsUp(id: string, stillThere: boolean): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.rpc("vote_heads_up", { p_id: id, p_still_there: stillThere });
  return !error;
}
