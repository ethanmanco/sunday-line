"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { accountsEnabled, emailHasCode, getSupabase, takeReturn } from "@/lib/supabase";

export default function SignIn() {
  const router = useRouter();
  const { ready, user, profile } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && user) router.replace(profile ? takeReturn() ?? "/" : "/me");
  }, [ready, user, profile, router]);

  if (!accountsEnabled) {
    return (
      <div className="page narrow">
        <h1>Sign in</h1>
        <p>Accounts aren&apos;t switched on for this copy of the site yet.</p>
      </div>
    );
  }

  // The installed (Home Screen) app keeps its own sign-in, separate from the browser.
  const installed = typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    setBusy(false);
    if (error) setError(error.status === 429 ? "Too many emails for now. Wait a minute and try again." : error.message);
    else setStep("code");
  }

  async function checkCode(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setError("That code didn't work. Check the newest email, or send a new code.");
  }

  return (
    <div className="page narrow">
      <h1>Sign in</h1>
      {step === "email" ? (
        <form onSubmit={sendCode} className="form">
          <p>
            {emailHasCode ? "We'll email you a 6-digit code." : "We'll email you a sign-in link."} No password needed. New
            here? This creates your account.
          </p>
          <label>
            <span>Email</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" className="button" disabled={busy}>{busy ? "Sending..." : emailHasCode ? "Email me a code" : "Email me a link"}</button>
          <p className="fine">
            By signing in you agree to the <Link href="/about#terms">terms of use</Link>.
          </p>
        </form>
      ) : !emailHasCode ? (
        <div className="form">
          <p>
            We sent a sign-in link to <b>{email}</b>. Tap it to sign in. It works on any device, so you can open the
            email on your phone or computer.
          </p>
          <p className="fine">Not there? Check spam, or wait a minute. The link works once and expires after an hour.</p>
          <button type="button" className="link" onClick={() => setStep("email")}>
            Use a different email or send a new link
          </button>
        </div>
      ) : (
        <form onSubmit={checkCode} className="form">
          <p>We sent a code to <b>{email}</b>. Type it here, or tap the link in the email.</p>
          {installed && (
            <p className="fine">You&apos;re in the installed app: type the code here. Tapping the link signs you in to your browser instead.</p>
          )}
          <label>
            <span>Code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,8}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button type="submit" className="button" disabled={busy}>{busy ? "Checking..." : "Sign in"}</button>
          <button type="button" className="link" onClick={() => { setStep("email"); setCode(""); }}>
            Use a different email or send a new code
          </button>
        </form>
      )}
      {error && <p className="hint warn" role="alert">{error}</p>}
    </div>
  );
}
