"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import PersonRow from "@/components/profile/PersonRow";
import { accountsEnabled, getSupabase, rememberReturn, type FollowStatus, type Profile } from "@/lib/supabase";

interface Person extends Pick<Profile, "id" | "username" | "display_name" | "avatar_path" | "avatar_preset" | "is_private"> {
  my_follow: FollowStatus | null;
  follows_me: boolean;
  reason: string | null;
}

/** Find people by name and follow them; plus suggestions from your groups and followers. */
export default function PeoplePage() {
  const { ready, user, profile } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [suggested, setSuggested] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.rpc("suggest_people");
    setSuggested((data as Person[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (ready && user && profile) loadSuggestions();
  }, [ready, user, profile, loadSuggestions]);

  useEffect(() => {
    const sb = getSupabase();
    const term = q.trim().replace(/^@/, "");
    if (!sb || term.length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await sb.rpc("search_people", { q: term });
      setResults((data as Person[] | null) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function toggle(p: Person) {
    const sb = getSupabase();
    if (!sb || !user) return;
    setBusy(p.id);
    let next: FollowStatus | null = null;
    if (p.my_follow) {
      if (p.my_follow === "accepted" && p.is_private && !window.confirm(`Unfollow @${p.username}? Their profile is private, so you'd have to ask again.`)) {
        setBusy(null);
        return;
      }
      await sb.from("follows").delete().eq("follower_id", user.id).eq("followee_id", p.id);
    } else {
      const { data } = await sb.from("follows").insert({ followee_id: p.id }).select("status").single();
      next = ((data as { status: FollowStatus } | null)?.status) ?? null;
    }
    const update = (list: Person[] | null) => list?.map((x) => (x.id === p.id ? { ...x, my_follow: next } : x)) ?? null;
    setResults(update);
    setSuggested(update);
    setBusy(null);
  }

  if (!accountsEnabled) return <div className="page narrow"><h1>People</h1><p>Accounts aren&apos;t switched on yet.</p></div>;
  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user || !profile) {
    return (
      <div className="page narrow">
        <h1>Find people</h1>
        <p>
          {!user ? <Link href="/signin" onClick={() => rememberReturn("/people")}>Sign in</Link> : <Link href="/me">Set up your profile</Link>} to
          find friends and follow them.
        </p>
      </div>
    );
  }

  const row = (p: Person) => (
    <PersonRow
      key={p.id}
      person={{ ...p, bio: null, banner_path: null, dm_policy: "everyone", spots_display: "none" }}
      note={[p.reason, p.follows_me && p.reason !== "Follows you" ? "Follows you" : null].filter(Boolean).join(" · ") || null}
    >
      <button
        type="button"
        className={`button small${p.my_follow ? " ghost" : ""}`}
        disabled={busy === p.id}
        onClick={() => toggle(p)}
      >
        {p.my_follow === "accepted" ? "Following" : p.my_follow === "pending" ? "Requested" : p.follows_me ? "Follow back" : "Follow"}
      </button>
    </PersonRow>
  );

  return (
    <div className="page narrow">
      <h1>Find people</h1>
      <div className="form">
        <label>
          <span>Search by name or @username</span>
          <input type="search" autoComplete="off" autoCapitalize="none" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or @username" />
        </label>
      </div>
      {results && (
        <section aria-labelledby="results">
          <h2 id="results">Results</h2>
          {results.length === 0 ? <p className="fine">No one by that name.</p> : <ul className="people">{results.map(row)}</ul>}
        </section>
      )}
      <section aria-labelledby="suggested">
        <h2 id="suggested">People you may know</h2>
        {!suggested ? <p className="fine">Loading...</p> : suggested.length === 0 ? (
          <p className="fine">Join a <Link href="/groups">group</Link> to meet people. Followers who you don&apos;t follow back show up here too.</p>
        ) : (
          <ul className="people">{suggested.map(row)}</ul>
        )}
      </section>
      <p className="fine">Following a private profile sends a request they approve.</p>
    </div>
  );
}
