"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { cleanUsername, getSupabase, RESERVED_USERNAMES, takeReturn, USERNAME_PATTERN } from "@/lib/supabase";

type Availability = "idle" | "checking" | "available" | "taken" | "reserved" | "invalid";

export default function Me() {
  const router = useRouter();
  const { ready, user, profile, refreshProfile, signOut } = useAuth();
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>("idle");

  useEffect(() => {
    if (profile) {
      setUsername(profile.username);
      setName(profile.display_name);
      setVehicle(profile.vehicle_note ?? "");
    }
  }, [profile]);

  // Check the username as it's typed (after a short pause).
  useEffect(() => {
    if (!username || username === profile?.username) {
      setAvailability("idle");
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      setAvailability("invalid");
      return;
    }
    if (RESERVED_USERNAMES.has(username)) {
      setAvailability("reserved");
      return;
    }
    setAvailability("checking");
    const sb = getSupabase();
    if (!sb) return;
    let stale = false;
    const t = setTimeout(async () => {
      const { data, error } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
      if (stale) return;
      setAvailability(error ? "idle" : data ? "taken" : "available");
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [username, profile?.username]);

  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user) {
    return (
      <div className="page narrow">
        <h1>Your profile</h1>
        <p><Link href="/signin">Sign in</Link> to rate roads and keep a profile.</p>
      </div>
    );
  }

  const creating = !profile;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb || !user) return;
    if (!USERNAME_PATTERN.test(username)) {
      setMessage("Usernames are 3 to 20 letters, numbers, or underscores.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const row = { username, display_name: name.trim() || username, vehicle_note: vehicle.trim() || null };
    const { error } = creating
      ? await sb.from("profiles").insert({ id: user.id, ...row })
      : await sb.from("profiles").update(row).eq("id", user.id);
    setBusy(false);
    if (error) {
      if (error.code === "23505") {
        setAvailability("taken");
        setMessage("That username is taken. Try another.");
      } else if (error.code === "23514") {
        setMessage(
          error.message.includes("reserved")
            ? "That username is reserved. Try another."
            : "Usernames are 3 to 20 letters, numbers, or underscores. Display names are 2 to 40 characters.",
        );
      } else setMessage("Couldn't save. Try again.");
      return;
    }
    await refreshProfile();
    if (creating) router.replace(takeReturn() ?? "/");
    else setMessage("Saved.");
  }

  const hint: Record<Availability, string> = {
    idle: "Letters, numbers, and underscores. Your profile link will use it.",
    checking: "Checking...",
    available: `@${username} is available.`,
    taken: `@${username} is taken.`,
    reserved: `@${username} is reserved.`,
    invalid: "3 to 20 letters, numbers, or underscores.",
  };

  return (
    <div className="page narrow">
      <h1>{creating ? "Set up your profile" : "Your profile"}</h1>
      <form onSubmit={save} className="form">
        <label>
          <span>Username</span>
          <input
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            minLength={3}
            maxLength={20}
            value={username}
            onChange={(e) => setUsername(cleanUsername(e.target.value))}
            aria-describedby="username-hint"
            aria-invalid={["taken", "reserved", "invalid"].includes(availability)}
          />
          <span
            id="username-hint"
            className={`fine${["taken", "reserved", "invalid"].includes(availability) ? " warn" : ""}`}
            aria-live="polite"
          >
            {hint[availability]}
          </span>
        </label>
        <label>
          <span>Display name (optional, shown with your ratings)</span>
          <input maxLength={40} placeholder={username || "Your name"} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>What you drive (optional)</span>
          <input maxLength={80} placeholder="2019 Miata, 2021 MT-09..." value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
        </label>
        {creating && (
          <label className="check">
            <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              I&apos;ll follow traffic laws and posted limits, and I use Sunday Line at my own risk.{" "}
              <Link href="/about#terms">Terms of use</Link>
            </span>
          </label>
        )}
        <button type="submit" className="button" disabled={busy || ["taken", "reserved", "invalid", "checking"].includes(availability)}>
          {busy ? "Saving..." : creating ? "Create profile" : "Save"}
        </button>
        {message && <p className="hint" role="status">{message}</p>}
      </form>
      <p className="fine">Signed in as {user.email}. Your email is never shown to other people.</p>
      <button type="button" className="button ghost" onClick={async () => { await signOut(); router.replace("/"); }}>
        Sign out
      </button>
    </div>
  );
}
