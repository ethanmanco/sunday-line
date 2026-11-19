"use client";

import { useState } from "react";
import { SCORE_ROWS } from "@/components/RoadDetail";
import { useAuth } from "@/components/AuthProvider";
import { useMapShell } from "@/lib/mapShell";
import { scoreColor, scoreInk } from "@/lib/roads";
import { getSupabase } from "@/lib/supabase";
import type { Spot } from "@/lib/spots";

/**
 * Scores for a road that isn't one of the scored roads (11.27). The owner can
 * ask for it to be scored; an hourly job scores it from public map data.
 */
export default function RoadScorePanel({ spot }: { spot: Spot }) {
  const shell = useMapShell();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rs = shell?.roadScore(spot.id) ?? null;
  const mine = !!user && user.id === spot.owner_id;

  async function ask() {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const { error } = await sb.rpc("request_road_score", { p_spot: spot.id });
    setBusy(false);
    if (error) setError(error.message.includes("20 score") ? "That's 20 score requests today. Try again tomorrow." : "Couldn't ask for a score. Try again.");
    await shell?.reloadRoadScore(spot.id);
  }

  if (rs?.status === "done" && rs.scores) {
    const sc = rs.scores;
    const det = rs.details ?? {};
    return (
      <section className="requested-score" aria-label="Road scores">
        <div className="stretch-scores">
          <span className="badge" style={{ background: scoreColor(sc.overall), color: scoreInk(sc.overall) }}>{sc.overall}</span>
          <span><b>Overall</b><span className="fine"> scored on request</span></span>
        </div>
        <dl className="scores">
          {SCORE_ROWS.filter((row) => typeof sc[row.key] === "number").map((row) => (
            <div key={row.key} className="score-row" title={row.help}>
              <dt>{row.label}</dt>
              <dd>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${sc[row.key]}%`, background: scoreColor(sc[row.key]) }} />
                </span>
                <b>{sc[row.key]}</b>
              </dd>
            </div>
          ))}
        </dl>
        <section className="facts" aria-label="Road facts">
          {det.speed_limit && (
            <div>
              <h2>Speed limit</h2>
              <p>{det.speed_limit}{typeof det.speed_limit_posted_share === "number" && det.speed_limit_posted_share < 0.8 ? " (partly estimated)" : ""}</p>
            </div>
          )}
          {det.pavement_why && (
            <div>
              <h2>Pavement</h2>
              <p>{det.pavement_why}</p>
            </div>
          )}
          {typeof det.climb_ft === "number" && (
            <div>
              <h2>Elevation</h2>
              <p>Climbs {det.climb_ft} ft and drops {det.descent_ft ?? 0} ft in total.</p>
            </div>
          )}
          {typeof det.junctions === "number" && (
            <div>
              <h2>Stops</h2>
              <p>
                {[det.stops ? `${det.stops} stop ${det.stops === 1 ? "sign" : "signs"}` : null,
                  det.signals ? `${det.signals} ${det.signals === 1 ? "signal" : "signals"}` : null,
                  `${det.junctions} side ${det.junctions === 1 ? "road" : "roads"}`].filter(Boolean).join(", ")}
              </p>
            </div>
          )}
        </section>
        <p className="fine">{det.note ?? "Scored on request from public map data."} Follow posted limits and traffic laws.</p>
      </section>
    );
  }

  if (rs && (rs.status === "queued" || rs.status === "scoring")) {
    return (
      <p className="note" role="status">
        {rs.status === "scoring" ? "Being scored now." : "Waiting to be scored."} Roads are scored from public map data, usually within the hour.
        {" "}<button type="button" className="chip" onClick={() => shell?.reloadRoadScore(spot.id)}>Check again</button>
      </p>
    );
  }

  return (
    <div className="requested-score">
      <p className="fine">
        {rs?.status === "failed"
          ? `Couldn't score this road: ${rs.note ?? "something went wrong"}.`
          : "This road isn't one of the scored roads (it was picked off the map or drawn by hand)."}
      </p>
      {mine && (
        <p>
          <button type="button" className="button" onClick={ask} disabled={busy}>
            {busy ? "Asking..." : rs?.status === "failed" ? "Try again" : "Score this road"}
          </button>
          <span className="fine"> Uses public map data. Usually ready within the hour.</span>
        </p>
      )}
      {error && <p className="hint warn" role="alert">{error}</p>}
    </div>
  );
}
