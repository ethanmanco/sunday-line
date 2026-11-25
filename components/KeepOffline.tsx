"use client";

import { useEffect, useState } from "react";
import { forgetOffline, isKept, keepOffline, offlineSupported, sizeText } from "@/lib/offline";
import type { RoadOnMap } from "@/lib/roadData";

/**
 * "Keep offline" on a road's page (11.83): saves the road and the map along it
 * on this device, for places with no signal. Tap again to remove it.
 */
export default function KeepOffline({ road }: { road: RoadOnMap }) {
  const [supported, setSupported] = useState(false);
  const [kept, setKept] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setSupported(offlineSupported());
    setKept(isKept(road.id));
    setProgress(null);
  }, [road.id]);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 5000);
    return () => window.clearTimeout(t);
  }, [note]);

  if (!supported || road.light) return null;

  async function toggle() {
    if (progress !== null) return;
    if (kept) {
      await forgetOffline(road.id);
      setKept(false);
      setNote("Removed from this device");
      return;
    }
    setProgress(0);
    try {
      const k = await keepOffline(road, (p) => setProgress(p));
      setKept(true);
      setNote(`Kept on this device for no signal (${sizeText(k.bytes)})`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't save it. Try again.");
    } finally {
      setProgress(null);
    }
  }

  const label = progress !== null ? `Saving for offline, ${Math.round(progress * 100)}%`
    : kept ? "Kept offline. Tap to remove it from this device" : "Keep offline: save this road and its map on this device";
  return (
    <div className="save-road-box">
      <button type="button" className={`share save-road keep-offline${kept ? " kept" : ""}`} aria-pressed={kept}
        aria-label={label} title={label} onClick={toggle} disabled={progress !== null}>
        {progress !== null ? (
          <span className="keep-pct" aria-hidden="true">{Math.round(progress * 100)}%</span>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {kept ? <path d="M5 12.5 10 17.5 19 7" /> : <><path d="M12 4v11" /><path d="m7 10.5 5 5 5-5" /><path d="M5 20h14" /></>}
          </svg>
        )}
      </button>
      {note && <span className="save-note" role="status">{note}</span>}
    </div>
  );
}
