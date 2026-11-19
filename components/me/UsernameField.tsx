"use client";

import { useEffect, useState } from "react";
import { cleanUsername, getSupabase, RESERVED_USERNAMES, USERNAME_PATTERN } from "@/lib/supabase";

export type Availability = "idle" | "checking" | "available" | "taken" | "reserved" | "invalid";

export const BLOCKING: Availability[] = ["taken", "reserved", "invalid", "checking"];

/** Username input that checks availability as it's typed. */
export default function UsernameField({ value, current, onChange, onAvailability }: {
  value: string;
  current: string | null;
  onChange: (v: string) => void;
  onAvailability: (a: Availability) => void;
}) {
  const [availability, setAvailability] = useState<Availability>("idle");

  useEffect(() => {
    let next: Availability | null = null;
    if (!value || value === current) next = "idle";
    else if (!USERNAME_PATTERN.test(value)) next = "invalid";
    else if (RESERVED_USERNAMES.has(value)) next = "reserved";
    if (next) {
      setAvailability(next);
      onAvailability(next);
      return;
    }
    setAvailability("checking");
    onAvailability("checking");
    const sb = getSupabase();
    if (!sb) return;
    let stale = false;
    const t = setTimeout(async () => {
      const { data, error } = await sb.from("profiles").select("id").eq("username", value).maybeSingle();
      if (stale) return;
      const a: Availability = error ? "idle" : data ? "taken" : "available";
      setAvailability(a);
      onAvailability(a);
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // onAvailability is a state setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, current]);

  const hint: Record<Availability, string> = {
    idle: "Letters, numbers, and underscores. Your profile link uses it.",
    checking: "Checking...",
    available: `@${value} is available.`,
    taken: `@${value} is taken.`,
    reserved: `@${value} is reserved.`,
    invalid: "3 to 20 letters, numbers, or underscores.",
  };
  const bad = ["taken", "reserved", "invalid"].includes(availability);

  return (
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
        value={value}
        onChange={(e) => onChange(cleanUsername(e.target.value))}
        aria-describedby="username-hint"
        aria-invalid={bad}
      />
      <span id="username-hint" className={`fine${bad ? " warn" : ""}`} aria-live="polite">{hint[availability]}</span>
    </label>
  );
}

/** Turns a database error from saving a profile into plain words. */
export function profileSaveError(code: string | undefined, message: string): string {
  if (code === "23505") return "That username is taken. Try another.";
  if (code === "23514") {
    if (message.includes("reserved")) return "That username is reserved. Try another.";
    if (message.includes("bio")) return "Keep the bio to 300 characters.";
    return "Usernames are 3 to 20 letters, numbers, or underscores. Display names are 2 to 40 characters.";
  }
  return "Couldn't save. Try again.";
}
