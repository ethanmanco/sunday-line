"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMapShell } from "@/lib/mapShell";
import { loadPlaces, searchPlaces, type PlaceHit } from "@/lib/places";

/**
 * Find a town or state and move the map there (11.32). A town also becomes
 * where distances are measured from. Searches a list in the browser; what's
 * typed never leaves the device.
 */
export default function PlaceSearch() {
  const shell = useMapShell();
  const id = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const place = shell?.placeName ?? null;

  useEffect(() => {
    let live = true;
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    loadPlaces()
      .then((d) => {
        if (!live) return;
        setFailed(false);
        setReady(true);
        setHits(searchPlaces(d, q));
        setActive(0);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [q]);

  // Close the list on a tap outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!shell) return null;

  function choose(h: PlaceHit) {
    shell!.goToPlace({ name: h.label, point: h.point, bbox: h.bbox });
    setQ("");
    setHits([]);
    setOpen(false);
    input.current?.blur();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      choose(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && q.trim().length >= 2;
  return (
    <div className="place-search" ref={box}>
      <label className="place-field">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="visually-hidden">Find a town or city</span>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={showList && hits.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${id}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          value={q}
          placeholder={place ?? "Find a town or city"}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            loadPlaces().catch(() => setFailed(true));
          }}
          onKeyDown={onKey}
        />
      </label>
      {place && !q && (
        <button type="button" className="place-clear" aria-label={`Stop measuring from ${place}`} title="Measure from the map center" onClick={shell.clearMyLocation}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        </button>
      )}
      {showList && (
        <ul id={`${id}-list`} role="listbox" className="place-list" aria-label="Places">
          {hits.map((h, i) => (
            <li key={h.key} id={`${id}-${i}`} role="option" aria-selected={i === active}
              onPointerDown={(e) => e.preventDefault()} onClick={() => choose(h)} onMouseEnter={() => setActive(i)}>
              <span>{h.label}</span>
              {h.detail && <span className="fine">{h.detail}</span>}
            </li>
          ))}
          {hits.length === 0 && (
            <li className="place-none" role="presentation">{failed ? "Couldn't load places. Check your connection." : ready ? "No towns match." : "Loading places..."}</li>
          )}
        </ul>
      )}
    </div>
  );
}
