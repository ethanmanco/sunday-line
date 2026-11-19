"use client";

import { useRef } from "react";
import { useMapShell, type ListItem } from "@/lib/mapShell";
import { lengthText, milesText, scoreColor, scoreInk, speedShort } from "@/lib/roads";
import { CATEGORY_COLOR, spotLabel } from "@/lib/spots";

/**
 * Phones: what's in view as cards along the bottom of the map: roads and
 * spots, in the list's order. Swiping lights up each one; tapping opens it.
 */
export default function ItemCards({ items, scoreKey, units }: {
  items: ListItem[];
  scoreKey: "overall" | "scenic" | "twisty";
  units: "imperial" | "metric";
}) {
  const shell = useMapShell();
  const strip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!shell || !items.length) return null;

  function onScroll() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = strip.current;
      if (!el) return;
      const card = el.firstElementChild as HTMLElement | null;
      const width = card ? card.offsetWidth + 10 : el.clientWidth;
      const it = items[Math.min(items.length - 1, Math.max(0, Math.round(el.scrollLeft / width)))];
      shell!.setHoverId(it?.kind === "road" ? it.road.id : null);
    }, 120);
  }

  return (
    <div ref={strip} className="road-cards" onScroll={onScroll} aria-label="What's in view">
      {items.map((it, i) => {
        if (it.kind === "road") {
          const r = it.road;
          const s = r.scores[scoreKey];
          return (
            <button key={r.id} type="button" className="road-card" onClick={() => shell.selectRoad(r.id)}>
              <span className="badge" style={{ background: scoreColor(s), color: scoreInk(s) }}>{s}</span>
              <span className="road-card-text">
                <b>{i + 1}. {r.name}</b>
                <span className="fine">Twisty {r.scores.twisty} · Speed {r.scores.speed}</span>
                <span className="fine">{lengthText(r, units)} · {speedShort(r)}</span>
              </span>
            </button>
          );
        }
        const sp = it.spot;
        return (
          <button key={sp.id} type="button" className="road-card" onClick={() => shell.focusSpot(sp.id)}>
            <span className="spot-dot" style={{ background: sp.kind === "road" ? "#7cc4ff" : CATEGORY_COLOR[sp.category ?? "other"] }} aria-hidden="true" />
            <span className="road-card-text">
              <b>{sp.name}</b>
              <span className="fine">{spotLabel(sp)}{sp.group_name ? ` · ${sp.group_name}` : ""}</span>
              <span className="fine">{milesText(it.distance)} from {shell.originName}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
