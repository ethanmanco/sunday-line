"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import GroupAvatar from "@/components/groups/GroupAvatar";
import { useAuth } from "@/components/AuthProvider";
import { accountsEnabled, getSupabase, rememberReturn, timeAgo, type ConversationSummary } from "@/lib/supabase";

export default function Inbox() {
  const { ready, user, profile } = useAuth();
  const [rows, setRows] = useState<ConversationSummary[] | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.rpc("my_conversations");
    setRows((data as ConversationSummary[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (!ready || !user) return;
    load();
    const sb = getSupabase();
    if (!sb) return;
    // Refresh when a message arrives anywhere you can read.
    const channel = sb
      .channel("inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => load())
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [ready, user, load]);

  if (!accountsEnabled) return <div className="page narrow"><h1>Messages</h1><p>Accounts aren&apos;t switched on yet.</p></div>;
  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user) {
    return (
      <div className="page narrow">
        <h1>Messages</h1>
        <p><Link href="/signin" onClick={() => rememberReturn("/messages")}>Sign in</Link> to message people and groups.</p>
      </div>
    );
  }
  if (!profile) return <div className="page narrow"><h1>Messages</h1><p><Link href="/me">Set up your profile</Link> first.</p></div>;

  return (
    <div className="page narrow">
      <h1>Messages</h1>
      {!rows ? <p className="fine">Loading...</p> : rows.length === 0 ? (
        <p className="fine">
          No conversations yet. Tap Message on someone&apos;s profile, or join a <Link href="/groups">group</Link> to use its chat.
        </p>
      ) : (
        <ul className="inbox">
          {rows.map((c) => {
            const name = c.kind === "group" ? c.group_name : c.other_display_name;
            const preview = c.last_body ?? (c.last_has_media ? "Photo" : c.last_message_at ? "" : "No messages yet");
            const from = c.last_sender_id === user.id ? "You: " : "";
            return (
              <li key={c.id}>
                <Link href={`/messages/${c.id}`} className={`inbox-row${c.unread ? " unread" : ""}`}>
                  {c.kind === "group" ? (
                    <GroupAvatar shortId={c.group_short_id} name={c.group_name} size={44} />
                  ) : (
                    <Avatar person={{ display_name: c.other_display_name ?? "?", avatar_path: c.other_avatar_path, avatar_preset: c.other_avatar_preset }} size={44} />
                  )}
                  <span className="inbox-text">
                    <span className="inbox-top">
                      <b>{name}</b>
                      {c.kind === "group" && <span className="tag">Group</span>}
                      {c.last_message_at && <span className="fine">{timeAgo(c.last_message_at)}</span>}
                    </span>
                    <span className="fine preview">{from}{preview}</span>
                  </span>
                  {c.unread > 0 && <span className="badge" aria-label={`${c.unread} unread`}>{c.unread > 99 ? "99+" : c.unread}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
