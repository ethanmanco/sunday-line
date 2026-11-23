"use client";

import { useRef, useState } from "react";
import { vehicleName, type Vehicle, type VehiclePhoto } from "@/lib/supabase";
import { openPhotos } from "@/components/PhotoViewer";

/** A garage vehicle: swipe through its photos (cover first). */
export default function VehicleCard({ vehicle, photos, urls, children }: {
  vehicle: Vehicle;
  photos: VehiclePhoto[];
  urls: Record<string, string>;
  children?: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const shown = photos.filter((p) => urls[p.path]);
  const name = vehicleName(vehicle);
  const gallery = shown.map((p, i) => ({ src: urls[p.path], alt: `${name}, photo ${i + 1} of ${shown.length}` }));
  // Arrows for mice and keyboards; phones swipe (11.45).
  const go = (d: number) => {
    const el = strip.current;
    if (el) el.scrollTo({ left: (Math.min(shown.length - 1, Math.max(0, index + d))) * el.clientWidth, behavior: "smooth" });
  };

  return (
    <li className="vehicle">
      {shown.length ? (
        <div className="vehicle-photos">
          <div
            ref={strip}
            className="strip"
            onScroll={(e) => {
              const el = e.currentTarget;
              setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
            }}
          >
            {shown.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={urls[p.path]}
                alt={`${name}, photo ${i + 1} of ${shown.length}`}
                loading="lazy"
                role="button"
                tabIndex={0}
                onClick={() => openPhotos(gallery, i)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPhotos(gallery, i)}
              />
            ))}
          </div>
          {shown.length > 1 && (
            <>
              <span className="photo-count" aria-hidden="true">{Math.min(index + 1, shown.length)} / {shown.length}</span>
              {index > 0 && (
                <button type="button" className="strip-step prev" aria-label={`Previous photo of ${name}`} onClick={() => go(-1)}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
              {index < shown.length - 1 && (
                <button type="button" className="strip-step next" aria-label={`Next photo of ${name}`} onClick={() => go(1)}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="garage-blank" aria-hidden="true">{vehicle.kind === "motorcycle" ? "Motorcycle" : "Car"}</div>
      )}
      <p><b>{name}</b></p>
      {children}
    </li>
  );
}
