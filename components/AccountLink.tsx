"use client";

import Link from "next/link";
import { accountsEnabled } from "@/lib/supabase";
import Avatar from "./Avatar";
import { useAuth } from "./AuthProvider";

export default function AccountLink() {
  const { ready, user, profile } = useAuth();
  if (!accountsEnabled || !ready) return null;
  if (!user) return <Link href="/signin">Sign in</Link>;
  if (!profile) return <Link href="/me">Me</Link>;
  return (
    <Link href="/me" className="account-link" aria-label={`Your profile, ${profile.display_name}`}>
      <Avatar person={profile} size={28} />
      <span className="account-name">{profile.display_name}</span>
    </Link>
  );
}
