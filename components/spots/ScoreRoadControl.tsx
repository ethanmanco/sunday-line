"use client";

import { getSupabase } from "@/lib/supabase";
import { useMapShell } from "@/lib/mapShell";
import type { Spot } from "@/lib/spots";

/**
 * "Score this road" in a spot list (Your spots, a group's spots). Only for a road picked off the
 * map or drawn, since suggested roads already have scores (11.27). Scoring is separate from the
 * public map: a score is seen only by people who can already see the road. Whoever asks gets the
 * notification when it's ready.
 */
export default function ScoreRoadControl({ spot, onMessage }: { spot: Spot; onMessage: (m: string) => void }) {
  const shell = useMapShell();
  if (spot.kind !== "road" || spot.road_id || !shell || shell.spotRoad(spot.id)) return null;
  const rs = shell.roadScore(spot.id);

  async function ask() {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.rpc("request_road_score", { p_spot: spot.id });
    onMessage(error
      ? (error.message.includes("20 score") ? "That's 20 score requests today. Try again tomorrow." : "Couldn't ask for a score. Try again.")
      : `${spot.name} is waiting to be scored, usually within the hour. You'll get a notification.`);
    await shell?.reloadRoadScore(spot.id);
  }

  if (rs?.status === "done" && rs.scores) {
    return <button type="button" className="chip" onClick={() => shell.focusSpot(spot.id)}>Scored {rs.scores.overall}</button>;
  }
  if (rs?.status === "queued" || rs?.status === "scoring") {
    return <span className="chip">{rs.status === "scoring" ? "Being scored" : "Waiting to be scored"}</span>;
  }
  return <button type="button" className="link" onClick={ask}>{rs?.status === "failed" ? "Try scoring again" : "Score this road"}</button>;
}
