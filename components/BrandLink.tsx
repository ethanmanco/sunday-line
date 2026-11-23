"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_NAME } from "@/lib/config";

/**
 * The logo in the top bar. On the map already, a tap is a soft refresh (11.46):
 * the map shell closes what's open and goes back to its starting view, and the
 * link lets go of focus so it doesn't stay lit.
 */
export default function BrandLink() {
  const pathname = usePathname();
  return (
    <Link
      href="/"
      className="brand"
      aria-label={`${SITE_NAME} home`}
      onClick={(e) => {
        const el = e.currentTarget;
        setTimeout(() => el.blur(), 150);
        if (pathname === "/") {
          e.preventDefault();
          window.dispatchEvent(new Event("sl-home"));
        }
      }}
    >
      <span className="brand-mark" aria-hidden="true" />
      SUNDAY LINE
    </Link>
  );
}
