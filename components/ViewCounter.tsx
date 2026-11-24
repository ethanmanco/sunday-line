"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase";
import { countingAllowed, pageForPath } from "@/lib/viewCount";

const VISIT_KEY = "sl-visit-counted";

/** Supabase calls run only when awaited; a missed count is fine. */
function send(call: PromiseLike<unknown>) {
  call.then(() => undefined, () => undefined);
}

/**
 * Adds one to the anonymous page view count for each page shown, and one
 * visit per browser session (11.66). Nothing about the visitor is sent.
 */
export default function ViewCounter() {
  const pathname = usePathname();
  const { ready, user } = useAuth();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !pathname || pathname === last.current) return;
    last.current = pathname;
    const sb = getSupabase();
    if (!sb || !countingAllowed()) return;
    const counted = pageForPath(pathname);
    if (!counted) return;
    try {
      if (sessionStorage.getItem(VISIT_KEY) !== "1") {
        sessionStorage.setItem(VISIT_KEY, "1");
        send(sb.rpc("count_view", { p_page: user ? "visit_member" : "visit_guest" }));
      }
    } catch {
      // Private browsing without storage: just count the page.
    }
    send(sb.rpc("count_view", { p_page: counted.page, p_road: counted.road ?? null }));
  }, [ready, user, pathname]);

  return null;
}
