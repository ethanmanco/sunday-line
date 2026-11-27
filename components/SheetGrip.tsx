"use client";

import { useRef } from "react";
import type { SheetState } from "@/lib/mapShell";

/**
 * The handle on the phone sheet. Drag it up or down and it snaps to tucked
 * away (just the handle, so the map shows), a bit under half, or full screen.
 * A tap steps between them.
 */
export default function SheetGrip({ state, title, canClose, panel, onDrag, onSnap }: {
  state: SheetState;
  title: string | null;
  /** Home's list can close completely; pages tuck down to the handle. */
  canClose: boolean;
  panel: React.RefObject<HTMLElement | null>;
  /** Live height while dragging (null when done). */
  onDrag: (px: number | null) => void;
  onSnap: (s: SheetState) => void;
}) {
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null);

  function snapFor(px: number, total: number): SheetState {
    const stops: [SheetState, number][] = [
      [canClose ? "closed" : "peek", canClose ? 0 : PEEK],
      ["half", total * HALF],
      ["full", total],
    ];
    return stops.reduce((a, b) => (Math.abs(b[1] - px) < Math.abs(a[1] - px) ? b : a))[0];
  }

  return (
    <div
      className="sheet-grip"
      role="button"
      tabIndex={0}
      aria-label={state === "full" ? "Shrink the page to see the map" : "Show more of the page"}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSnap(state === "full" ? "half" : "full");
        } else if (e.key === "ArrowDown") onSnap(state === "full" ? "half" : canClose ? "closed" : "peek");
        else if (e.key === "ArrowUp") onSnap(state === "half" ? "full" : "half");
      }}
      onPointerDown={(e) => {
        const el = panel.current;
        if (!el) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: el.getBoundingClientRect().height, moved: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        const total = panel.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
        if (!s) return;
        const dy = e.clientY - s.y;
        if (Math.abs(dy) > 6) s.moved = true;
        if (s.moved) onDrag(Math.max(0, Math.min(total, s.h - dy)));
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        const total = panel.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
        onDrag(null);
        if (!s) return;
        swallowNextClick();
        if (!s.moved) {
          // A tap: tucked or half opens up a step; full drops back to half.
          onSnap(state === "half" ? "full" : "half");
          return;
        }
        onSnap(snapFor(Math.max(0, s.h - (e.clientY - s.y)), total));
      }}
      onPointerCancel={() => {
        start.current = null;
        onDrag(null);
      }}
    >
      <span className="grip-bar" aria-hidden="true" />
      {state === "peek" && title && <span className="grip-title">{title}</span>}
    </div>
  );
}

/**
 * After a tap or drag on the handle, the phone still sends a click. iPhones aim
 * it at the nearest button and the sheet has already moved, so it could land on
 * the banner or avatar under the handle and open the photo (11.97). Drop it.
 */
function swallowNextClick() {
  const stop = (e: Event) => {
    // Browsers that send it to the handle itself are fine; keep waiting for a stray one.
    if ((e.target as Element | null)?.closest?.(".sheet-grip")) return;
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener("click", stop, true);
  };
  window.addEventListener("click", stop, true);
  setTimeout(() => window.removeEventListener("click", stop, true), 400);
}

/** Height of the tucked sheet (just the handle and a title). */
export const PEEK = 56;
/** "Just under half" of the screen. */
export const HALF = 0.45;
