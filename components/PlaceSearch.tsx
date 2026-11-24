"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMapShell } from "@/lib/mapShell";
import { loadPlaces, searchPlaces, type PlaceHit, type Places } from "@/lib/places";
import { loadCell } from "@/lib/roadData";
import { haversineMi } from "@/lib/roads";
import { parseAddress, searchRoads, splitState, statesForView, type RoadHit } from "@/lib/roadSearch";

type Hit = ({ kind: "place" } & PlaceHit) | ({ kind: "road"; onIt?: boolean } & RoadHit);

/**
 * Find a town, state, or road and move the map there (11.32, 11.79). A town
 * also becomes where distances are measured from; a road opens. Towns come
 * first ("dallas" is Dallas, TX before Dallas Road); roads are searched in the
 * states in view, or the one typed. A street address ("1234 Moon Lake Rd,
 * Bossier City, LA") puts the road it's on first, when we have that road.
 * Searches files in the browser; what's typed never leaves the device.
 */
export default function PlaceSearch() {
  const shell = useMapShell();
  const id = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const place = shell?.placeName ?? null;
  const view = useRef(shell?.bounds ?? null);
  view.current = shell?.bounds ?? null;
  const origin = useRef(shell?.origin ?? ([-98.5, 39.8] as [number, number]));
  origin.current = shell?.origin ?? origin.current;

  useEffect(() => {
    let live = true;
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      let d: Places;
      try {
        d = await loadPlaces();
      } catch {
        if (live) setFailed(true);
        return;
      }
      if (!live) return;
      setFailed(false);
      setReady(true);
      const addr = parseAddress(q);
      if (addr) {
        // A street address: the road it's on (near the town, if one was given), then the town.
        const towns = addr.rest ? searchPlaces(d, addr.rest, 3) : [];
        const town = towns.find((h) => h.point);
        const st = splitState(addr.rest, d.states).st ?? (town ? town.label.slice(-2) : null);
        const near = town?.point ?? origin.current;
        const placeHits: Hit[] = towns.map((h) => ({ kind: "place", ...h }));
        setHits(placeHits);
        setActive(0);
        const roads = await searchRoads(addr.street, st ? [st] : statesForView(d.states, view.current, near), near, 3);
        if (!live) return;
        const onIt = roads.filter((r) => !town?.point || haversineMi(town.point, r.point) <= 25);
        setHits([...onIt.map((r, i): Hit => ({ kind: "road", ...r, onIt: i === 0 })), ...placeHits]);
        return;
      }
      // Towns first, as before; then roads.
      const placeHits: Hit[] = searchPlaces(d, q, 4).map((h) => ({ kind: "place", ...h }));
      setHits(placeHits);
      setActive(0);
      const { st, rest } = splitState(q, d.states);
      const roads = await searchRoads(rest, st ? [st] : statesForView(d.states, view.current, origin.current), origin.current, 5);
      if (!live) return;
      setHits([...placeHits, ...roads.map((r): Hit => ({ kind: "road", ...r }))]);
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
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

  function done() {
    setQ("");
    setHits([]);
    setOpen(false);
    input.current?.blur();
  }

  function choose(h: Hit) {
    if (h.kind === "place") {
      shell!.goToPlace({ name: h.label, point: h.point, bbox: h.bbox });
      done();
      return;
    }
    done();
    // Its square has the full road (with members' checks applied); open it.
    loadCell(h.cell)
      .then((roads) => {
        const r = roads.find((x) => x.id === h.id);
        if (r) shell!.addRoad(r);
      })
      .catch(() => {});
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
        {/* No "town", "city", "state", "street" or "address" in the label,
            placeholder or name: iOS reads those as an address form and offers
            to fill in your contact card, whatever autocomplete says. */}
        <span className="visually-hidden">Find a place or road</span>
        <input
          ref={input}
          type="search"
          name="sl-find"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showList && hits.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${id}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          value={q}
          placeholder={place ?? "Find a place or road"}
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
        <ul id={`${id}-list`} role="listbox" className="place-list" aria-label="Places and roads">
          {hits.map((h, i) => (
            <li key={h.key} id={`${id}-${i}`} role="option" aria-selected={i === active}
              onPointerDown={(e) => e.preventDefault()} onClick={() => choose(h)} onMouseEnter={() => setActive(i)}>
              {h.kind === "place" ? (
                <>
                  <span>{h.label}</span>
                  {h.detail && <span className="fine">{h.detail}</span>}
                </>
              ) : (
                <>
                  <span>{h.name}</span>
                  <span className="fine">
                    {h.onIt ? "The road at this address · " : "Road · "}
                    {h.near ? `near ${h.near}, ` : ""}{h.state}
                  </span>
                </>
              )}
            </li>
          ))}
          {hits.length === 0 && (
            <li className="place-none" role="presentation">{failed ? "Couldn't load places. Check your connection." : ready ? "Nothing matches here." : "Loading places..."}</li>
          )}
        </ul>
      )}
    </div>
  );
}
