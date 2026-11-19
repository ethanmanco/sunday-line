"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase, rememberReturn, type GroupVisibility } from "@/lib/supabase";

interface Preview {
  group_name: string;
  short_id: string;
  visibility: GroupVisibility;
  member_count: number;
  usable: boolean;
}

export default function InviteView({ token }: { token: string }) {
  const router = useRouter();
  const { ready, user, profile } = useAuth();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.rpc("invite_preview", { p_token: token }).then(({ data }) => {
      setPreview(((data as Preview[] | null) ?? [])[0] ?? null);
    });
  }, [token]);

  async function join() {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const { data, error } = await sb.rpc("redeem_invite", { p_token: token });
    setBusy(false);
    if (error || !data) setError("This invite link has expired or was turned off. Ask for a new one.");
    else router.replace(`/g/${data as string}`);
  }

  if (preview === undefined) return <div className="page narrow"><p>Loading...</p></div>;
  if (!preview) {
    return (
      <div className="page narrow">
        <h1>Invite not found</h1>
        <p>Check that the whole link was copied, or ask for a new one. <Link href="/groups">Find a group</Link></p>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <p className="fine">You&apos;re invited to</p>
      <h1>{preview.group_name}</h1>
      <p className="handle">
        {preview.visibility === "private" ? "Private group" : "Public group"} · {preview.member_count}{" "}
        {preview.member_count === 1 ? "member" : "members"}
      </p>
      {!preview.usable ? (
        <p className="hint warn">This link has expired or was turned off. Ask for a new one.</p>
      ) : !ready ? null : !user ? (
        <p>
          <Link href="/signin" className="button" onClick={() => rememberReturn(`/j/${token}`)}>Sign in to join</Link>
        </p>
      ) : !profile ? (
        <p><Link href="/me" className="button" onClick={() => rememberReturn(`/j/${token}`)}>Set up your profile to join</Link></p>
      ) : (
        <p><button type="button" className="button" disabled={busy} onClick={join}>{busy ? "Joining..." : "Join the group"}</button></p>
      )}
      {error && <p className="hint warn" role="alert">{error}</p>}
    </div>
  );
}
