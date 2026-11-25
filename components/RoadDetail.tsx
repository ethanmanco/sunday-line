"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Community from "./Community";
import {
  directionsLinks, distanceMi, endNames, lengthText, midpoint, milesText, pct, scoreColor, scoreInk,
  STATUS_LABEL, streetViewLink,
} from "@/lib/roads";
import type { LoadedRoad } from "@/lib/types";
import SpotFacts from "./spots/SpotFacts";
import SaveRoad from "./SaveRoad";
import KeepOffline from "./KeepOffline";
import AddToRoute from "./AddToRoute";
import { decodePolyline } from "@/lib/polyline";
import { lineMiles, spotLabel, type Spot } from "@/lib/spots";
import { spotStretch } from "@/lib/stretch";
import { useMapShell } from "@/lib/mapShell";
import { bountyPoints, isBounty } from "@/lib/bounties";

interface Props {
  road: LoadedRoad;
  units: "imperial" | "metric";
  origin: [number, number];
  originName: string;
  onClose: () => void;
  /** Opened from a saved spot on this road: shown on top. */
  spot?: Spot | null;
}

export const SCORE_ROWS: { key: keyof LoadedRoad["scores"]; label: string; help: string }[] = [
  { key: "twisty", label: "Twisty", help: "Cornering, braking, and direction changes at the speed limit, compared with five race tracks capped at 55 mph. 70 is track average." },
  { key: "speed", label: "Speed", help: "Average legal speed through the corners. 25 mph scores 0, 65 mph scores 100." },
  { key: "pavement", label: "Pavement", help: "How likely the pavement is smooth and kept up: who maintains the road, federal road data, aerial photos, and people's checks." },
  { key: "flow", label: "Flow", help: "Few stop signs, signals, and side roads." },
  { key: "elevation", label: "Elevation", help: "Climbs and dips along the road." },
  { key: "scenic", label: "Scenic", help: "Mountains and views, coast and big lakes, forest, open desert and range, and water along the road. Towns count against it." },
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

export default function RoadDetail({ road: r, units, origin, originName, onClose, spot = null }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);
  // Which explanation is open: a score's, or the status chip's. Tapped open,
  // since phones can't show hover text (11.82).
  const [help, setHelp] = useState<string | null>(null);
  const toggle = (k: string) => setHelp((h) => (h === k ? null : k));
  useEffect(() => {
    heading.current?.focus();
    setCopied(false);
    setHelp(null);
  }, [r.id]);

  const [startName, endName] = endNames(r);
  const mid = midpoint(r);
  const e = r.elevation;
  const s = r.scores.overall;
  const scenery = [
    (r.scenery.big_water ?? 0) >= 0.1 ? `${pct(r.scenery.big_water!)} along the coast or a big lake` : null,
    (r.scenery.terrain ?? 0) >= 0.6 ? "Mountains around" : (r.scenery.terrain ?? 0) >= 0.25 ? "Hills around" : null,
    (r.scenery.overlook ?? 0) >= 0.3 ? "Views from up high" : null,
    (r.scenery.open ?? 0) * (r.scenery.rugged ?? 0) >= 0.3 ? "Open desert or range country" : null,
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
    const url = spot ? `${window.location.origin}/?spot=${spot.id}` : `${window.location.origin}/road/${r.id}`;
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
        <div className="detail-actions">
          <SaveRoad road={r} />
          <KeepOffline road={r} />
          <button type="button" className="share" onClick={share}>
            {copied ? "Link copied" : "Share"}
          </button>
        </div>
      </div>

      {/* Its own scroll, outside the header, so nothing shows above it and each road starts at the top. */}
      <div className="detail-body" key={spot ? spot.id : r.id}>
      {spot && <SpotOnRoad spot={spot} road={r} />}
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
            {r.status === "candidate" ? (
              <button type="button" className="chip chip-help" aria-expanded={help === "status"} onClick={() => toggle("status")}>
                {STATUS_LABEL[r.status]} <span aria-hidden="true">?</span>
              </button>
            ) : (
              <span className="chip">{STATUS_LABEL[r.status]}</span>
            )}
            {r.category === "gravel" && <span className="chip warn">Gravel or dirt</span>}
            {r.category === "unsure" && <span className="chip warn">Surface needs a check</span>}
          </p>
          {help === "status" && <p className="fine">Found from map data. Members haven&apos;t verified it yet.</p>}
        </div>
      </header>

      {isBounty(r) && (
        <section className="bounty" aria-labelledby="bounty-title">
          <h2 id="bounty-title">Bounty: +{bountyPoints(r)} rep</h2>
          <p>
            This road&apos;s surface needs a check ({(r.excluded[0] ?? "surface unclear").replace(/ \(needs a check\)$/, "")}).
            Seen it? Review it below with what you found: paved, gravel or dirt, private or gated, or closed. When three
            members say the same and the site admin confirms it, everyone who answered earns the rep.
          </p>
          <p className="fine">
            A locked gate or a &ldquo;No trespassing&rdquo; sign is a full answer: never go past one. Answer after your
            drive, not while driving. Wrong answers cost rep. Accounts earn rep once they&apos;re a week old.
          </p>
        </section>
      )}

      {r.category !== "drivers" && r.excluded.length > 0 && (
        <p className="note warn">Not on the Driver&apos;s roads list: {r.excluded.join("; ")}.</p>
      )}

      <dl className="scores">
        {SCORE_ROWS.map((row) => (
          <div key={row.key} className="score-row">
            <dt>
              <button type="button" className="score-help" aria-expanded={help === row.key} onClick={() => toggle(row.key)} title={row.help}>
                {row.label}
              </button>
            </dt>
            <dd>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${r.scores[row.key]}%`, background: scoreColor(r.scores[row.key]) }} />
              </span>
              <b>{r.scores[row.key]}</b>
            </dd>
            {help === row.key && <dd className="score-why fine">{row.help}</dd>}
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

      <Community roadId={r.id} units={r.speed.units} needsCheck={isBounty(r)} />

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
        <AddToRoute road={r} />
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

/** A saved spot on a scored road: its name, who added it, its groups, and how much of the road it covers. */
function SpotOnRoad({ spot, road }: { spot: Spot; road: LoadedRoad }) {
  const model = useMapShell()?.stretchModel;
  const stretch = spot.line ? lineMiles(decodePolyline(spot.line)) : null;
  const roadMi = lineMiles(road.coords);
  const own = spotStretch(spot, road, model);
  const part = !!own || (stretch !== null && stretch < roadMi * 0.9);
  // A stretch picked by start and end points: its length is that share of the road.
  const shownMi = own ? roadMi * (own.f1 - own.f0) : stretch;
  return (
    <section className="spot-on-road" aria-label="Saved spot">
      <p className="fine">Saved spot</p>
      <h2 className="spot-on-road-name">{spot.name}</h2>
      <p className="fine">
        {[spotLabel(spot), shownMi !== null ? `${shownMi.toFixed(1)} mi` : null].filter(Boolean).join(" · ")}
        {part && ` of this road's ${roadMi.toFixed(1)} mi.`}
      </p>
      {own ? (
        <div className="stretch-scores" aria-label="Scores for this stretch">
          <span className="badge" style={{ background: scoreColor(own.scores.overall), color: scoreInk(own.scores.overall) }}>{own.scores.overall}</span>
          <span>
            <b>This stretch</b>
            <span className="fine"> Twisty {own.scores.twisty} · Speed {own.scores.speed} · Elevation {own.scores.elevation}</span>
          </span>
        </div>
      ) : part ? (
        <p className="fine">Scores below are for the whole road. This stretch gets its own once the road data is refreshed.</p>
      ) : null}
      {own && <p className="fine">Pavement, flow, and scenery below are for the whole road.</p>}
      {spot.description && <p>{spot.description}</p>}
      <SpotFacts spot={spot} />
    </section>
  );
}
