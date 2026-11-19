"use client";

import { useEffect, useMemo, useState } from "react";

export interface LibraryItem {
  id: string;
  file: string;
  make: string;
  model: string;
  years?: string;
  kind: "car" | "truck" | "motorcycle";
  tags: string[];
  license: string;
  creator: string | null;
  source: string;
}

const FILTERS: [string, string][] = [
  ["", "All"],
  ["classic", "Classics"],
  ["muscle", "Muscle"],
  ["80s", "80s"],
  ["90s", "90s"],
  ["2000s", "2000s"],
  ["jdm", "JDM"],
  ["euro", "Euro"],
  ["sportscar", "Sports cars"],
  ["supercar", "Supercars"],
  ["hypercar", "Hypercars"],
  ["truck", "Trucks and SUVs"],
  ["rally", "Rally and race"],
  ["motorcycle", "Bikes"],
];

let cache: Promise<LibraryItem[]> | null = null;
function loadLibrary(): Promise<LibraryItem[]> {
  cache ??= fetch("/avatars/library/index.json")
    .then((r) => r.json())
    .then((d: { items: LibraryItem[] }) => d.items)
    .catch(() => {
      cache = null;
      return [];
    });
  return cache;
}

function label(it: LibraryItem): string {
  return [it.years, it.make !== "Various" ? it.make : null, it.model].filter(Boolean).join(" ");
}

/** Pick a profile picture from 200 public-domain car and bike photos (11.28). */
export default function AvatarLibraryPicker({ current, busy, onPick, onCancel }: {
  current: string | null;
  busy: boolean;
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<string | null>(current);

  useEffect(() => {
    loadLibrary().then(setItems);
  }, []);

  const shown = useMemo(() => {
    if (!items) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      const hay = [it.make, it.model, it.years ?? "", it.kind, ...it.tags].join(" ").toLowerCase();
      if (filter && !it.tags.includes(filter) && !(filter === "rally" && it.tags.includes("race"))) return false;
      return words.every((w) => hay.includes(w));
    });
  }, [items, q, filter]);

  const pick = items?.find((it) => it.id === chosen) ?? null;

  return (
    <div className="library-picker">
      <label className="library-search">
        <span className="visually-hidden">Search the photos</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: Audi, Supra, Mustang, 90s, Harley..." />
      </label>
      <div className="chips" role="group" aria-label="Kinds">
        {FILTERS.map(([k, name]) => (
          <button key={k || "all"} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{name}</button>
        ))}
      </div>
      {!items ? (
        <p className="fine">Loading photos...</p>
      ) : shown.length === 0 ? (
        <p className="fine">No photos match. Try a make or a decade, like &quot;Porsche&quot; or &quot;70s&quot;.</p>
      ) : (
        <div className="library-grid" role="listbox" aria-label="Photos">
          {shown.map((it) => (
            <button key={it.id} type="button" role="option" aria-selected={chosen === it.id} title={label(it)}
              className="library-tile" onClick={() => setChosen(it.id)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.file} alt={label(it)} loading="lazy" width={96} height={96} />
            </button>
          ))}
        </div>
      )}
      {pick && (
        <p className="fine library-credit">
          {label(pick)}. Photo{pick.creator ? ` by ${pick.creator}` : ""},{" "}
          <a href={pick.source} target="_blank" rel="noopener noreferrer">{pick.license === "CC0" ? "CC0" : "public domain"}</a>.
        </p>
      )}
      <div className="row">
        <button type="button" className="button" disabled={busy || !chosen || chosen === current} onClick={() => chosen && onPick(chosen)}>
          {busy ? "Saving..." : "Use this photo"}
        </button>
        <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
        <a className="fine" href="/avatars/library/CREDITS.md" target="_blank" rel="noopener noreferrer">All photo credits</a>
      </div>
    </div>
  );
}
