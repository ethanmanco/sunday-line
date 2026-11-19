"use client";

import { useState } from "react";
import { vehicleName, type Vehicle, type VehiclePhoto } from "@/lib/supabase";
import { openPhoto } from "@/components/PhotoViewer";

/** A garage vehicle: swipe through its photos (cover first). */
export default function VehicleCard({ vehicle, photos, urls, children }: {
  vehicle: Vehicle;
  photos: VehiclePhoto[];
  urls: Record<string, string>;
  children?: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const shown = photos.filter((p) => urls[p.path]);
  const name = vehicleName(vehicle);

  return (
    <li className="vehicle">
      {shown.length ? (
        <div className="vehicle-photos">
          <div
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
                onClick={() => openPhoto(urls[p.path], `${name}, photo ${i + 1}`)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPhoto(urls[p.path], `${name}, photo ${i + 1}`)}
              />
            ))}
          </div>
          {shown.length > 1 && (
            <span className="photo-count" aria-hidden="true">{Math.min(index + 1, shown.length)} / {shown.length}</span>
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
