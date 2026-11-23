"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { accountsEnabled, getSupabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

/** The bell in the top bar (11.40), with the number of unread notifications. */
export default function NotificationsLink() {
  const { ready, user, profile } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user) return;
    const { data } = await sb.rpc("unread_notifications");
    setUnread(Number(data ?? 0));
  }, [user]);

  useEffect(() => {
    if (!ready || !user || !profile) return;
    refresh();
  }, [ready, user, profile, pathname, refresh]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !user || !profile) return;
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("sl-notifications", onFocus);
    window.addEventListener("sl-unread", onFocus); // reading a chat clears its notification
    const channel = sb
      .channel("notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => refresh())
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("sl-notifications", onFocus);
      window.removeEventListener("sl-unread", onFocus);
      sb.removeChannel(channel);
    };
  }, [user, profile, refresh]);

  if (!accountsEnabled || !ready || !user || !profile) return null;
  return (
    <Link href="/notifications" className="notifications-link" aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="nav-label">Notifications</span>
      {unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}
