"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

/**
 * Live unread counts for the top bar and the installed app's bar (11.51):
 * refreshed on page changes, on focus, on the app's own events, and by realtime.
 */
function useUnread(rpc: "unread_notifications" | "unread_count", events: string[], table: "notifications" | "messages"): number {
  const { ready, user, profile } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const channelId = useId();

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user) return;
    const { data } = await sb.rpc(rpc);
    setUnread(Number(data ?? 0));
  }, [user, rpc]);

  useEffect(() => {
    if (!ready || !user || !profile) return;
    refresh();
  }, [ready, user, profile, pathname, refresh]);

  const eventKey = events.join(",");
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !user || !profile) return;
    const onFocus = () => refresh();
    const names = ["focus", ...eventKey.split(",")];
    for (const n of names) window.addEventListener(n, onFocus);
    const channel = sb
      .channel(`${table}-${channelId}`)
      .on(
        "postgres_changes",
        table === "notifications"
          ? { event: "*", schema: "public", table, filter: `user_id=eq.${user.id}` }
          : { event: "INSERT", schema: "public", table },
        () => refresh(),
      )
      .subscribe();
    return () => {
      for (const n of names) window.removeEventListener(n, onFocus);
      sb.removeChannel(channel);
    };
  }, [user, profile, refresh, table, eventKey, channelId]);

  // The installed app's icon shows the bell's number (11.76), where supported.
  const count = user && profile ? unread : 0;
  useEffect(() => {
    if (rpc !== "unread_notifications" || !ready) return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge || !nav.clearAppBadge) return;
    (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {});
  }, [rpc, ready, count]);

  return count;
}

/** Unread notifications (11.40). Reading a chat clears its notification, so sl-unread refreshes it too. */
export const useUnreadNotifications = () => useUnread("unread_notifications", ["sl-notifications", "sl-unread"], "notifications");

/** Unread messages. */
export const useUnreadMessages = () => useUnread("unread_count", ["sl-unread"], "messages");

/** "99+" past 99. */
export const countLabel = (n: number) => (n > 99 ? "99+" : String(n));
