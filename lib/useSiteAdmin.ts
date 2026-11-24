"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase";

// One check per signed-in person per page load.
let cached: { userId: string; admin: Promise<boolean> } | null = null;

/** True for the site admin. Only shows links: the database refuses everyone else. */
export function useSiteAdmin(): boolean {
  const { user } = useAuth();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    const sb = getSupabase();
    if (!user || !sb) {
      setAdmin(false);
      return;
    }
    if (cached?.userId !== user.id) {
      const check = sb.rpc("am_site_admin").then(({ data }) => Boolean(data), () => false);
      cached = { userId: user.id, admin: Promise.resolve(check) };
    }
    let live = true;
    cached.admin.then((ok) => live && setAdmin(ok));
    return () => {
      live = false;
    };
  }, [user]);
  return admin;
}
