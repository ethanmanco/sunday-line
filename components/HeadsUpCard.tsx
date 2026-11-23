"use client";

import { useState } from "react";
import Link from "next/link";
import {
  addHeadsUp, ago, HEADS_UP_KINDS, HEADS_UP_LABEL, HEADS_UP_LIFE, voteHeadsUp,
  type HeadsUp, type HeadsUpKind,
} from "@/lib/headsUps";
import { rememberReturn } from "@/lib/supabase";

/** A heads-up someone tapped on the map (11.39). */
export default function HeadsUpCard({ headsUp: h, signedIn, onClose, onChanged }: {
  headsUp: HeadsUp;
  signedIn: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function vote(still: boolean) {
    setBusy(true);
    const ok = await voteHeadsUp(h.id, still);
    setBusy(false);
    if (!ok) return setDone("Couldn't save. Check your connection.");
    if (h.mine && !still) return onChanged();
    setDone(still ? "Thanks. It stays up longer." : "Thanks. Two people saying it's gone takes it down.");
  }

  return (
    <section className="hu-card" aria-label={`Heads-up: ${HEADS_UP_LABEL[h.kind]}`}>
      <button type="button" className="hu-close" aria-label="Close" onClick={onClose}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      <p className="hu-title"><b>{HEADS_UP_LABEL[h.kind]}</b> <span className="fine">· {ago(h.created_at)}</span></p>
      {h.note && <p>{h.note}</p>}
      <p className="fine">
        {h.still_count > 0 ? `${h.still_count} ${h.still_count === 1 ? "person says" : "people say"} it's still there. ` : ""}
        Ends by itself {new Date(h.expires_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
      </p>
      {done ? (
        <p className="fine" role="status">{done}</p>
      ) : !signedIn ? (
        <p className="fine"><Link href="/signin" onClick={() => rememberReturn("/")}>Sign in</Link> to say if it&apos;s still there.</p>
      ) : h.mine ? (
        <div className="row">
          <button type="button" className="button ghost small" disabled={busy} onClick={() => vote(false)}>It&apos;s gone, take it down</button>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="button small" disabled={busy} onClick={() => vote(true)}>Still there</button>
          <button type="button" className="button ghost small" disabled={busy} onClick={() => vote(false)}>Gone</button>
        </div>
      )}
    </section>
  );
}

/** Posting a heads-up at a spot picked on the map. */
export function HeadsUpForm({ at, onDone }: { at: [number, number]; onDone: (posted: boolean) => void }) {
  const [kind, setKind] = useState<HeadsUpKind | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return setError("Pick what it is.");
    setBusy(true);
    const err = await addHeadsUp(kind, at, note);
    setBusy(false);
    if (err) setError(err);
    else onDone(true);
  }

  return (
    <form className="hu-card hu-form" onSubmit={post} aria-label="Post a heads-up">
      <p className="hu-title"><b>Heads-up</b> <span className="fine">· shown without your name</span></p>
      <div className="seg">
        {HEADS_UP_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{HEADS_UP_LABEL[k]}</button>
        ))}
      </div>
      {kind && <p className="fine">Ends by itself after {HEADS_UP_LIFE[kind]} unless someone says it&apos;s still there.</p>}
      <label>
        <span className="visually-hidden">Note (optional)</span>
        <input maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): which lane, which side" />
      </label>
      <div className="row">
        <button type="submit" className="button small" disabled={busy}>{busy ? "Posting..." : "Post"}</button>
        <button type="button" className="button ghost small" onClick={() => onDone(false)}>Cancel</button>
      </div>
      {error && <p className="hint warn" role="alert">{error}</p>}
    </form>
  );
}
