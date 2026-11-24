"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";

// @mentions in chats (11.62). The database finds mentions in a message and
// tells the people mentioned (supabase/migrations/20261205000000_mentions.sql);
// this file is the typing help and the links.

export interface ChatPerson {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  avatar_preset: string | null;
}

// Same rule as the database: @name, not inside a word or an email address.
const MENTION = /(^|[^A-Za-z0-9_@.])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g;

/** Message text with mentions of people in the chat as links to their profiles. */
export function MentionText({ text, known, me }: { text: string; known: Set<string>; me: string | null }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const name = m[2].toLowerCase();
    if (!known.has(name)) continue;
    const at = (m.index ?? 0) + m[1].length;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link key={at} href={`/u/${name}`} className={`mention${name === me ? " me" : ""}`}>@{m[2]}</Link>,
    );
    last = at + 1 + m[2].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** The @word being typed at the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|[^A-Za-z0-9_@.])@([A-Za-z0-9_]{0,20})$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

/** Up to six people matching what's typed after the @. */
export function matchPeople(people: ChatPerson[], query: string): ChatPerson[] {
  if (!query) return people.slice(0, 6);
  const starts = (p: ChatPerson) =>
    p.username.startsWith(query) || p.display_name.toLowerCase().split(/\s+/).some((w) => w.startsWith(query));
  const first = people.filter(starts);
  const rest = people.filter((p) => !starts(p) && (p.username.includes(query) || p.display_name.toLowerCase().includes(query)));
  return [...first, ...rest].slice(0, 6);
}

export function MentionList({ id, people, active, onPick }: {
  id: string;
  people: ChatPerson[];
  active: number;
  onPick: (p: ChatPerson) => void;
}) {
  return (
    <ul className="mention-list" id={id} role="listbox" aria-label="People in this chat">
      {people.map((p, i) => (
        <li
          key={p.id}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          className={i === active ? "active" : undefined}
          // Keep the focus in the message box.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(p)}
        >
          <Avatar person={p} size={28} />
          <span><b>{p.display_name}</b> <span className="fine">@{p.username}</span></span>
        </li>
      ))}
    </ul>
  );
}
