"use client";

import { useCallback, useEffect, useState } from "react";
import PersonRow from "@/components/profile/PersonRow";
import { can, type Membership } from "./GroupView";
import {
  getSupabase, PERMISSION_LABEL, PROFILE_COLUMNS,
  type Group, type GroupMember, type GroupPermission, type GroupRole,
} from "@/lib/supabase";

const ROLE_ORDER: Record<GroupRole, number> = { organizer: 0, moderator: 1, member: 2 };

export default function GroupMembers({ group, me, myId, onChanged }: {
  group: Group;
  me: Membership;
  myId: string;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb
      .from("group_members")
      .select(`group_id, user_id, role, permissions, joined_at, person:profiles!group_members_user_id_fkey(${PROFILE_COLUMNS})`)
      .eq("group_id", group.id)
      .limit(1000);
    const rows = ((data as unknown as GroupMember[]) ?? []).sort(
      (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.person?.display_name ?? "").localeCompare(b.person?.display_name ?? ""),
    );
    setMembers(rows);
  }, [group.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    const { error } = await fn();
    if (error) setError("That didn't work. You may not have permission.");
    setOpen(null);
    await load();
    onChanged();
  }

  if (!members) return <p className="fine">Loading...</p>;
  const sb = getSupabase()!;
  const isOrganizer = me.role === "organizer";

  return (
    <>
      <ul className="people">
        {members.map((m) => {
          if (!m.person) return null;
          const self = m.user_id === myId;
          const canRemove = !self && m.role !== "organizer" && (isOrganizer || (m.role === "member" && can(me, "remove")));
          const canManage = isOrganizer && !self;
          return (
            <li key={m.user_id} className="member">
              <PersonRow person={m.person}>
                {m.role !== "member" && <span className="tag">{m.role === "organizer" ? "Organizer" : "Moderator"}</span>}
                {(canManage || canRemove) && (
                  <button type="button" className="link" aria-expanded={open === m.user_id} onClick={() => setOpen(open === m.user_id ? null : m.user_id)}>
                    {open === m.user_id ? "Close" : "Manage"}
                  </button>
                )}
              </PersonRow>
              {open === m.user_id && (
                <MemberControls
                  member={m}
                  canManage={canManage}
                  canRemove={canRemove}
                  onRole={(role, perms) => run(() => sb.rpc("set_member_role", { p_group: group.id, p_user: m.user_id, p_role: role, p_permissions: perms }))}
                  onRemove={() => {
                    if (window.confirm(`Remove ${m.person!.display_name} from ${group.name}?`)) {
                      run(() => sb.rpc("remove_member", { p_group: group.id, p_user: m.user_id }));
                    }
                  }}
                  onHandOff={() => {
                    if (window.confirm(`Make ${m.person!.display_name} the organizer? You'll become a moderator with every permission.`)) {
                      run(() => sb.rpc("transfer_organizer", { p_group: group.id, p_user: m.user_id }));
                    }
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="hint warn" role="alert">{error}</p>}
      {isOrganizer && <p className="fine">To leave a group you organize, hand it to another member first.</p>}
    </>
  );
}

function MemberControls({ member, canManage, canRemove, onRole, onRemove, onHandOff }: {
  member: GroupMember;
  canManage: boolean;
  canRemove: boolean;
  onRole: (role: GroupRole, perms: string[]) => void;
  onRemove: () => void;
  onHandOff: () => void;
}) {
  const [role, setRole] = useState<GroupRole>(member.role === "organizer" ? "member" : member.role);
  const [perms, setPerms] = useState<string[]>(member.permissions);

  return (
    <div className="form rate member-controls">
      {canManage && (
        <>
          <fieldset>
            <legend>Role</legend>
            <div className="seg">
              <button type="button" aria-pressed={role === "member"} onClick={() => setRole("member")}>Member</button>
              <button type="button" aria-pressed={role === "moderator"} onClick={() => setRole("moderator")}>Moderator</button>
            </div>
          </fieldset>
          {role === "moderator" && (
            <fieldset>
              <legend>What this moderator can do</legend>
              {(Object.keys(PERMISSION_LABEL) as GroupPermission[]).map((p) => (
                <label key={p} className="check">
                  <input
                    type="checkbox"
                    checked={perms.includes(p)}
                    onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))}
                  />
                  <span>{PERMISSION_LABEL[p]}</span>
                </label>
              ))}
              <span className="fine">Creating events comes with the events update.</span>
            </fieldset>
          )}
          <div className="row">
            <button type="button" className="button small" onClick={() => onRole(role, role === "moderator" ? perms : [])}>Save role</button>
            <button type="button" className="button ghost small" onClick={onHandOff}>Make organizer</button>
          </div>
        </>
      )}
      {canRemove && <button type="button" className="link" onClick={onRemove}>Remove from group</button>}
    </div>
  );
}
