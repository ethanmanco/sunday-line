"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { accountsEnabled, getSupabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

/** "Messages" in the top bar, with the number of unread messages. */
export default function MessagesLink() {
  const { ready, user, profile } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user) return;
    const { data } = await sb.rpc("unread_count");
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
    window.addEventListener("sl-unread", onFocus);
    const channel = sb
      .channel("unread")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => refresh())
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("sl-unread", onFocus);
      sb.removeChannel(channel);
    };
  }, [user, profile, refresh]);

  if (!accountsEnabled || !ready || !user || !profile) return null;
  return (
    <Link href="/messages" className="messages-link" aria-label={unread ? `Messages, ${unread} unread` : "Messages"}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="nav-label">Messages</span>
      {unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}
