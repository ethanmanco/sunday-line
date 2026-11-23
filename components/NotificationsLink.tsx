"use client";

import Link from "next/link";
import { accountsEnabled } from "@/lib/supabase";
import { countLabel, useUnreadNotifications } from "@/lib/useUnread";
import { useAuth } from "./AuthProvider";

/** The bell in the top bar (11.40), with the number of unread notifications. */
export default function NotificationsLink() {
  const { ready, user, profile } = useAuth();
  const unread = useUnreadNotifications();
  if (!accountsEnabled || !ready || !user || !profile) return null;
  return (
    <Link href="/notifications" className="notifications-link" aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="nav-label">Notifications</span>
      {unread > 0 && <span className="badge" aria-hidden="true">{countLabel(unread)}</span>}
    </Link>
  );
}
