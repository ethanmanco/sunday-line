"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { loadRoads, type Spot } from "@/lib/spots";

const SpotMap = dynamic(() => import("@/components/spots/SpotMap"), { ssr: false, loading: () => <div className="spot-map map-loading" /> });

const WIDE = "(min-width: 1100px)";

/**
 * A page (profile or group) next to a map of its spots.
 * Wide screens: side by side, the map stays put while the page scrolls.
 * Phones: a Map button flips to a full-screen map and back.
 */
export default function MapSplit({ spots, title, focus, onFocus, children }: {
  spots: Spot[];
  /** "Mango's spots", "Shreveport Sunday Drivers" */
  title: string;
  /** A spot to show (change key to show again). */
  focus: { id: string; key: number } | null;
  onFocus: (f: { id: string; key: number } | null) => void;
  children: React.ReactNode;
}) {
  const [wide, setWide] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    loadRoads().then((d) => setBbox(d.bbox)).catch(() => setBbox([-95, 31, -92, 34]));
  }, []);

  // On phones, asking for a spot opens the map.
  useEffect(() => {
    if (focus && wide === false) setOpen(true);
  }, [focus, wide]);

  // Escape closes the phone map.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const map = bbox && (
    <SpotMap
      spots={spots}
      fallbackBbox={bbox}
      focusId={focus?.id ?? null}
      fitKey={`${focus?.key ?? "all"}-${spots.length}`}
      className="split-spot-map"
      onSpotClick={(id) => {
        onFocus({ id, key: Date.now() });
        if (!wide) return;
        document.getElementById(`spot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
    />
  );

  if (wide) {
    return (
      <div className="map-split">
        <div className="map-split-page">{children}</div>
        <aside className="map-split-map" aria-label={`Map: ${title}`}>
          {map}
          {spots.length === 0 && <p className="map-split-empty">No spots to show yet.</p>}
          {focus && (
            <button type="button" className="map-split-all" onClick={() => onFocus(null)}>Show all {spots.length}</button>
          )}
        </aside>
      </div>
    );
  }

  return (
    <>
      {children}
      {spots.length > 0 && !open && (
        <button type="button" className="map-fab" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          Map ({spots.length})
        </button>
      )}
      {open && (
        <div className="map-overlay" role="dialog" aria-modal="true" aria-label={`Map: ${title}`}>
          {map}
          <button type="button" className="map-overlay-back" onClick={() => setOpen(false)}>
            <span aria-hidden="true">&larr;</span> {title}
          </button>
        </div>
      )}
    </>
  );
}
