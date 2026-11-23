"use client";

import { useState } from "react";
import RoadDetail from "@/components/RoadDetail";
import SpotFacts from "./SpotFacts";
import RoadScorePanel from "./RoadScorePanel";
import { decodePolyline } from "@/lib/polyline";
import { directionsLinks } from "@/lib/roads";
import { lineMiles, spotColors, spotColorsCss, spotLabel, type Spot } from "@/lib/spots";
import type { RoadOnMap } from "@/lib/roadData";
type Units = "imperial" | "metric";

/**
 * A spot opened on the home map, laid out like a road. A road-spot on a
 * scored road shows that road's stats with the spot on top.
 */
export default function SpotDetail({ spot, road, units, origin, originName, onClose }: {
  spot: Spot;
  road: RoadOnMap | null;
  units: Units;
  origin: [number, number];
  originName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (road) {
    return <RoadDetail road={road} units={units} origin={origin} originName={originName} onClose={onClose} spot={spot} />;
  }
  const miles = spot.kind === "road" && spot.line ? lineMiles(decodePolyline(spot.line)) : null;
  const go = directionsLinks([spot.lng, spot.lat]);

  async function share() {
    const url = `${window.location.origin}/?spot=${spot.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: spot.name, url });
        return;
      } catch {
        // Fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <article className="detail" aria-labelledby="spot-title">
      <div className="detail-bar">
        <button type="button" className="back" onClick={onClose}>
          <span aria-hidden="true">&larr;</span> All roads
        </button>
        <button type="button" className="share" onClick={share}>{copied ? "Link copied" : "Share"}</button>
      </div>
      <div className="detail-body" key={spot.id}>
        <header className="detail-head">
          <span className="badge big spot-badge" style={{ background: spotColorsCss(spotColors(spot)) }} aria-hidden="true" />
          <div>
            <h1 id="spot-title" tabIndex={-1}>{spot.name}</h1>
            <p className="sub">{[spotLabel(spot), miles !== null ? `${miles.toFixed(1)} mi` : null].filter(Boolean).join(" · ")}</p>
          </div>
        </header>
        {spot.description && <p className="spot-detail-desc">{spot.description}</p>}
        <SpotFacts spot={spot} />
        {spot.kind === "road" && <RoadScorePanel spot={spot} />}
        <section className="go" aria-label="Directions">
          <h2>Get directions</h2>
          <p className="fine">Opens your own navigation app. Plan your drive before you head out.</p>
          <p className="chips">
            {go.map((l) => (
              <a key={l.label} className="chip" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
            ))}
          </p>
        </section>
      </div>
    </article>
  );
}
