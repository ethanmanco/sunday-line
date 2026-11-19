"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import GalleryEditor from "@/components/me/GalleryEditor";
import GarageEditor from "@/components/me/GarageEditor";
import PeopleManager from "@/components/me/PeopleManager";
import ProfileEditor from "@/components/me/ProfileEditor";
import UsernameField, { BLOCKING, profileSaveError, type Availability } from "@/components/me/UsernameField";
import { getSupabase, takeReturn, USERNAME_PATTERN } from "@/lib/supabase";

export default function Me() {
  const router = useRouter();
  const { ready, user, profile, signOut } = useAuth();

  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user) {
    return (
      <div className="page narrow">
        <h1>Your profile</h1>
        <p><Link href="/signin">Sign in</Link> to rate roads and keep a profile.</p>
      </div>
    );
  }

  const signOutButton = (
    <>
      <p className="fine">Signed in as {user.email}. Your email is never shown to other people.</p>
      <button type="button" className="button ghost" onClick={async () => { await signOut(); router.replace("/"); }}>
        Sign out
      </button>
    </>
  );

  if (!profile) {
    return (
      <div className="page narrow">
        <h1>Set up your profile</h1>
        <CreateProfile userId={user.id} />
        {signOutButton}
      </div>
    );
  }

  return (
    <div className="page narrow me">
      <h1>Your profile</h1>
      <p><Link href={`/u/${profile.username}`}>See your profile as others do</Link></p>
      <ProfileEditor profile={profile} />
      <GarageEditor userId={user.id} />
      <GalleryEditor userId={user.id} />
      <PeopleManager userId={user.id} />
      <h2>Account</h2>
      {signOutButton}
    </div>
  );
}

function CreateProfile({ userId }: { userId: string }) {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    if (!USERNAME_PATTERN.test(username)) {
      setMessage("Usernames are 3 to 20 letters, numbers, or underscores.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await sb.from("profiles").insert({ id: userId, username, display_name: name.trim() || username });
    setBusy(false);
    if (error) {
      setMessage(profileSaveError(error.code, error.message));
      return;
    }
    await refreshProfile();
    router.replace(takeReturn() ?? "/me");
  }

  return (
    <form onSubmit={save} className="form">
      <UsernameField value={username} current={null} onChange={setUsername} onAvailability={setAvailability} />
      <label>
        <span>Display name (optional, shown with your ratings)</span>
        <input maxLength={40} placeholder={username || "Your name"} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          I&apos;ll follow traffic laws and posted limits, and I use Sunday Line at my own risk.{" "}
          <Link href="/about#terms">Terms of use</Link>
        </span>
      </label>
      <button type="submit" className="button" disabled={busy || BLOCKING.includes(availability)}>
        {busy ? "Saving..." : "Create profile"}
      </button>
      {message && <p className="hint" role="status">{message}</p>}
      <p className="fine">You can add a picture, your cars and bikes, and photos next.</p>
    </form>
  );
}
