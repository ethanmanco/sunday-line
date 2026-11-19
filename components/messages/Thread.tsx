"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { useAuth } from "@/components/AuthProvider";
import { GALLERY, ImageError, prepareImage } from "@/lib/images";
import {
  getSupabase, PROFILE_COLUMNS, signedChatUrls, timeAgo,
  type ConversationSummary, type Message, type Profile,
} from "@/lib/supabase";

const PAGE = 50;

export default function Thread({ conversationId, embedded = false }: { conversationId: string; embedded?: boolean }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<ConversationSummary | null>(null);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(false);
  const [missing, setMissing] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const peopleRef = useRef(people);
  peopleRef.current = people;

  const addPeople = useCallback(async (ids: string[]) => {
    const sb = getSupabase();
    const need = [...new Set(ids)].filter((id) => !peopleRef.current[id]);
    if (!sb || !need.length) return;
    const { data } = await sb.from("profiles").select(PROFILE_COLUMNS).in("id", need);
    setPeople((p) => ({ ...p, ...Object.fromEntries(((data as Profile[] | null) ?? []).map((x) => [x.id, x])) }));
  }, []);

  const addUrls = useCallback(async (msgs: Message[]) => {
    const paths = msgs.flatMap((m) => (m.media_path ? [m.media_path] : []));
    if (paths.length) {
      const u = await signedChatUrls(paths);
      setUrls((x) => ({ ...x, ...u }));
    }
  }, []);

  const markRead = useCallback(() => {
    getSupabase()?.rpc("mark_read", { p_conversation: conversationId }).then(() => {
      window.dispatchEvent(new Event("sl-unread"));
    });
  }, [conversationId]);

  // First load.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !user) return;
    let gone = false;
    (async () => {
      const [m, convs, b] = await Promise.all([
        sb.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(PAGE),
        sb.rpc("my_conversations"),
        sb.from("blocks").select("blocked_id").eq("blocker_id", user.id),
      ]);
      if (gone) return;
      const row = ((convs.data as ConversationSummary[] | null) ?? []).find((c) => c.id === conversationId) ?? null;
      if (!row) {
        setMissing(true);
        return;
      }
      const msgs = ((m.data as Message[] | null) ?? []).reverse();
      setInfo(row);
      setMore(msgs.length === PAGE);
      setBlocked(new Set(((b.data as { blocked_id: string }[] | null) ?? []).map((x) => x.blocked_id)));
      await Promise.all([addPeople(msgs.map((x) => x.sender_id)), addUrls(msgs)]);
      setMessages(msgs);
      markRead();
    })();
    return () => {
      gone = true;
    };
  }, [conversationId, user, addPeople, addUrls, markRead]);

  // Live: new and edited messages (the database only sends ones you may read).
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !user) return;
    const channel = sb
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          const m = payload.new as Message;
          await Promise.all([addPeople([m.sender_id]), addUrls([m])]);
          setMessages((list) => (list && !list.some((x) => x.id === m.id) ? [...list, m] : list));
          if (m.sender_id !== user.id) markRead();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = payload.new as Message;
          setMessages((list) => list?.map((x) => (x.id === m.id ? m : x)) ?? list);
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [conversationId, user, addPeople, addUrls, markRead]);

  // Stay at the bottom when new messages arrive, unless reading older ones.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    const sb = getSupabase();
    if (!sb || !messages?.length) return;
    const { data } = await sb.from("messages").select("*").eq("conversation_id", conversationId)
      .lt("created_at", messages[0].created_at).order("created_at", { ascending: false }).limit(PAGE);
    const older = ((data as Message[] | null) ?? []).reverse();
    await Promise.all([addPeople(older.map((x) => x.sender_id)), addUrls(older)]);
    stick.current = false;
    setMore(older.length === PAGE);
    setMessages((list) => [...older, ...(list ?? [])]);
  }

  if (missing) {
    return (
      <div className={embedded ? "" : "page narrow"}>
        <p>This conversation isn&apos;t available. <Link href="/messages">Back to messages</Link></p>
      </div>
    );
  }
  if (!messages || !user) return <div className={embedded ? "" : "page narrow"}><p className="fine">Loading...</p></div>;

  return (
    <div className={embedded ? "thread embedded" : "thread page narrow"}>
      {!embedded && info && <ThreadHeader info={info} />}
      <div
        ref={list}
        className="messages"
        role="log"
        aria-live="polite"
        aria-label="Messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {more && <button type="button" className="link older" onClick={loadOlder}>Load earlier messages</button>}
        {messages.length === 0 && <p className="fine empty">No messages yet. Say hi.</p>}
        {messages.map((m, i) => {
          const mine = m.sender_id === user.id;
          const who = people[m.sender_id];
          const showName = info?.kind === "group" && !mine && messages[i - 1]?.sender_id !== m.sender_id;
          if (blocked.has(m.sender_id) && !shown.has(m.id)) {
            return (
              <p key={m.id} className="msg hidden-msg">
                Message from someone you blocked.{" "}
                <button type="button" className="link" onClick={() => setShown(new Set([...shown, m.id]))}>Show</button>
              </p>
            );
          }
          return (
            <Bubble
              key={m.id}
              message={m}
              mine={mine}
              who={who}
              showName={showName}
              url={m.media_path ? urls[m.media_path] : undefined}
              onChanged={(next) => setMessages((list) => (next ? list?.map((x) => (x.id === next.id ? next : x)) : list?.filter((x) => x.id !== m.id)) ?? null)}
            />
          );
        })}
      </div>
      {info?.can_send ? (
        <Composer conversationId={conversationId} userId={user.id} onSent={(m) => {
          stick.current = true;
          addUrls([m]);
          setMessages((list) => (list && !list.some((x) => x.id === m.id) ? [...list, m] : list));
        }} />
      ) : (
        <p className="panel-note">
          {info?.kind === "direct" ? "You can't send messages to this person right now." : "You can't post here right now."}
        </p>
      )}
    </div>
  );
}

