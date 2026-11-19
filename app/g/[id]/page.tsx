import type { Metadata } from "next";
import GroupView from "@/components/groups/GroupView";
import { supabaseRest } from "@/lib/supabase";

type Params = { params: Promise<{ id: string }> };

// Public key only: private groups are invisible here, so their names never
// reach a share preview.
async function findPublicGroup(id: string): Promise<{ name: string; description: string | null; home_area: string | null } | null> {
  if (!supabaseRest || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
  try {
    const res = await fetch(
      `${supabaseRest.url}/rest/v1/groups?select=name,description,home_area&short_id=eq.${id}`,
      { headers: { apikey: supabaseRest.key }, next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { name: string; description: string | null; home_area: string | null }[])[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const g = await findPublicGroup(id);
  if (!g) return { title: "Group", robots: { index: false } };
  const description = g.description?.slice(0, 200) || `A car and bike group${g.home_area ? ` in ${g.home_area}` : ""} on Sunday Line.`;
  return {
    title: g.name,
    description,
    alternates: { canonical: `/g/${id}` },
    openGraph: { title: g.name, description, url: `/g/${id}` },
    twitter: { card: "summary", title: g.name, description },
  };
}

export default async function GroupPage({ params }: Params) {
  const { id } = await params;
  return <GroupView shortId={id} />;
}
