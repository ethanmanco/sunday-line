"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase, type GroupVisibility, type JoinPolicy } from "@/lib/supabase";

export default function NewGroup() {
  const router = useRouter();
  const { ready, user, profile } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [area, setArea] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("public");
  const [join, setJoin] = useState<JoinPolicy>("request");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user || !profile) {
    return (
      <div className="page narrow">
        <h1>Start a group</h1>
        <p>{!user ? <Link href="/signin">Sign in</Link> : <Link href="/me">Set up your profile</Link>} first.</p>
      </div>
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const { data, error } = await sb.rpc("create_group", {
      p_name: name,
      p_description: description,
      p_home_area: area,
      p_visibility: visibility,
      p_join_policy: join,
    });
    setBusy(false);
    if (error || !data) {
      setError(error?.message.includes("20 groups") ? "You can organize up to 20 groups." : "Couldn't create the group. Names are 3 to 60 characters.");
      return;
    }
    router.push(`/g/${data as string}`);
  }

  return (
    <div className="page narrow">
      <h1>Start a group</h1>
      <form onSubmit={create} className="form">
        <label>
          <span>Name</span>
          <input required minLength={3} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday Morning Drivers" />
        </label>
        <label>
          <span>Area (optional)</span>
          <input maxLength={80} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Asheville, NC" />
        </label>
        <label>
          <span>About the group (optional)</span>
          <textarea maxLength={1000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who it's for, when you usually meet, the vibe" />
        </label>
        <fieldset>
          <legend>Who can find it</legend>
          <div className="seg">
            <button type="button" aria-pressed={visibility === "public"} onClick={() => setVisibility("public")}>Public</button>
            <button type="button" aria-pressed={visibility === "private"} onClick={() => setVisibility("private")}>Private</button>
          </div>
          <span className="fine">
            {visibility === "public"
              ? "Anyone can see the group and its description. Members, chat, and plans stay members-only."
              : "Only members can see the group. People join with an invite link."}
          </span>
        </fieldset>
        {visibility === "public" && (
          <fieldset>
            <legend>How people join</legend>
            <div className="seg">
              <button type="button" aria-pressed={join === "request"} onClick={() => setJoin("request")}>They ask, you approve</button>
              <button type="button" aria-pressed={join === "open"} onClick={() => setJoin("open")}>Anyone can join</button>
            </div>
          </fieldset>
        )}
        <button type="submit" className="button" disabled={busy}>{busy ? "Creating..." : "Create group"}</button>
        {error && <p className="hint warn" role="alert">{error}</p>}
        <p className="fine">You&apos;ll be the organizer. You can add moderators and choose what each one can do.</p>
      </form>
    </div>
  );
}
