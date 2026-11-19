import type { Metadata } from "next";
import ProfileView from "@/components/profile/ProfileView";
import { supabaseRest, USERNAME_PATTERN } from "@/lib/supabase";

type Params = { params: Promise<{ username: string }> };

interface PublicProfile {
  username: string;
  display_name: string;
  bio: string | null;
  is_private: boolean;
}

// Reads with the public key only, so it can never see more than a signed-out visitor.
async function findProfile(username: string): Promise<PublicProfile | null> {
  if (!supabaseRest || !USERNAME_PATTERN.test(username)) return null;
  try {
    const res = await fetch(
      `${supabaseRest.url}/rest/v1/profiles?select=username,display_name,bio,is_private&username=eq.${username}`,
      { headers: { apikey: supabaseRest.key }, next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as PublicProfile[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  const p = await findProfile(username.toLowerCase());
  if (!p) return { title: "Profile" };
  const title = `${p.display_name} (@${p.username})`;
  const description = p.is_private ? "A private Sunday Line profile." : p.bio || `${p.display_name} on Sunday Line.`;
  return {
    title,
    description,
    alternates: { canonical: `/u/${p.username}` },
    openGraph: { title, description, url: `/u/${p.username}`, type: "profile" },
    twitter: { card: "summary", title, description },
  };
}

export default async function ProfilePage({ params }: Params) {
  const { username } = await params;
  return <ProfileView username={username.toLowerCase()} />;
}
