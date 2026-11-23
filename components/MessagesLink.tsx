"use client";

import Link from "next/link";
import { accountsEnabled } from "@/lib/supabase";
import { countLabel, useUnreadMessages } from "@/lib/useUnread";
import { useAuth } from "./AuthProvider";

/** "Messages" in the top bar, with the number of unread messages. */
export default function MessagesLink() {
  const { ready, user, profile } = useAuth();
  const unread = useUnreadMessages();
  if (!accountsEnabled || !ready || !user || !profile) return null;
  return (
    <Link href="/messages" className="messages-link" aria-label={unread ? `Messages, ${unread} unread` : "Messages"}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="nav-label">Messages</span>
      {unread > 0 && <span className="badge" aria-hidden="true">{countLabel(unread)}</span>}
    </Link>
  );
}
