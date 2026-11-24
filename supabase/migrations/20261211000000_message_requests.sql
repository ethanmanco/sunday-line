-- Messages to private profiles wait for a follow (plan 11.75).
--
-- * Public profiles: a new chat lands in their inbox right away (subject to
--   their "who can message me" setting, as before).
-- * Private profiles: a new chat from someone who isn't their approved
--   follower (and whom they don't follow) waits. They don't see it, its
--   messages or a notification until they accept that person's follow
--   request; the first message sends the request if there isn't one. Then the
--   chat shows up with everything in it, and one "new messages" notification.
--   If they decline, it never shows and nobody is told.
-- * Once a chat has shown up it stays, as before. Blocks still stop it all.
--
-- The waiting is a flag on the recipient's row in conversation_members. While
-- it's set, private.in_conversation() is false for them, which hides the chat,
-- its messages, live updates and photos (all of those check it).

alter table public.conversation_members add column pending boolean not null default false;

-- Would a new chat from sender to recipient wait?
create or replace function private.dm_held(recipient uuid, sender uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.is_private from public.profiles p where p.id = recipient), false)
    and not exists (select 1 from public.follows f
                    where f.follower_id = sender and f.followee_id = recipient and f.status = 'accepted')
    -- They follow you, or asked to: they know who you are.
    and not exists (select 1 from public.follows f
                    where f.follower_id = recipient and f.followee_id = sender);
$$;
revoke all on function private.dm_held(uuid, uuid) from public;

create or replace function private.direct_key(a uuid, b uuid)
returns text
language sql immutable set search_path = ''
as $$ select least(a::text, b::text) || ':' || greatest(a::text, b::text); $$;
revoke all on function private.direct_key(uuid, uuid) from public;

-- A waiting chat is not yours to see yet.
create or replace function private.in_conversation(c uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations v
    where v.id = c and (
      (v.kind = 'direct' and exists (
        select 1 from public.conversation_members m
        where m.conversation_id = c and m.user_id = auth.uid() and not m.pending))
      or (v.kind = 'group' and private.is_member(v.group_id))
    )
  );
$$;

