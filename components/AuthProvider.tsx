"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase, OWN_PROFILE_COLUMNS, type OwnProfile } from "@/lib/supabase";

interface AuthState {
  ready: boolean;
  user: User | null;
  profile: OwnProfile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  ready: true,
  user: null,
  profile: null,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<OwnProfile | null>(null);

  const loadProfile = useCallback(async (u: User | null) => {
    const sb = getSupabase();
    if (!sb || !u) {
      setProfile(null);
      return;
    }
    const { data } = await sb.from("profiles").select(OWN_PROFILE_COLUMNS).eq("id", u.id).maybeSingle();
    setProfile((data as OwnProfile | null) ?? null);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setReady(true);
      return;
    }
    sb.auth.getUser().then(async ({ data }) => {
      setUser(data.user);
      await loadProfile(data.user);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      // Run outside the auth callback, as Supabase recommends.
      setTimeout(() => loadProfile(u), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const value: AuthState = {
    ready,
    user,
    profile,
    refreshProfile: () => loadProfile(user),
    signOut: async () => {
      // This device stops getting their notifications (11.43).
      await import("@/lib/push").then((m) => m.turnPushOff()).catch(() => {});
      await getSupabase()?.auth.signOut();
      setUser(null);
      setProfile(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
