"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Community from "./Community";
import {
  directionsLinks, distanceMi, endNames, lengthText, midpoint, milesText, pct, scoreColor, scoreInk,
  STATUS_LABEL, streetViewLink,
} from "@/lib/roads";
import type { LoadedRoad } from "@/lib/types";

interface Props {
  road: LoadedRoad;
  units: "imperial" | "metric";
  origin: [number, number];
  originName: string;
  onClose: () => void;
}

const SCORE_ROWS: { key: keyof LoadedRoad["scores"]; label: string; help: string }[] = [
  { key: "twisty", label: "Twisty", help: "Cornering, braking, and direction changes at the speed limit, compared with five race tracks capped at 55 mph. 70 is track average." },
  { key: "speed", label: "Speed", help: "Average legal speed through the corners. 35 mph scores 0, 65 mph scores 100." },
  { key: "pavement", label: "Pavement", help: "How likely the pavement is smooth and kept up: who maintains the road, federal road data, aerial photos, and people's checks." },
  { key: "flow", label: "Flow", help: "Few stop signs, signals, and side roads." },
  { key: "elevation", label: "Elevation", help: "Climbs and dips along the road." },
  { key: "scenic", label: "Scenic", help: "Forest, water, and wetland along the road." },
];

function Profile({ ft }: { ft: number[] }) {
  if (ft.length < 2) return null;
  const lo = Math.min(...ft);
  const hi = Math.max(...ft);
  const span = Math.max(hi - lo, 30);
  const w = 300;
  const h = 70;
  const pts = ft.map((v, i) => `${(i / (ft.length - 1)) * w},${h - 6 - ((v - lo) / span) * (h - 14)}`);
  return (
    <svg className="profile" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} className="profile-fill" />
      <polyline points={pts.join(" ")} className="profile-line" />
    </svg>
  );
}

export default function RoadDetail({ road: r, units, origin, originName, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    heading.current?.focus();
    setCopied(false);
  }, [r.id]);

  const [startName, endName] = endNames(r);
  const mid = midpoint(r);
  const e = r.elevation;
  const s = r.scores.overall;
  const scenery = [
    r.scenery.forest >= 0.05 ? `${pct(r.scenery.forest)} forest` : null,
    r.scenery.water >= 0.05 ? `${pct(r.scenery.water)} near water` : null,
    r.scenery.wetland >= 0.05 ? `${pct(r.scenery.wetland)} wetland` : null,
    r.scenery.byway ? `Part of ${r.scenery.byway}` : null,
  ].filter(Boolean);
  const stops = [
    r.stops.stops ? `${r.stops.stops} stop ${r.stops.stops === 1 ? "sign" : "signs"}` : null,
    r.stops.signals ? `${r.stops.signals} ${r.stops.signals === 1 ? "signal" : "signals"}` : null,
    `${r.stops.junctions} side ${r.stops.junctions === 1 ? "road" : "roads"}`,
  ].filter(Boolean);

  async function share() {
    const url = `${window.location.origin}/road/${r.id}`;
    const title = `${r.name}${r.near ? ` near ${r.near}` : ""}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Fall back to copying when the share sheet is closed or missing.
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
    <article className="detail" aria-labelledby="road-title">
      <div className="detail-bar">
        <button type="button" className="back" onClick={onClose}>
          <span aria-hidden="true">&larr;</span> All roads
        </button>
        <button type="button" className="share" onClick={share}>
          {copied ? "Link copied" : "Share"}
        </button>
      </div>

      {/* Its own scroll, outside the header, so nothing shows above it and each road starts at the top. */}
      <div className="detail-body" key={r.id}>
      <header className="detail-head">
        <span className="badge big" style={{ background: scoreColor(s), color: scoreInk(s) }} aria-label={`Overall ${s}`}>
          {s}
        </span>
        <div>
          <h1 id="road-title" ref={heading} tabIndex={-1}>{r.name}</h1>
          <p className="sub">
            {[r.near && `Near ${r.near}`, r.state, lengthText(r, units), `${milesText(distanceMi(r, origin))} from ${originName}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="chips">
            <span className="chip" title="Found from map data. Members haven't verified it yet.">{STATUS_LABEL[r.status]}</span>
            {r.category === "gravel" && <span className="chip warn">Gravel or dirt</span>}
            {r.category === "unsure" && <span className="chip warn">Surface needs a check</span>}
          </p>
        </div>
      </header>

      {r.category !== "drivers" && r.excluded.length > 0 && (
        <p className="note warn">Not on the Driver&apos;s roads list: {r.excluded.join("; ")}.</p>
      )}

      <dl className="scores">
        {SCORE_ROWS.map((row) => (
          <div key={row.key} className="score-row" title={row.help}>
            <dt>{row.label}</dt>
            <dd>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${r.scores[row.key]}%`, background: scoreColor(r.scores[row.key]) }} />
              </span>
              <b>{r.scores[row.key]}</b>
            </dd>
          </div>
        ))}
      </dl>
      <p className="fine">
        Overall needs both Twisty and Speed: a road scores well only when it works the car at legal speeds.{" "}
        <Link href="/about#scoring">How scores work</Link>
      </p>

      <section className="facts" aria-label="Road facts">
        <div>
          <h2>Speed limit</h2>
          <p>{r.speed.text}</p>
          {r.speed.note && r.speed.source !== "posted" && <p className="fine">{r.speed.note}</p>}
        </div>
        <div>
          <h2>Surface and pavement</h2>
          <p>{r.surface.text}</p>
          {r.pavement?.why && <p>Pavement: {r.pavement.why}.</p>}
          {r.pavement?.traffic_aadt != null && (
            <p className="fine">About {r.pavement.traffic_aadt.toLocaleString()} cars a day (state traffic count).</p>
          )}
        </div>
        {e.min_ft !== null && e.max_ft !== null && (
          <div>
            <h2>Elevation</h2>
            <Profile ft={e.profile_ft} />
            <p>
              Climbs {e.climb_ft} ft and drops {e.descent_ft} ft in total. Low point {e.min_ft} ft, high point {e.max_ft} ft.
            </p>
          </div>
        )}
        <div>
          <h2>Stops</h2>
          <p>{stops.join(", ")}</p>
        </div>
        {scenery.length > 0 && (
          <div>
            <h2>Scenery</h2>
            <p>{scenery.join(", ")}</p>
          </div>
        )}
      </section>

      <Community roadId={r.id} units={r.speed.units} />

      <section className="go" aria-label="Directions">
        <h2>Get directions</h2>
        <p className="fine">Opens your own navigation app. Plan your drive before you head out.</p>
        {[[startName, r.start], [endName, r.end]].map(([name, p]) => (
          <div key={name as string} className="go-row">
            <span>To the {name as string}</span>
            <span className="go-links">
              {directionsLinks(p as [number, number]).map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
              ))}
            </span>
          </div>
        ))}
        <p className="go-extra">
          <a href={streetViewLink(mid)} target="_blank" rel="noopener noreferrer">Street View near the middle</a>
          {r.osm_way_ids[0] && (
            <a href={`https://www.openstreetmap.org/way/${r.osm_way_ids[0]}`} target="_blank" rel="noopener noreferrer">
              View on OpenStreetMap
            </a>
          )}
        </p>
      </section>

      <p className="fine credit">
        Road data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.
        Scores are estimates from map data. Follow posted limits and traffic laws.
      </p>
      </div>
    </article>
  );
}
