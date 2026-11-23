"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import PushToggle from "@/components/PushToggle";
import AdminQueues from "@/components/AdminQueues";
import { ago } from "@/lib/headsUps";
import { describe, loadNotifications, markAllRead, type AppNotification } from "@/lib/notifications";
import { roadsById, type RoadOnMap } from "@/lib/roadData";
import { getSupabase, rememberReturn } from "@/lib/supabase";

/** Everything that happened that concerns you (11.40). Opening the page marks it all read. */
export default function NotificationsPage() {
  const { ready, user, profile } = useAuth();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [roads, setRoads] = useState<Record<string, RoadOnMap>>({});
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState<Record<string, string>>({});
  // Still open, whatever the read mark says: follow requests (by who asked) and group invites (by group).
  const [openFollows, setOpenFollows] = useState<Set<string>>(new Set());
  const [openInvites, setOpenInvites] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const list = await loadNotifications();
    if (!list) return setFailed(true);
    setFailed(false);
    setItems(list);
    setNewIds((prev) => new Set([...prev, ...list.filter((n) => !n.read_at).map((n) => n.id)]));
    if (list.some((n) => !n.read_at)) markAllRead();
    const sb = getSupabase();
    if (sb && user) {
      const [f, i] = await Promise.all([
        sb.from("follows").select("follower_id").eq("followee_id", user.id).eq("status", "pending"),
        sb.from("group_member_invites").select("group_id").eq("user_id", user.id),
      ]);
      setOpenFollows(new Set(((f.data as { follower_id: string }[] | null) ?? []).map((r) => r.follower_id)));
      setOpenInvites(new Set(((i.data as { group_id: string }[] | null) ?? []).map((r) => r.group_id)));
    }
    const ids = [...new Set(list.map((n) => n.road_id).filter((x): x is string => !!x))];
    if (ids.length) setRoads(await roadsById(ids));
  }, [user]);

  useEffect(() => {
    if (ready && user && profile) load();
  }, [ready, user, profile, load]);

  async function answerFollow(n: AppNotification, accept: boolean) {
    const sb = getSupabase();
    if (!sb || !user || !n.actor_id) return;
    const q = sb.from("follows");
    const { error } = accept
      ? await q.update({ status: "accepted" }).eq("follower_id", n.actor_id).eq("followee_id", user.id)
      : await q.delete().eq("follower_id", n.actor_id).eq("followee_id", user.id);
    setAnswered((a) => ({ ...a, [n.id]: error ? "Couldn't save. Try again." : accept ? "Accepted" : "Declined" }));
  }

  async function answerInvite(n: AppNotification, accept: boolean) {
    const { error } = (await getSupabase()?.rpc("answer_group_invite", { p_group: n.group_id, p_accept: accept })) ?? {};
    setAnswered((a) => ({ ...a, [n.id]: error ? "That invite is no longer open." : accept ? "Joined" : "Declined" }));
    if (!error && accept) load();
  }

  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user || !profile) {
    return (
      <div className="page narrow">
        <h1>Notifications</h1>
        <p>
          <Link href="/signin" onClick={() => rememberReturn("/notifications")}>Sign in</Link> to see your notifications.
        </p>
      </div>
    );
  }

  const roadName = (id: string) => roads[id]?.name ?? "a road";
  return (
    <div className="page narrow">
      <h1>Notifications</h1>
      <PushToggle />
      {failed ? (
        <p className="fine">Couldn&apos;t load notifications. Check your connection.</p>
      ) : items === null ? (
        <p className="fine">Loading...</p>
      ) : items.length === 0 ? (
        <p className="fine">Nothing yet. Follow requests, group invites, events, messages, and road updates show up here.</p>
      ) : (
        <ul className="notif-list">
          {items.map((n) => {
            const { text, href } = describe(n, roadName);
            const done = answered[n.id];
            const pendingFollow = n.kind === "follow_request" && !!n.actor_id && openFollows.has(n.actor_id);
            const pendingInvite = n.kind === "group_invite" && !!n.group_id && openInvites.has(n.group_id);
            return (
              <li key={n.id} className={newIds.has(n.id) ? "notif new" : "notif"}>
                <Link href={href} className="notif-text">{text}</Link>
                <span className="fine">{ago(n.created_at)}</span>
                {done ? (
                  <span className="fine" role="status">{done}</span>
                ) : pendingFollow || pendingInvite ? (
                  <div className="row">
                    <button type="button" className="button small" onClick={() => (pendingFollow ? answerFollow(n, true) : answerInvite(n, true))}>
                      {pendingFollow ? "Accept" : "Join"}
                    </button>
                    <button type="button" className="button ghost small" onClick={() => (pendingFollow ? answerFollow(n, false) : answerInvite(n, false))}>
                      Decline
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <AdminQueues />
    </div>
  );
}
