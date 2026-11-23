"use client";

import { useCallback, useEffect, useState } from "react";
import PersonRow from "@/components/profile/PersonRow";
import GroupPictures from "./GroupPictures";
import { can, type Membership } from "./GroupView";
import {
  getSupabase, PROFILE_COLUMNS, type Group, type GroupVisibility, type JoinPolicy, type Profile,
} from "@/lib/supabase";

interface Request {
  user_id: string;
  message: string | null;
  created_at: string;
  person: Profile | null;
}

interface Invite {
  id: string;
  label: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
}

export default function GroupManage({ group, me, urls, onChanged, onDeleted }: {
  group: Group;
  me: Membership;
  urls: Record<string, string>;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  return (
    <div className="manage">
      {me.role === "organizer" && (
        <section aria-labelledby="pictures">
          <h2 id="pictures">Group picture and banner</h2>
          <GroupPictures group={group} urls={urls} onChanged={onChanged} />
        </section>
      )}
      {can(me, "approve") && <Requests group={group} onChanged={onChanged} />}
      {can(me, "invites") && <InviteMember group={group} />}
      {can(me, "invites") && <Invites group={group} />}
      {me.role === "organizer" && <Settings group={group} onChanged={onChanged} onDeleted={onDeleted} />}
    </div>
  );
}

function Requests({ group, onChanged }: { group: Group; onChanged: () => void }) {
  const [rows, setRows] = useState<Request[] | null>(null);
  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb
      .from("join_requests")
      .select(`user_id, message, created_at, person:profiles!join_requests_user_id_fkey(${PROFILE_COLUMNS})`)
      .eq("group_id", group.id)
      .order("created_at");
    setRows((data as unknown as Request[]) ?? []);
  }, [group.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function decide(r: Request, approve: boolean) {
    await getSupabase()?.rpc("decide_join_request", { p_group: group.id, p_user: r.user_id, p_approve: approve });
    await load();
    onChanged();
  }

  return (
    <section aria-labelledby="requests">
      <h2 id="requests">Requests to join</h2>
      {group.visibility === "private" || group.join_policy === "open" ? (
        <p className="fine">{group.visibility === "private" ? "Private groups grow by invite link." : "Anyone can join right now, so there are no requests."}</p>
      ) : !rows ? <p className="fine">Loading...</p> : rows.length === 0 ? (
        <p className="fine">No one is waiting.</p>
      ) : (
        <ul className="people">
          {rows.map((r) => r.person && (
            <li key={r.user_id} className="member">
              <PersonRow person={r.person}>
                <button type="button" className="button small" onClick={() => decide(r, true)}>Approve</button>
                <button type="button" className="button ghost small" onClick={() => decide(r, false)}>Decline</button>
              </PersonRow>
              {r.message && <p className="request-note">&ldquo;{r.message}&rdquo;</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const EXPIRY: [string, number | null][] = [["Never", null], ["1 day", 1], ["7 days", 7], ["30 days", 30]];
const USES: [string, number | null][] = [["No limit", null], ["1 person", 1], ["10 people", 10], ["50 people", 50]];

/** Invite a member by username (11.40); they get a notification to join or decline. */
function InviteMember({ group }: { group: Group }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const name = username.trim().replace(/^@/, "");
    if (!name) return;
    setBusy(true);
    setMsg(null);
    const { error } = (await getSupabase()?.rpc("invite_to_group", { p_group: group.id, p_username: name })) ?? {};
    setBusy(false);
    if (!error) {
      setMsg({ ok: true, text: `Invited @${name}. They'll see it in their notifications.` });
      setUsername("");
    } else {
      setMsg({ ok: false, text: error.message || "Couldn't send the invite." });
    }
  }

  return (
    <section aria-labelledby="invite-member">
      <h2 id="invite-member">Invite a member</h2>
      <form className="row" onSubmit={send}>
        <label className="grow">
          <span className="visually-hidden">Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@username" autoComplete="off" maxLength={21} />
        </label>
        <button type="submit" className="button" disabled={busy || !username.trim()}>{busy ? "Inviting..." : "Invite"}</button>
      </form>
      {msg && <p className={msg.ok ? "fine" : "hint warn"} role="status">{msg.text}</p>}
    </section>
  );
}

function Invites({ group }: { group: Group }) {
  const [rows, setRows] = useState<Invite[] | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number | null>(7);
  const [uses, setUses] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("group_invites").select("*").eq("group_id", group.id).order("created_at", { ascending: false });
    setRows((data as Invite[] | null) ?? []);
  }, [group.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setError(null);
    const { data, error } = await sb.rpc("create_invite", {
      p_group: group.id,
      p_label: label,
      p_expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
      p_max_uses: uses,
    });
    if (error || !data) {
      setError(error?.message.includes("Too many") ? "Too many open links. Revoke some first." : "Couldn't make a link.");
      return;
    }
    setFresh(`${window.location.origin}/j/${data as string}`);
    setCopied(false);
    setLabel("");
    load();
  }

  async function revoke(i: Invite) {
    await getSupabase()?.rpc("revoke_invite", { p_invite: i.id });
    load();
  }

  const status = (i: Invite) =>
    i.revoked_at ? "Revoked"
      : i.expires_at && new Date(i.expires_at) < new Date() ? "Expired"
        : i.max_uses !== null && i.use_count >= i.max_uses ? "Used up"
          : null;

  return (
    <section aria-labelledby="invites">
      <h2 id="invites">Invite links</h2>
      <p className="fine">Anyone with a link can join, even a private group. Each link is shown once, so copy it when you make it.</p>
      <form onSubmit={create} className="form rate">
        <label>
          <span>Label (optional, only you see it)</span>
          <input maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Cars and coffee flyer" />
        </label>
        <fieldset>
          <legend>Stops working after</legend>
          <div className="seg">
            {EXPIRY.map(([t, v]) => <button key={t} type="button" aria-pressed={days === v} onClick={() => setDays(v)}>{t}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>How many people can use it</legend>
          <div className="seg">
            {USES.map(([t, v]) => <button key={t} type="button" aria-pressed={uses === v} onClick={() => setUses(v)}>{t}</button>)}
          </div>
        </fieldset>
        <button type="submit" className="button">Make a link</button>
        {error && <p className="hint warn" role="alert">{error}</p>}
      </form>
      {fresh && (
        <div className="fresh-link" role="status">
          <p><b>Your new link</b> (copy it now; it won&apos;t be shown again):</p>
          <input readOnly value={fresh} onFocus={(e) => e.target.select()} aria-label="New invite link" />
          <button
            type="button"
            className="button small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(fresh);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      {rows && rows.length > 0 && (
        <ul className="invites">
          {rows.map((i) => (
            <li key={i.id}>
              <span>
                <b>{i.label || "Invite link"}</b>
                <span className="fine">
                  {[
                    `${i.use_count} ${i.use_count === 1 ? "join" : "joins"}${i.max_uses ? ` of ${i.max_uses}` : ""}`,
                    i.expires_at ? `until ${new Date(i.expires_at).toLocaleDateString()}` : "no end date",
                    status(i),
                  ].filter(Boolean).join(" · ")}
                </span>
              </span>
              {!status(i) && <button type="button" className="link" onClick={() => revoke(i)}>Revoke</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Settings({ group, onChanged, onDeleted }: { group: Group; onChanged: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [area, setArea] = useState(group.home_area ?? "");
  const [visibility, setVisibility] = useState<GroupVisibility>(group.visibility);
  const [join, setJoin] = useState<JoinPolicy>(group.join_policy);
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await getSupabase()!.from("groups").update({
      name: name.trim(),
      description: description.trim() || null,
      home_area: area.trim() || null,
      visibility,
      join_policy: join,
    }).eq("id", group.id);
    setMessage(error ? "Couldn't save. Names are 3 to 60 characters." : "Saved.");
    if (!error) onChanged();
  }

  async function remove() {
    const typed = window.prompt(`This deletes ${group.name}, its chat, and its invite links for everyone. Type the group name to confirm.`);
    if (typed?.trim() !== group.name.trim()) return;
    const { error } = await getSupabase()!.from("groups").delete().eq("id", group.id);
    if (error) setMessage("Couldn't delete the group.");
    else onDeleted();
  }

  return (
    <section aria-labelledby="settings">
      <h2 id="settings">Group settings</h2>
      <form onSubmit={save} className="form">
        <label><span>Name</span><input required minLength={3} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label><span>Area</span><input maxLength={80} value={area} onChange={(e) => setArea(e.target.value)} /></label>
        <label><span>About the group</span><textarea maxLength={1000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <fieldset>
          <legend>Who can find it</legend>
          <div className="seg">
            <button type="button" aria-pressed={visibility === "public"} onClick={() => setVisibility("public")}>Public</button>
            <button type="button" aria-pressed={visibility === "private"} onClick={() => setVisibility("private")}>Private</button>
          </div>
        </fieldset>
        {visibility === "public" && (
          <fieldset>
            <legend>How people join</legend>
            <div className="seg">
              <button type="button" aria-pressed={join === "request"} onClick={() => setJoin("request")}>They ask, you approve</button>
              <button type="button" aria-pressed={join === "open"} onClick={() => setJoin("open")}>Anyone can join</button>
            </div>
          </fieldset>
        )}
        <button type="submit" className="button">Save settings</button>
        {message && <p className="hint" role="status">{message}</p>}
      </form>
      <button type="button" className="link danger" onClick={remove}>Delete this group</button>
    </section>
  );
}
