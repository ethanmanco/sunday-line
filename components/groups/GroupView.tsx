"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Thread from "@/components/messages/Thread";
import GroupManage from "./GroupManage";
import GroupMembers from "./GroupMembers";
import GroupSpots from "./GroupSpots";
import GroupEvents from "@/components/events/GroupEvents";
import { openPhoto } from "@/components/PhotoViewer";
import { usePageOnMap } from "@/lib/usePageOnMap";
import { linkedSpots, type Spot } from "@/lib/spots";
import { accountsEnabled, getSupabase, rememberReturn, signedGroupUrls, type Group, type GroupRole } from "@/lib/supabase";

type Tab = "events" | "spots" | "chat" | "members" | "manage";

export interface Membership {
  role: GroupRole;
  permissions: string[];
}

export function can(m: Membership | null, perm: string): boolean {
  return !!m && (m.role === "organizer" || (m.role === "moderator" && m.permissions.includes(perm)));
}

export default function GroupView({ shortId }: { shortId: string }) {
  const router = useRouter();
  const { ready, user, profile } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [missing, setMissing] = useState(false);
  const [me, setMe] = useState<Membership | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [requested, setRequested] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return t === "spots" || t === "chat" || t === "members" || t === "manage" ? t : "events";
  });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [mapSpots, setMapSpots] = useState<Spot[] | null>(null);
  const shell = usePageOnMap(group?.name ?? null, mapSpots);
  const tabsRef = useRef<HTMLDivElement>(null);
  // The chat fills the panel (phones: the whole sheet): tabs at the top, the
  // message box at the bottom edge, no space under it (11.46, 11.47).
  const chatOpen = tab === "chat";
  const isSheet = shell?.isSheet ?? false;
  const setSheet = shell?.setSheet;
  useEffect(() => {
    if (!chatOpen) return;
    if (isSheet && setSheet) setSheet("full");
    const t = setTimeout(() => tabsRef.current?.scrollIntoView({ block: "start" }), isSheet ? 250 : 0);
    return () => clearTimeout(t);
  }, [chatOpen, isSheet, setSheet]);

  // The page's map: accepted spots for members; ones on the public map for everyone else.
  const loadMap = useCallback(async (groupId: string, member: boolean) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("spot_groups").select("status, spot:spots!inner(*)")
      .eq("group_id", groupId).eq("status", "accepted").limit(500);
    const list = linkedSpots(data);
    setMapSpots(member ? list : list.filter((s) => s.public_status === "approved"));
  }, []);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("groups").select("*").eq("short_id", shortId).maybeSingle();
    if (!data) {
      setMissing(true);
      return;
    }
    const g = data as Group;
    setGroup(g);
    signedGroupUrls([g.avatar_path, g.banner_path]).then(setUrls);
    const [c, m, r, conv] = await Promise.all([
      sb.rpc("group_member_count", { p_group: g.id }),
      user
        ? sb.from("group_members").select("role, permissions").eq("group_id", g.id).eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      user
        ? sb.from("join_requests").select("group_id").eq("group_id", g.id).eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      sb.from("conversations").select("id").eq("group_id", g.id).maybeSingle(),
    ]);
    setCount((c.data as number | null) ?? null);
    setMe((m.data as Membership | null) ?? null);
    setRequested(Boolean(r.data));
    setChatId(((conv.data as { id: string } | null)?.id) ?? null);
    await loadMap(g.id, Boolean(m.data));
  }, [shortId, user, loadMap]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!accountsEnabled) return <div className="page narrow"><h1>Groups</h1><p>Accounts aren&apos;t switched on yet.</p></div>;
  if (missing) {
    return (
      <div className="page narrow">
        <h1>Group not found</h1>
        <p>
          It may be private (members only) or it no longer exists.
          {!user && <> <Link href="/signin" onClick={() => rememberReturn(`/g/${shortId}`)}>Sign in</Link> if you&apos;re a member.</>}
        </p>
        <p><Link href="/groups">Find a group</Link></p>
      </div>
    );
  }
  if (!group) return <div className="page narrow"><p>Loading...</p></div>;

  const g = group;

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>, fail: string) {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setError(fail);
    await load();
  }

  const sb = getSupabase()!;
  const join = () => act(() => sb.rpc("join_group", { p_group: g.id }), "Couldn't join right now.");
  const ask = () =>
    act(() => sb.from("join_requests").insert({ group_id: g.id, message: note.trim() || null }), "Couldn't send the request.").then(() => setAsking(false));
  const withdraw = () => act(() => sb.from("join_requests").delete().eq("group_id", g.id).eq("user_id", user!.id), "Couldn't withdraw.");
  const leave = async () => {
    if (!window.confirm(`Leave ${g.name}? You'll lose the group chat.`)) return;
    await act(() => sb.from("group_members").delete().eq("group_id", g.id).eq("user_id", user!.id), "Couldn't leave.");
  };

  let action: React.ReactNode = null;
  if (!user) {
    action = <Link href="/signin" className="button" onClick={() => rememberReturn(`/g/${g.short_id}`)}>Sign in to join</Link>;
  } else if (!profile) {
    action = <Link href="/me" className="button">Set up your profile to join</Link>;
  } else if (me) {
    action = me.role === "organizer" ? <span className="tag">Organizer</span> : (
      <button type="button" className="button ghost small" disabled={busy} onClick={leave}>Leave group</button>
    );
  } else if (g.join_policy === "open") {
    action = <button type="button" className="button" disabled={busy} onClick={join}>Join</button>;
  } else if (requested) {
    action = <button type="button" className="button ghost" disabled={busy} onClick={withdraw}>Requested</button>;
  } else {
    action = <button type="button" className="button" disabled={busy} onClick={() => setAsking(true)} aria-expanded={asking}>Ask to join</button>;
  }

  const bannerUrl = g.banner_path ? urls[g.banner_path] : undefined;
  const avatarUrl = g.avatar_path ? urls[g.avatar_path] : undefined;
  const manages = me &&(me.role === "organizer" || can(me, "approve") || can(me, "invites"));

  return (
    <div className="page group">
      {/* Laid out like a profile (11.93): the button beside the picture, a back arrow on the banner. */}
      <header className="group-head">
        <Link href="/groups" className="banner-back" aria-label="All groups">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Link>
        {bannerUrl ? (
          <button type="button" className="banner banner-button" style={{ backgroundImage: `url("${bannerUrl}")` }}
            aria-label={`View the ${g.name} banner`} onClick={() => openPhoto(bannerUrl, `${g.name} banner`)} />
        ) : (
          <div className="banner" />
        )}
        <div className="group-id">
          {avatarUrl ? (
            <button type="button" className="avatar-button square" aria-label={`View the ${g.name} picture`}
              onClick={() => openPhoto(avatarUrl, `${g.name} picture`)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarUrl} alt="" className="group-avatar big" width={88} height={88} />
            </button>
          ) : (
            <span className="group-mark big" aria-hidden="true">{g.name.trim()[0]?.toUpperCase()}</span>
          )}
          <div className="profile-actions">{action}</div>
        </div>
        <h1>{g.name}</h1>
        <p className="handle">
          {[g.home_area, g.visibility === "private" ? "Private group" : "Public group", count !== null ? `${count} ${count === 1 ? "member" : "members"}` : null]
            .filter(Boolean).join(" · ")}
        </p>
        {g.description && <p className="bio">{g.description}</p>}
        {requested && !me && <p className="fine">Waiting for the organizers to approve. Tap Requested to withdraw.</p>}
        {asking && !me && (
          <div className="form rate">
            <label>
              <span>Note to the organizers (optional)</span>
              <textarea maxLength={300} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you drive, who you know in the group" />
            </label>
            <div className="row">
              <button type="button" className="button" disabled={busy} onClick={ask}>Send request</button>
              <button type="button" className="button ghost" onClick={() => setAsking(false)}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p className="hint warn" role="alert">{error}</p>}
      </header>

      {me ? (
        <>
          <div ref={tabsRef} className="tabs" role="tablist" aria-label="Group sections">
            {([["events", "Events"], ["spots", "Spots"], ["chat", "Chat"], ["members", "Members"], ...(manages ? [["manage", "Manage"]] : [])] as [Tab, string][]).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === "events" && <GroupEvents group={g} me={me} myId={user!.id} />}
            {tab === "spots" && (
              <GroupSpots group={g} me={me} myId={user!.id}
                onFocus={(id) => shell?.focusSpot(id)} onChanged={() => loadMap(g.id, true)} />
            )}
            {tab === "chat" && chatId && <Thread conversationId={chatId} embedded />}
            {tab === "members" && <GroupMembers group={g} me={me} myId={user!.id} onChanged={load} />}
            {tab === "manage" && manages && (
              <GroupManage group={g} me={me} urls={urls} onChanged={load} onDeleted={() => router.replace("/groups")} />
            )}
          </div>
        </>
      ) : (
        <>
          <p className="panel-note">Members see the group&apos;s events, spots, chat, and who&apos;s in the group.</p>
          <GroupSpots group={g} me={null} myId={user?.id ?? null}
            onFocus={(id) => shell?.focusSpot(id)} onChanged={() => loadMap(g.id, false)} />
        </>
      )}
    </div>
  );
}
