"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabase, takeReturn } from "@/lib/supabase";

function Confirm() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenHash = params.get("token_hash");
    const type = (params.get("type") ?? "email") as EmailOtpType;
    const sb = getSupabase();
    if (!sb) {
      setError("Accounts aren't switched on for this copy of the site yet.");
      return;
    }
    const go = async (userId: string) => {
      const { data: profile } = await sb.from("profiles").select("id").eq("id", userId).maybeSingle();
      router.replace(profile ? takeReturn() ?? "/" : "/me");
    };
    if (!tokenHash) {
      // Supabase's default email links sign in through the address bar instead.
      // Give the client a moment to read it.
      setTimeout(async () => {
        const { data } = await sb.auth.getSession();
        if (data.session) go(data.session.user.id);
        else setError("This sign-in link has expired or was already used. Ask for a new code.");
      }, 600);
      return;
    }
    sb.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ data, error }) => {
      if (error || !data.user) {
        setError("This sign-in link has expired or was already used. Ask for a new code.");
        return;
      }
      go(data.user.id);
    });
  }, [params, router]);

  return (
    <div className="page narrow">
      <h1>Signing you in</h1>
      {error ? (
        <p className="hint warn" role="alert">
          {error} <Link href="/signin">Back to sign in</Link>
        </p>
      ) : (
        <p>One moment...</p>
      )}
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div className="page narrow"><p>One moment...</p></div>}>
      <Confirm />
    </Suspense>
  );
}
