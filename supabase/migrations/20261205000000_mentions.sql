-- @mentions in chats (plan 11.62). Typing @username in a direct or group chat
-- tells that person, as long as they're in the chat and nobody in the pair has
-- blocked the other. A mention replaces the usual "new messages" note for that
-- person, so one message never makes two notifications. Reading the chat
-- clears mentions too.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'follow_request', 'new_follower', 'follow_accepted',
  'group_invite', 'join_request', 'join_approved',
  'event_new', 'event_changed', 'event_cancelled', 'event_soon', 'event_location',
  'message', 'mention',
  'road_scored', 'spot_reviewed', 'group_spot_proposed', 'group_spot_accepted',
  'road_check_helped', 'admin_road_check', 'admin_spot_review'
));

-- Everyone in a chat, for the @ suggestions. Only someone in the chat may ask,
-- and people either side has blocked are left out.
create or replace function public.chat_people(p_conversation uuid)
returns table (id uuid, username text, display_name text, avatar_path text, avatar_preset text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_path, p.avatar_preset
  from public.conversations c
  join lateral (
    select user_id from public.conversation_members where conversation_id = c.id and c.kind = 'direct'
    union
    select user_id from public.group_members where group_id = c.group_id and c.kind = 'group'
  ) r on true
  join public.profiles p on p.id = r.user_id
  where c.id = p_conversation and private.in_conversation(p_conversation)
    and p.id <> auth.uid() and not private.blocked_between(p.id, auth.uid())
  order by p.display_name
  limit 500;
$$;
revoke all on function public.chat_people(uuid) from public;
grant execute on function public.chat_people(uuid) to authenticated;

-- The usernames a message mentions: @name not inside a word or an email.
create or replace function private.mentioned_usernames(body text)
returns setof text
language sql immutable set search_path = ''
as $$
  select distinct lower(m[1])
  from regexp_matches(coalesce(body, ''), '(?:^|[^A-Za-z0-9_@.])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])', 'g') as m
  limit 20;
$$;
revoke all on function private.mentioned_usernames(text) from public;

-- New messages: mentioned people get a mention; everyone else in the chat gets
-- the usual one-row-per-chat count.
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
    select user_id as uid from public.conversation_members where conversation_id = c.id and c.kind = 'direct'
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
revoke all on function private.messages_notify() from public;

create or replace function private.chat_read_clears()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.notifications set read_at = now()
  where user_id = new.user_id and conversation_id = new.conversation_id and kind in ('message', 'mention') and read_at is null
    and created_at <= new.last_read_at;
  return null;
end;
$$;
revoke all on function private.chat_read_clears() from public;
