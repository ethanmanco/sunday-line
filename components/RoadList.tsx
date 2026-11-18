"use client";

import { useEffect, useState } from "react";
import { distanceMi, lengthText, milesText, scoreColor, scoreInk, speedShort, STATUS_LABEL, type View } from "@/lib/roads";
import type { LoadedRoad } from "@/lib/types";

interface Props {
  roads: LoadedRoad[];
  view: View;
  scoreKey: "overall" | "scenic" | "twisty";
  units: "imperial" | "metric";
  origin: [number, number];
  originName: string;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

const PAGE = 60;

function warning(r: LoadedRoad, view: View): string | null {
  if (r.category === "gravel" && view !== "gravel") return "Gravel or dirt";
  if (r.category === "unsure") return "Surface needs a check";
  if (r.category === "other" && view === "all") return `Left out: ${r.excluded[0] ?? ""}`;
  return null;
}

export default function RoadList({ roads, view, scoreKey, units, origin, originName, onSelect, onHover }: Props) {
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [roads]);

  if (!roads.length) {
    return (
      <p className="empty">
        No roads match. Zoom or pan the map out, or turn off &quot;Only roads in the map view&quot;.
      </p>
    );
  }
  const label = scoreKey === "overall" ? "Overall" : scoreKey === "scenic" ? "Scenic" : "Twisty";
  return (
    <>
      <ol className="roads">
        {roads.slice(0, shown).map((r, i) => {
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
                    Twisty {r.scores.twisty} · Speed {r.scores.speed} · Scenic {r.scores.scenic}
                  </span>
                  <span className="road-meta">
                    {lengthText(r, units)} · {speedShort(r)} · {milesText(distanceMi(r, origin))} from {originName}
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
