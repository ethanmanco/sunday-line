"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getRoute } from "@/lib/dayRoute";

/** "Route (3)" on the home map once a day route has roads in it (11.85). */
export default function RouteChip() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(getRoute().length);
    update();
    window.addEventListener("sl-route", update);
    return () => window.removeEventListener("sl-route", update);
  }, []);
  if (!count) return null;
  return (
    <Link href="/route" className="map-chip route-chip">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
      </svg>
      Route ({count})
    </Link>
  );
}
