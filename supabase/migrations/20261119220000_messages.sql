-- Direct messages and group chats (docs/plan.md 11.6).
--
-- * A direct conversation is between exactly two people. A group chat belongs
--   to a group, and whoever is a member right now can read and post.
-- * "Who can message me": everyone, people I follow, or nobody. It is checked
--   on every message, not just the first. Someone can always reply in a
--   conversation where the other person has already written to them.
-- * Blocking stops messages both ways (checked in the database).
-- * No moderation and no report button, per the project rules. People delete
--   their own messages.
-- * Photos and GIFs in chats live in a private bucket that only the people in
--   that conversation can read.

create type public.dm_policy as enum ('everyone', 'following', 'nobody');

alter table public.profiles add column dm_policy public.dm_policy not null default 'everyone';
grant select (dm_policy) on public.profiles to anon, authenticated;
grant insert (dm_policy) on public.profiles to authenticated;
grant update (dm_policy) on public.profiles to authenticated;

create type public.conversation_kind as enum ('direct', 'group');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  group_id uuid unique references public.groups (id) on delete cascade,
  -- For direct conversations: the two people's IDs in order, so a pair has one conversation.
  direct_key text unique,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check ((kind = 'group') = (group_id is not null)),
  check ((kind = 'direct') = (direct_key is not null))
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text check (char_length(body) <= 2000),
  media_path text,
  media_kind public.media_kind,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint message_says_something check (nullif(btrim(body), '') is not null or media_path is not null),
  constraint media_kind_with_path check ((media_path is null) = (media_kind is null)),
  constraint media_in_sender_folder check (
    media_path is null or media_path ~ ('^' || conversation_id::text || '/' || sender_id::text || '-[A-Za-z0-9_.-]{1,80}$')
  )
);
create index messages_conversation on public.messages (conversation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers.
create or replace function private.in_conversation(c uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations v
    where v.id = c and (
      (v.kind = 'direct' and exists (
        select 1 from public.conversation_members m where m.conversation_id = c and m.user_id = auth.uid()))
      or (v.kind = 'group' and private.is_member(v.group_id))
    )
  );
$$;

create or replace function private.in_conversation_path(path text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  c uuid;
begin
  begin
    c := split_part(path, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return private.in_conversation(c);
end;
$$;

-- Does this person accept messages from that one?
create or replace function private.accepts_messages_from(recipient uuid, sender uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not private.blocked_between(recipient, sender) and (
    select case p.dm_policy
      when 'everyone' then true
      when 'following' then exists (
        select 1 from public.follows f
        where f.follower_id = recipient and f.followee_id = sender and f.status = 'accepted')
      else false
    end
    from public.profiles p where p.id = recipient
  );
$$;

-- Can the caller post in this conversation right now?
create or replace function private.can_send(c uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.in_conversation(c) and (
    select case
      when v.kind = 'group' then true
      else (
        select private.accepts_messages_from(o.user_id, auth.uid())
           or (not private.blocked_between(o.user_id, auth.uid())
               and exists (select 1 from public.messages m where m.conversation_id = c and m.sender_id = o.user_id))
        from public.conversation_members o
        where o.conversation_id = c and o.user_id <> auth.uid()
      )
    end
    from public.conversations v where v.id = c
  );
$$;

create or replace function private.can_send_path(path text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  c uuid;
begin
  begin
    c := split_part(path, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return private.can_send(c);
end;
$$;

revoke all on function private.can_send_path(text) from public;
grant execute on function private.can_send_path(text) to authenticated;
revoke all on function private.in_conversation(uuid) from public;
revoke all on function private.in_conversation_path(text) from public;
revoke all on function private.accepts_messages_from(uuid, uuid) from public;
revoke all on function private.can_send(uuid) from public;
grant execute on function private.in_conversation(uuid) to authenticated;
grant execute on function private.in_conversation_path(text) to authenticated;
grant execute on function private.accepts_messages_from(uuid, uuid) to authenticated;
grant execute on function private.can_send(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row rules. Signed-out visitors see nothing here.
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "See your conversations" on public.conversations
  for select to authenticated using (private.in_conversation(id));
grant select on public.conversations to authenticated;

create policy "See who is in your conversations" on public.conversation_members
  for select to authenticated using (private.in_conversation(conversation_id));
grant select on public.conversation_members to authenticated;

create policy "Read messages in your conversations" on public.messages
  for select to authenticated using (private.in_conversation(conversation_id));
create policy "Send as yourself where you're allowed" on public.messages
  for insert to authenticated with check (sender_id = (select auth.uid()) and private.can_send(conversation_id));
create policy "Edit your own messages" on public.messages
  for update to authenticated using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()));
create policy "Delete your own messages" on public.messages
  for delete to authenticated using (sender_id = (select auth.uid()));

grant select, delete on public.messages to authenticated;
grant insert (conversation_id, sender_id, body, media_path, media_kind) on public.messages to authenticated;
grant update (body) on public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers.

-- Every group gets a group chat.
create or replace function private.group_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.conversations (kind, group_id) values ('group', new.id);
  return null;
end;
$$;
create trigger groups_create_chat after insert on public.groups
  for each row execute function private.group_after_insert();

-- New messages: stamp the conversation and mark it read for the sender.
create or replace function private.message_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  insert into public.conversation_members (conversation_id, user_id, last_read_at)
  values (new.conversation_id, new.sender_id, new.created_at)
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  return null;
end;
$$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function private.message_after_insert();

-- Edits get a timestamp; a message with a photo can't be edited into nothing.
create or replace function private.message_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.edited_at := now();
  return new;
end;
$$;
create trigger messages_before_update before update of body on public.messages
  for each row execute function private.message_before_update();

-- ---------------------------------------------------------------------------
-- Functions people call.

-- Open (or find) the direct conversation with someone.
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
  k := least(me::text, p_user::text) || ':' || greatest(me::text, p_user::text);
  select id into c from public.conversations where direct_key = k;
  if c is not null then
    if private.blocked_between(me, p_user) then
      raise exception 'You can''t message this person.' using errcode = '42501';
    end if;
    return c;
  end if;
  if not private.accepts_messages_from(p_user, me) then
    raise exception 'This person isn''t taking messages from you.' using errcode = '42501';
  end if;
  insert into public.conversations (kind, direct_key) values ('direct', k) returning id into c;
  insert into public.conversation_members (conversation_id, user_id) values (c, me), (c, p_user);
  return c;
end;
$$;

create or replace function public.mark_read(p_conversation uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.in_conversation(p_conversation) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  insert into public.conversation_members (conversation_id, user_id, last_read_at)
  values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- The inbox: every conversation the caller is in, newest first.
create or replace function public.my_conversations()
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
  can_send boolean
)
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select v.* from public.conversations v
    where (v.kind = 'direct' and exists (
            select 1 from public.conversation_members m where m.conversation_id = v.id and m.user_id = auth.uid()))
       or (v.kind = 'group' and exists (
            select 1 from public.group_members gm where gm.group_id = v.group_id and gm.user_id = auth.uid()))
  )
  select
    v.id, v.kind, g.name, g.short_id,
    o.id, o.username, o.display_name, o.avatar_path, o.avatar_preset,
    v.last_message_at, lm.body, lm.media_path is not null, lm.sender_id,
    (select count(*) from public.messages x
      where x.conversation_id = v.id and x.sender_id <> auth.uid()
        and x.created_at > coalesce(
          (select r.last_read_at from public.conversation_members r where r.conversation_id = v.id and r.user_id = auth.uid()),
          '-infinity'::timestamptz)),
    private.can_send(v.id)
  from mine v
  left join public.groups g on g.id = v.group_id
  left join lateral (
    select p.* from public.conversation_members cm join public.profiles p on p.id = cm.user_id
    where v.kind = 'direct' and cm.conversation_id = v.id and cm.user_id <> auth.uid() limit 1
  ) o on true
  left join lateral (
    select m.body, m.media_path, m.sender_id from public.messages m
    where m.conversation_id = v.id order by m.created_at desc limit 1
  ) lm on true
  order by v.last_message_at desc nulls last, v.created_at desc;
$$;

create or replace function public.unread_count()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(unread), 0)::bigint from public.my_conversations();
$$;

revoke all on function public.start_direct(uuid) from public;
revoke all on function public.mark_read(uuid) from public;
revoke all on function public.my_conversations() from public;
revoke all on function public.unread_count() from public;
grant execute on function public.start_direct(uuid) to authenticated;
grant execute on function public.mark_read(uuid) to authenticated;
grant execute on function public.my_conversations() to authenticated;
grant execute on function public.unread_count() to authenticated;

-- ---------------------------------------------------------------------------
-- Live updates: new messages reach the people allowed to read them.
alter publication supabase_realtime add table public.messages;

-- ---------------------------------------------------------------------------
-- Photos and GIFs in chats.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('message-media', 'message-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Read chat photos in your conversations" on storage.objects
  for select to authenticated using (bucket_id = 'message-media' and private.in_conversation_path(name));
create policy "Send chat photos where you can post" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'message-media'
    and split_part(name, '/', 2) like ((select auth.uid())::text || '-%')
    and private.can_send_path(name)
  );
create policy "Delete your own chat photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'message-media' and split_part(name, '/', 2) like ((select auth.uid())::text || '-%')
  );
