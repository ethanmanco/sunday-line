"use client";

import { useEffect, useState } from "react";
import { lengthText, milesText, scoreColor, scoreInk, speedShort, STATUS_LABEL, type View } from "@/lib/roads";
import { useMapShell, type ListItem } from "@/lib/mapShell";
import { SPOT_GRADIENT_CSS, spotLabel, type Spot } from "@/lib/spots";
import { spotStretch } from "@/lib/stretch";
import type { LoadedRoad } from "@/lib/types";

interface Props {
  items: ListItem[];
  view: View;
  scoreKey: "overall" | "scenic" | "twisty";
  units: "imperial" | "metric";
  origin: [number, number];
  originName: string;
  onSelect: (id: string) => void;
  onSpot: (id: string) => void;
  onHover: (id: string | null) => void;
}

const PAGE = 60;

function warning(r: LoadedRoad, view: View): string | null {
  if (r.category === "gravel" && view !== "gravel") return "Gravel or dirt";
  if (r.category === "unsure") return `Needs a check: ${(r.excluded[0] ?? "surface unclear").replace(/ \(needs a check\)$/, "")}`;
  if (r.category === "other" && view === "all") return `Left out: ${r.excluded[0] ?? ""}`;
  return null;
}

/** Roads and spots in one list, in the order the filters chose. */
export default function RoadList({ items, view, scoreKey, units, originName, onSelect, onSpot, onHover }: Props) {
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [items]);
  const roads = items;

  if (!roads.length) {
    return (
      <p className="empty">
        Nothing matches. Zoom or pan the map out, or turn off &quot;Only what&apos;s in the map view&quot;.
      </p>
    );
  }
  const label = scoreKey === "overall" ? "Overall" : scoreKey === "scenic" ? "Scenic" : "Twisty";
  return (
    <>
      <ol className="roads">
        {items.slice(0, shown).map((it, i) => {
          if (it.kind === "spot") {
            const sp = it.spot;
            return (
              <li key={sp.id}>
                <button type="button" className="road" onClick={() => onSpot(sp.id)}>
                  <SpotMark spot={sp} scoreKey={scoreKey} />
                  <span className="road-main">
                    <span className="road-name"><span className="rank">{i + 1}.</span> {sp.name}</span>
                    <span className="road-meta">{spotLabel(sp)}{sp.group_name ? ` · ${sp.group_name}` : ""}</span>
                    <span className="road-meta">{milesText(it.distance)} from {originName}</span>
                  </span>
                  <span className="status">Spot</span>
                </button>
              </li>
            );
          }
          const r = it.road;
          const s = r.scores[scoreKey];
          const warn = warning(r, view);
          return (
            <li key={r.id}>
              <button
                type="button"
                className="road"
                onClick={() => onSelect(r.id)}
                onMouseEnter={() => onHover(r.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(r.id)}
                onBlur={() => onHover(null)}
              >
                <span className="badge" style={{ background: scoreColor(s), color: scoreInk(s) }} aria-label={`${label} ${s}`}>
                  {s}
                </span>
                <span className="road-main">
                  <span className="road-name">
                    <span className="rank">{i + 1}.</span> {r.name}
                  </span>
                  <span className="road-meta">
                    Twisty {r.scores.twisty} · Speed {r.scores.speed} · Pavement {r.scores.pavement}
                  </span>
                  <span className="road-meta">
                    {lengthText(r, units)} · {speedShort(r)} · {milesText(it.distance)} from {originName}
                  </span>
                  {warn && <span className="road-warn">{warn}</span>}
                </span>
                <span className="status">{STATUS_LABEL[r.status]}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {shown < roads.length && (
        <button type="button" className="more" onClick={() => setShown(shown + PAGE)}>
          Show more ({roads.length - shown} left)
        </button>
      )}
    </>
  );
}

/** A spot's marker in lists: the score of the road it sits on, or a colored dot. */
export function SpotMark({ spot, scoreKey }: { spot: Spot; scoreKey: keyof LoadedRoad["scores"] }) {
  const shell = useMapShell();
  const road = shell?.spotRoad(spot.id);
  if (road) {
    // A stretch of the road gets its own score.
    const part = spotStretch(spot, road, shell?.stretchModel);
    const s = (part?.scores ?? road.scores)[scoreKey];
    return <span className="badge" style={{ background: scoreColor(s), color: scoreInk(s) }} title={`${road.name}: ${s}`}>{s}</span>;
  }
  return <span className={`spot-dot${spot.kind === "road" ? " is-road" : ""}`} style={{ background: SPOT_GRADIENT_CSS }} aria-hidden="true" />;
}
