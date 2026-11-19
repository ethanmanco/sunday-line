"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { accountsEnabled, getSupabase, rememberReturn, type Group, type GroupRole } from "@/lib/supabase";

interface Mine extends Group {
  role: GroupRole;
}

export default function GroupsPage() {
  const { ready, user, profile } = useAuth();
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [found, setFound] = useState<Group[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !ready) return;
    if (user) {
      sb.from("group_members")
        .select("role, group:groups(*)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false })
        .then(({ data }) => {
          const rows = (data as unknown as { role: GroupRole; group: Group | null }[]) ?? [];
          setMine(rows.flatMap((r) => (r.group ? [{ ...r.group, role: r.role }] : [])));
        });
    } else setMine([]);
  }, [ready, user]);

  // Public groups, filtered by name or area as you type.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    const t = setTimeout(async () => {
      let query = sb.from("groups").select("*").eq("visibility", "public").order("created_at", { ascending: false }).limit(50);
      // Keep only plain words: these characters mean something in the search filter.
      const term = q.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim();
      if (term) query = query.or(`name.ilike.%${term}%,home_area.ilike.%${term}%`);
      const { data } = await query;
      setFound((data as Group[] | null) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (!accountsEnabled) {
    return <div className="page narrow"><h1>Groups</h1><p>Accounts aren&apos;t switched on for this copy of the site yet.</p></div>;
  }

  return (
    <div className="page narrow">
      <h1>Groups</h1>
      <p className="lead">Car and bike groups for Sunday drives, meets, and track days.</p>
      {!user ? (
        <p><Link href="/signin" onClick={() => rememberReturn("/groups")}>Sign in</Link> to start or join a group.</p>
      ) : !profile ? (
        <p><Link href="/me">Set up your profile</Link> to start or join a group.</p>
      ) : (
        <p><Link href="/groups/new" className="button">Start a group</Link></p>
      )}

      {user && (
        <section aria-labelledby="your-groups">
          <h2 id="your-groups">Your groups</h2>
          {!mine ? <p className="fine">Loading...</p> : mine.length === 0 ? (
            <p className="fine">You haven&apos;t joined any groups yet.</p>
          ) : (
            <ul className="group-list">
              {mine.map((g) => <GroupRow key={g.id} group={g} role={g.role} />)}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="find-groups">
        <h2 id="find-groups">Find a group</h2>
        <div className="form">
          <label>
            <span>Search by name or area</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Shreveport, Miata, track..." />
          </label>
        </div>
        {!found ? <p className="fine">Loading...</p> : found.length === 0 ? (
          <p className="fine">{q ? "No public groups match." : "No public groups yet. Start the first one."}</p>
        ) : (
          <ul className="group-list">
            {found.map((g) => <GroupRow key={g.id} group={g} />)}
          </ul>
        )}
        <p className="fine">Private groups don&apos;t show up here. You join them with an invite link.</p>
      </section>
    </div>
  );
}

function GroupRow({ group, role }: { group: Group; role?: GroupRole }) {
  return (
    <li>
      <Link href={`/g/${group.short_id}`} className="group-row">
        <span className="group-mark" aria-hidden="true">{group.name.trim()[0]?.toUpperCase()}</span>
        <span>
          <b>{group.name}</b>
          <span className="fine">
            {[group.home_area, group.visibility === "private" ? "Private" : null, role && role !== "member" ? (role === "organizer" ? "You organize" : "You moderate") : null]
              .filter(Boolean).join(" · ") || " "}
          </span>
        </span>
      </Link>
    </li>
  );
}
