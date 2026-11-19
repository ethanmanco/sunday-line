"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase, takeReturn } from "@/lib/supabase";

export default function Me() {
  const router = useRouter();
  const { ready, user, profile, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.display_name);
      setVehicle(profile.vehicle_note ?? "");
    }
  }, [profile]);

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
    setBusy(true);
    setMessage(null);
    const row = { display_name: name.trim(), vehicle_note: vehicle.trim() || null };
    const { error } = creating
      ? await sb.from("profiles").insert({ id: user.id, ...row })
      : await sb.from("profiles").update(row).eq("id", user.id);
    setBusy(false);
    if (error) {
      setMessage(error.code === "23514" ? "Display names are 2 to 40 characters." : "Couldn't save. Try again.");
      return;
    }
    await refreshProfile();
    if (creating) router.replace(takeReturn() ?? "/");
    else setMessage("Saved.");
  }

  return (
    <div className="page narrow">
      <h1>{creating ? "Set up your profile" : "Your profile"}</h1>
      <form onSubmit={save} className="form">
        <label>
          <span>Display name (shown with your ratings)</span>
          <input required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
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
        <button type="submit" className="button" disabled={busy}>{busy ? "Saving..." : creating ? "Create profile" : "Save"}</button>
        {message && <p className="hint" role="status">{message}</p>}
      </form>
      <p className="fine">Signed in as {user.email}. Your email is never shown to other people.</p>
      <button type="button" className="button ghost" onClick={async () => { await signOut(); router.replace("/"); }}>
        Sign out
      </button>
    </div>
  );
}
