"use client";

import { useEffect, useState } from "react";
import { getSupabase, signedGroupUrls } from "@/lib/supabase";

const cache = new Map<string, string | null>();

/** A group's picture by its short ID, or its first letter while loading or if it has none. */
export default function GroupAvatar({ shortId, name, size = 44 }: { shortId: string | null; name: string | null; size?: number }) {
  const [url, setUrl] = useState<string | null>(shortId ? cache.get(shortId) ?? null : null);
  useEffect(() => {
    if (!shortId || cache.has(shortId)) return;
    const sb = getSupabase();
    if (!sb) return;
    let gone = false;
    sb.from("groups").select("avatar_path").eq("short_id", shortId).maybeSingle().then(async ({ data }) => {
      const path = (data as { avatar_path: string | null } | null)?.avatar_path ?? null;
      const u = path ? (await signedGroupUrls([path]))[path] ?? null : null;
      cache.set(shortId, u);
      if (!gone) setUrl(u);
    });
    return () => {
      gone = true;
    };
  }, [shortId]);
  const style = { width: size, height: size, fontSize: size * 0.45 };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="group-avatar" style={style} width={size} height={size} />;
  }
  return <span className="group-mark" style={style} aria-hidden="true">{name?.trim()[0]?.toUpperCase()}</span>;
}
