"use client";

import Link from "next/link";
import { accountsEnabled } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

export default function AccountLink() {
  const { ready, user, profile } = useAuth();
  if (!accountsEnabled || !ready) return null;
  if (!user) return <Link href="/signin">Sign in</Link>;
  return <Link href="/me">{profile?.display_name ?? "Me"}</Link>;
}