function ThreadHeader({ info }: { info: ConversationSummary }) {
  if (info.kind === "group") {
    return (
      <header className="thread-head">
        <Link href="/messages" className="back" aria-label="Back to messages">&larr;</Link>
        <span className="group-mark" aria-hidden="true">{info.group_name?.trim()[0]?.toUpperCase()}</span>
        <Link href={`/g/${info.group_short_id}`}><b>{info.group_name}</b></Link>
      </header>
    );
  }
  return (
    <header className="thread-head">
      <Link href="/messages" className="back" aria-label="Back to messages">&larr;</Link>
      <Avatar person={{ display_name: info.other_display_name ?? "?", avatar_path: info.other_avatar_path, avatar_preset: info.other_avatar_preset }} size={36} />
      <Link href={`/u/${info.other_username}`}>
        <b>{info.other_display_name}</b> <span className="fine">@{info.other_username}</span>
      </Link>
    </header>
  );
}

function Bubble({ message: m, mine, who, showName, url, onChanged }: {
  message: Message;
  mine: boolean;
  who: Profile | undefined;
  showName: boolean;
  url: string | undefined;
  onChanged: (m: Message | null) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body ?? "");

  async function save() {
    const sb = getSupabase();
    if (!sb) return;
    const body = text.trim();
    if (!body && !m.media_path) return;
    const { data } = await sb.from("messages").update({ body: body || null }).eq("id", m.id).select("*").single();
    if (data) onChanged(data as Message);
    setEditing(false);
    setMenu(false);
  }

  async function remove() {
    const sb = getSupabase();
    if (!sb || !window.confirm("Delete this message for everyone?")) return;
    const { error } = await sb.from("messages").delete().eq("id", m.id);
    if (!error) {
      if (m.media_path) await sb.storage.from("message-media").remove([m.media_path]);
      onChanged(null);
    }
  }

  return (
    <div className={`msg${mine ? " mine" : ""}`}>
      {showName && who && (
        <Link href={`/u/${who.username}`} className="msg-name">
          <Avatar person={who} size={20} /> {who.display_name}
        </Link>
      )}
      <div className="bubble">
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={m.media_kind === "gif" ? "GIF" : "Photo"} loading="lazy" />
          </a>
        )}
        {editing ? (
          <div className="edit">
            <textarea value={text} maxLength={2000} rows={2} onChange={(e) => setText(e.target.value)} aria-label="Edit message" />
            <div className="row">
              <button type="button" className="button small" onClick={save}>Save</button>
              <button type="button" className="button ghost small" onClick={() => { setEditing(false); setText(m.body ?? ""); }}>Cancel</button>
            </div>
          </div>
        ) : (
          m.body && <p>{m.body}</p>
        )}
      </div>
      <span className="msg-meta">
        <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString()}>{timeAgo(m.created_at)}</time>
        {m.edited_at && " · edited"}
        {mine && !editing && (
          <>
            {" · "}
            <button type="button" className="link" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              {menu ? "Close" : "More"}
            </button>
            {menu && (
              <>
                {" "}
                <button type="button" className="link" onClick={() => setEditing(true)}>Edit</button>{" "}
                <button type="button" className="link danger" onClick={remove}>Delete</button>
              </>
            )}
          </>
        )}
      </span>
    </div>
  );
}

function Composer({ conversationId, userId, onSent }: { conversationId: string; userId: string; onSent: (m: Message) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  async function send(media?: { path: string; kind: "image" | "gif" }) {
    const sb = getSupabase();
    const body = text.trim();
    if (!sb || (!body && !media)) return;
    setBusy(media ? "Sending photo..." : "Sending...");
    setError(null);
    const { data, error } = await sb
      .from("messages")
      .insert({ conversation_id: conversationId, body: body || null, media_path: media?.path ?? null, media_kind: media?.kind ?? null })
      .select("*")
      .single();
    setBusy(null);
    if (error || !data) {
      if (media) await sb.storage.from("message-media").remove([media.path]);
      setError("Couldn't send. They may not be taking messages right now.");
      return;
    }
    setText("");
    onSent(data as Message);
    box.current?.focus();
  }

  async function attach(file: File | undefined) {
    const sb = getSupabase();
    if (!sb || !file) return;
    setBusy("Preparing photo...");
    setError(null);
    try {
      const img = await prepareImage(file, GALLERY);
      const path = `${conversationId}/${userId}-${crypto.randomUUID()}.${img.ext}`;
      const up = await sb.storage.from("message-media").upload(path, img.blob, { contentType: img.contentType });
      if (up.error) throw new ImageError("Couldn't upload the photo.");
      await send({ path, kind: img.kind });
    } catch (e) {
      setBusy(null);
      setError(e instanceof ImageError ? e.message : "Couldn't send the photo.");
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <button type="button" className="attach" aria-label="Add a photo or GIF" disabled={!!busy} onClick={() => input.current?.click()}>+</button>
      <textarea
        ref={box}
        rows={1}
        maxLength={2000}
        value={text}
        placeholder="Message"
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends on a keyboard; Shift+Enter adds a line.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button type="submit" className="button small" disabled={!!busy || !text.trim()}>{busy ?? "Send"}</button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <p className="hint warn" role="alert">{error}</p>}
    </form>
  );
}
