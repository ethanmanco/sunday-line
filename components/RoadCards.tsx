"use client";

import { useRef } from "react";
import { lengthText, scoreColor, scoreInk, speedShort } from "@/lib/roads";
import type { LoadedRoad } from "@/lib/types";

/**
 * Phones: the best roads in view as cards along the bottom of the map. Swiping
 * lights up each road on the map; tapping opens it.
 */
export default function RoadCards({ roads, scoreKey, units, onSelect, onHover }: {
  roads: LoadedRoad[];
  scoreKey: "overall" | "scenic" | "twisty";
  units: "imperial" | "metric";
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!roads.length) return null;

  function onScroll() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = strip.current;
      if (!el) return;
      const card = el.firstElementChild as HTMLElement | null;
      const width = card ? card.offsetWidth + 10 : el.clientWidth;
      const i = Math.min(roads.length - 1, Math.max(0, Math.round(el.scrollLeft / width)));
      onHover(roads[i]?.id ?? null);
    }, 120);
  }

  return (
    <div ref={strip} className="road-cards" onScroll={onScroll} aria-label="Top roads in view">
      {roads.map((r, i) => {
        const s = r.scores[scoreKey];
        return (
          <button key={r.id} type="button" className="road-card" onClick={() => onSelect(r.id)}>
            <span className="badge" style={{ background: scoreColor(s), color: scoreInk(s) }}>{s}</span>
            <span className="road-card-text">
              <b>{i + 1}. {r.name}</b>
              <span className="fine">Twisty {r.scores.twisty} · Speed {r.scores.speed}</span>
              <span className="fine">{lengthText(r, units)} · {speedShort(r)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