-- Show a waiting chat to the recipient, with one notification for what's in it.
create or replace function private.release_held(recipient uuid, sender uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  conv uuid;
  n int;
begin
  update public.conversation_members m set pending = false
  from public.conversations c
  where c.direct_key = private.direct_key(recipient, sender) and m.conversation_id = c.id
    and m.user_id = recipient and m.pending
  returning c.id into conv;
  if conv is null or private.blocked_between(recipient, sender) then return; end if;
  select count(*) into n from public.messages where conversation_id = conv and sender_id = sender;
  if n = 0 then return; end if;
  insert into public.notifications (user_id, kind, actor_id, conversation_id, detail)
  values (recipient, 'message', sender, conv, jsonb_build_object('count', n))
  on conflict (user_id, conversation_id) where kind = 'message' and read_at is null
  do update set actor_id = excluded.actor_id, created_at = now(), detail = excluded.detail;
end;
$$;
revoke all on function private.release_held(uuid, uuid) from public;

-- Accepting a follow request (or a follow that's accepted straight away)
-- releases the follower's waiting chat. Following someone, or asking to,
-- releases theirs.
create or replace function private.follows_release_held()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status = 'pending') then
    perform private.release_held(new.followee_id, new.follower_id);
  end if;
  if tg_op = 'INSERT' then
    perform private.release_held(new.follower_id, new.followee_id);
  end if;
  return null;
end;
$$;
revoke all on function private.follows_release_held() from public;
create trigger follows_release_held after insert or update of status on public.follows
  for each row execute function private.follows_release_held();

-- Going public shows every waiting chat.
create or replace function private.profile_release_held()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  other uuid;
begin
  if old.is_private and not new.is_private then
    for other in
      select o.user_id from public.conversation_members m
      join public.conversation_members o on o.conversation_id = m.conversation_id and o.user_id <> m.user_id
      where m.user_id = new.id and m.pending
    loop
      perform private.release_held(new.id, other);
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function private.profile_release_held() from public;
create trigger profiles_release_held after update of is_private on public.profiles
  for each row execute function private.profile_release_held();

-- The first message in a waiting chat sends a follow request, so there is
-- something to accept.
create or replace function private.message_request_follow()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  peer uuid;
begin
  if new.sender_id is null then return null; end if;
  select m.user_id into peer from public.conversation_members m
  where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id and m.pending;
  if peer is not null and not exists (
    select 1 from public.follows where follower_id = new.sender_id and followee_id = peer
  ) then
    insert into public.follows (follower_id, followee_id) values (new.sender_id, peer) on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.message_request_follow() from public;
create trigger messages_request_follow after insert on public.messages
  for each row execute function private.message_request_follow();

-- Open (or find) the direct conversation with someone. A new chat to a
-- private profile that would wait is marked so. Opening a chat that's waiting
-- for you shows it (you chose to talk to them).
create or replace function public.start_direct(p_user uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  k text;
  c uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'Set up your profile first.' using errcode = '42501';
  end if;
  if p_user = me or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Pick someone else.' using errcode = 'P0002';
  end if;
  k := private.direct_key(me, p_user);
  select id into c from public.conversations where direct_key = k;
  if c is not null then
    if private.blocked_between(me, p_user) then
      raise exception 'You can''t message this person.' using errcode = '42501';
    end if;
    update public.conversation_members set pending = false where conversation_id = c and user_id = me and pending;
    return c;
  end if;
  if not private.accepts_messages_from(p_user, me) then
    raise exception 'This person isn''t taking messages from you.' using errcode = '42501';
  end if;
  insert into public.conversations (kind, direct_key) values ('direct', k) returning id into c;
  insert into public.conversation_members (conversation_id, user_id, pending)
  values (c, me, false), (c, p_user, private.dm_held(p_user, me));
  return c;
end;
$$;

-- The inbox: every conversation the caller is in, newest first. Waiting chats
-- are left out for the recipient; for the sender, "waiting" says the other
-- person hasn't accepted yet.
drop function public.my_conversations();
create function public.my_conversations()
returns table (
  id uuid,
  kind public.conversation_kind,
  group_name text,
  group_short_id text,
  other_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_path text,
  other_avatar_preset text,
  last_message_at timestamptz,
  last_body text,
  last_has_media boolean,
  last_sender_id uuid,
  unread bigint,
  can_send boolean,
  waiting boolean
)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select v.* from public.conversations v
    where (v.kind = 'direct' and exists (
            select 1 from public.conversation_members m
            where m.conversation_id = v.id and m.user_id = auth.uid() and not m.pending))
       or (v.kind = 'group' and exists (
            select 1 from public.group_members gm where gm.group_id = v.group_id and gm.user_id = auth.uid()))
  )
  select
    v.id, v.kind, g.name, g.short_id,
    o.id, o.username, o.display_name, o.avatar_path, o.avatar_preset,
    v.last_message_at, lm.body, lm.media_path is not null, lm.sender_id,
    (select count(*) from public.messages x
      where x.conversation_id = v.id and x.sender_id is distinct from auth.uid()
        and x.created_at > coalesce(
          (select r.last_read_at from public.conversation_members r where r.conversation_id = v.id and r.user_id = auth.uid()),
          '-infinity'::timestamptz)),
    private.can_send(v.id),
    coalesce(o.pending, false)
  from mine v
  left join public.groups g on g.id = v.group_id
  left join lateral (
    select p.*, cm.pending from public.conversation_members cm join public.profiles p on p.id = cm.user_id
    where v.kind = 'direct' and cm.conversation_id = v.id and cm.user_id <> auth.uid() limit 1
  ) o on true
  left join lateral (
    select m.body, m.media_path, m.sender_id from public.messages m
    where m.conversation_id = v.id order by m.created_at desc limit 1
  ) lm on true
  order by v.last_message_at desc nulls last, v.created_at desc;
$$;
revoke all on function public.my_conversations() from public;
grant execute on function public.my_conversations() to authenticated;

-- New messages: nobody is told about a chat that's waiting for them.
create or replace function private.messages_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c public.conversations;
  gname text;
  rcpt uuid[];
  mentioned uuid[];
begin
  if new.sender_id is null then return null; end if; -- event posts have their own notifications
  select * into c from public.conversations where id = new.conversation_id;
  select name into gname from public.groups where id = c.group_id;

  select coalesce(array_agg(r.uid), '{}') into rcpt from (
    select user_id as uid from public.conversation_members
    where conversation_id = c.id and c.kind = 'direct' and not pending
    union
    select user_id from public.group_members where group_id = c.group_id and c.kind = 'group'
  ) r
  where r.uid <> new.sender_id and not private.blocked_between(r.uid, new.sender_id);

  select coalesce(array_agg(p.id), '{}') into mentioned
  from public.profiles p
  where p.id = any (rcpt) and p.username in (select private.mentioned_usernames(new.body));

  insert into public.notifications (user_id, kind, actor_id, group_id, conversation_id, title)
  select uid, 'mention', new.sender_id, c.group_id, c.id, gname
  from unnest(mentioned) as uid;

  insert into public.notifications (user_id, kind, actor_id, group_id, conversation_id, title, detail)
  select uid, 'message', new.sender_id, c.group_id, c.id, gname, jsonb_build_object('count', 1)
  from unnest(rcpt) as uid where not (uid = any (mentioned))
  on conflict (user_id, conversation_id) where kind = 'message' and read_at is null
  do update set actor_id = excluded.actor_id, created_at = now(),
    detail = jsonb_build_object('count', coalesce((public.notifications.detail ->> 'count')::int, 1) + 1);
  return null;
end;
$$;

-- People to start a chat with, for the + in Messages. Searching (2+ letters)
-- looks at everyone; otherwise it lists people you follow and who follow you.
-- reach: 'direct' (lands in their inbox), 'request' (waits for them to accept
-- your follow request), 'closed' (their settings don't take messages from you).
create or replace function public.message_candidates(q text default null)
returns table (
  id uuid, username text, display_name text, avatar_path text, avatar_preset text, reach text, has_chat boolean
)
language sql stable security definer set search_path = ''
as $$
  with term as (
    select lower(btrim(coalesce(q, ''))) as t,
           replace(replace(replace(lower(btrim(coalesce(q, ''))), '\', '\\'), '%', '\%'), '_', '\_') as e
  ),
  base as (
    select p.* from public.profiles p, term
    where (char_length(term.t) >= 2
           and (p.username like term.e || '%' or lower(p.display_name) like '%' || term.e || '%'))
       or (char_length(term.t) < 2 and p.id in (
             select followee_id from public.follows where follower_id = auth.uid() and status = 'accepted'
             union
             select follower_id from public.follows where followee_id = auth.uid() and status = 'accepted'))
  )
  select b.id, b.username, b.display_name, b.avatar_path, b.avatar_preset,
    case
      when x.conv is not null and exists (
        select 1 from public.conversation_members m where m.conversation_id = x.conv and m.user_id = b.id and not m.pending)
        then case when private.can_send(x.conv) then 'direct' else 'closed' end
      when not private.accepts_messages_from(b.id, auth.uid()) then 'closed'
      when private.dm_held(b.id, auth.uid()) then 'request'
      else 'direct'
    end,
    x.conv is not null
  from base b
  cross join term
  left join lateral (
    select c.id as conv from public.conversations c where c.direct_key = private.direct_key(auth.uid(), b.id)
  ) x on true
  where auth.uid() is not null and b.id <> auth.uid() and not private.blocked_between(auth.uid(), b.id)
  order by (b.username = term.t) desc, (b.username like term.e || '%') desc, b.display_name
  limit 30;
$$;
revoke all on function public.message_candidates(text) from public;
grant execute on function public.message_candidates(text) to authenticated;
