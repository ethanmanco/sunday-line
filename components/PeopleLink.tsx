"use client";

import Link from "next/link";
import { accountsEnabled } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

/** "People" in the top bar: find and follow friends. An icon on phones. */
export default function PeopleLink() {
  const { ready, user, profile } = useAuth();
  if (!accountsEnabled || !ready || !user || !profile) return null;
  return (
    <Link href="/people" className="people-link" aria-label="Find people">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M2.5 19c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M17 8v6M14 11h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="nav-label">People</span>
    </Link>
  );
}
