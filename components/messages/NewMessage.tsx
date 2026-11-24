"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { getSupabase } from "@/lib/supabase";

interface Candidate {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  avatar_preset: string | null;
  /** direct: lands in their inbox; request: waits for them to accept your follow request; closed: not taking messages from you. */
  reach: "direct" | "request" | "closed";
  has_chat: boolean;
}

const NOTE: Record<Candidate["reach"], string | null> = {
  direct: null,
  request: "Private. They'll see your messages when they accept your follow request.",
  closed: "Isn't taking messages from you.",
};

/** The + in Messages (11.75): find anyone and start a chat. Private profiles
 *  you don't follow get your messages once they accept your follow request. */
export default function NewMessage({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const term = q.trim().replace(/^@/, "");
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    const t = setTimeout(async () => {
      const { data } = await sb.rpc("message_candidates", { q: term.length >= 2 ? term : null });
      if (live) setRows((data as Candidate[] | null) ?? []);
    }, term.length >= 2 ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term]);

  async function open(p: Candidate) {
    const sb = getSupabase();
    if (!sb || p.reach === "closed") return;
    setBusy(p.id);
    setError(null);
    const { data, error: e } = await sb.rpc("start_direct", { p_user: p.id });
    setBusy(null);
    if (e || !data) {
      setError(`@${p.username} isn't taking messages from you right now.`);
      return;
    }
    router.push(`/messages/${data as string}`);
  }

  return (
    <section className="new-message" aria-labelledby="new-message-title">
      <div className="new-message-head">
        <h2 id="new-message-title">New message</h2>
        <button type="button" className="link" onClick={onClose}>Cancel</button>
      </div>
      <label>
        <span className="visually-hidden">To</span>
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          placeholder="To: name or @username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      {error && <p className="hint warn" role="alert">{error}</p>}
      {rows === null ? (
        <p className="fine">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="fine">
          {term.length >= 2 ? "Nobody by that name." : "Search for anyone by name or @username."}
        </p>
      ) : (
        <>
          {term.length < 2 && <p className="fine new-message-hint">People you follow and who follow you. Search to find anyone.</p>}
          <ul className="new-message-list">
            {rows.map((p) => (
              <li key={p.id}>
                <button type="button" className="new-message-row" disabled={p.reach === "closed" || busy !== null} onClick={() => open(p)}>
                  <Avatar person={p} size={40} />
                  <span className="new-message-text">
                    <span><b>{p.display_name}</b> <span className="fine">@{p.username}</span></span>
                    {NOTE[p.reach] && <span className="fine">{NOTE[p.reach]}</span>}
                  </span>
                  {busy === p.id && <span className="fine">Opening...</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
