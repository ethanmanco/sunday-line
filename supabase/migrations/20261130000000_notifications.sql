-- Notifications (plan 11.40): one list per member, behind a bell in the top
-- bar. Rows are written by triggers and functions here, never by the app, so
-- what someone is told always matches what really happened. Blocks are
-- respected: nobody is told about something a person they blocked (or who
-- blocked them) did. Also: direct group invites (until now groups had invite
-- links only), so "you're invited" can be a notification with Accept.

-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'follow_request', 'new_follower', 'follow_accepted',
    'group_invite', 'join_request', 'join_approved',
    'event_new', 'event_changed', 'event_cancelled', 'event_soon', 'event_location',
    'message',
    'road_scored', 'spot_reviewed', 'group_spot_proposed', 'group_spot_accepted',
    'road_check_helped', 'admin_road_check', 'admin_spot_review'
  )),
  actor_id uuid references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  spot_id uuid references public.spots (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  road_id text check (road_id ~ '^[a-f0-9]{12}$'),
  -- What it was called when it happened (group name, event title, spot name),
  -- so an invite to a private group can show the group's name.
  title text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_mine on public.notifications (user_id, created_at desc);
-- One unread "new messages" row per chat, updated as more arrive.
create unique index notifications_one_unread_chat on public.notifications (user_id, conversation_id)
  where kind = 'message' and read_at is null;

alter table public.notifications enable row level security;
create policy "See your own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Clear your own notifications" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.notifications to authenticated;
alter publication supabase_realtime add table public.notifications;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;
revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

create or replace function public.unread_notifications()
returns integer
language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.notifications where user_id = auth.uid() and read_at is null; $$;
revoke all on function public.unread_notifications() from public;
grant execute on function public.unread_notifications() to authenticated;

-- The one way rows get written.
create or replace function private.notify(
  p_user uuid, p_kind text, p_actor uuid default null, p_group uuid default null, p_event uuid default null,
  p_spot uuid default null, p_road text default null, p_title text default null, p_detail jsonb default '{}'
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  if private.blocked_between(p_user, p_actor) then return; end if;
  insert into public.notifications (user_id, kind, actor_id, group_id, event_id, spot_id, road_id, title, detail)
  values (p_user, p_kind, p_actor, p_group, p_event, p_spot, p_road, p_title, coalesce(p_detail, '{}'));
end;
$$;
revoke all on function private.notify(uuid, text, uuid, uuid, uuid, uuid, text, text, jsonb) from public;

-- Members of a group who hold a permission (organizers hold them all).
create or replace function private.members_with(g uuid, perm text)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select user_id from public.group_members
  where group_id = g and (role = 'organizer' or (role = 'moderator' and perm = any (permissions)));
$$;
revoke all on function private.members_with(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Follows: a request, a new follower, a request accepted.
create or replace function private.follows_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify(new.followee_id,
      case when new.status = 'pending' then 'follow_request' else 'new_follower' end, new.follower_id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform private.notify(new.follower_id, 'follow_accepted', new.followee_id);
    update public.notifications set read_at = now()
    where user_id = new.followee_id and kind = 'follow_request' and actor_id = new.follower_id and read_at is null;
  elsif tg_op = 'DELETE' and old.status = 'pending' then
    -- Declined or withdrawn: the request disappears from the list.
    delete from public.notifications
    where user_id = old.followee_id and kind = 'follow_request' and actor_id = old.follower_id and read_at is null;
  end if;
  return null;
end;
$$;
revoke all on function private.follows_notify() from public;
create trigger follows_notify after insert or update of status or delete on public.follows
  for each row execute function private.follows_notify();

-- ---------------------------------------------------------------------------
-- Direct group invites: someone with the invites permission invites a member
-- by username; the invitee accepts or declines from their notifications.
create table public.group_member_invites (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_member_invites enable row level security;
create policy "Invitees and inviters see invites" on public.group_member_invites
  for select to authenticated using (user_id = (select auth.uid()) or private.has_perm(group_id, 'invites'));
grant select on public.group_member_invites to authenticated;

create or replace function public.invite_to_group(p_group uuid, p_username text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  them uuid;
  gname text;
begin
  if not private.has_perm(p_group, 'invites') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select id into them from public.profiles where username = lower(btrim(p_username));
  -- A block looks the same as "no such member", so it can't be probed.
  if them is null or private.blocked_between(me, them) then
    raise exception 'No member with that username.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.group_members where group_id = p_group and user_id = them) then
    raise exception 'They''re already in the group.' using errcode = '23505';
  end if;
  if exists (select 1 from public.group_member_invites where group_id = p_group and user_id = them) then return; end if;
  if (select count(*) from public.group_member_invites where invited_by = me and created_at > now() - interval '1 day') >= 50 then
    raise exception 'That''s the limit for today.' using errcode = '54000';
  end if;
  insert into public.group_member_invites (group_id, user_id, invited_by) values (p_group, them, me);
  select name into gname from public.groups where id = p_group;
  perform private.notify(them, 'group_invite', me, p_group, p_title => gname);
end;
$$;
revoke all on function public.invite_to_group(uuid, text) from public;
grant execute on function public.invite_to_group(uuid, text) to authenticated;

create or replace function public.answer_group_invite(p_group uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.group_member_invites where group_id = p_group and user_id = me) then
    raise exception 'No such invite.' using errcode = 'P0002';
  end if;
  delete from public.group_member_invites where group_id = p_group and user_id = me;
  if p_accept then
    insert into public.group_members (group_id, user_id) values (p_group, me) on conflict do nothing;
    delete from public.join_requests where group_id = p_group and user_id = me;
  end if;
  update public.notifications set read_at = now()
  where user_id = me and kind = 'group_invite' and group_id = p_group and read_at is null;
end;
$$;
revoke all on function public.answer_group_invite(uuid, boolean) from public;
grant execute on function public.answer_group_invite(uuid, boolean) to authenticated;

-- Joining another way (link, open group, approval) clears a pending invite.
create or replace function private.member_clears_invite()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.group_member_invites where group_id = new.group_id and user_id = new.user_id;
  update public.notifications set read_at = now()
  where user_id = new.user_id and kind = 'group_invite' and group_id = new.group_id and read_at is null;
  return null;
end;
$$;
revoke all on function private.member_clears_invite() from public;
create trigger group_members_clear_invite after insert on public.group_members
  for each row execute function private.member_clears_invite();

-- ---------------------------------------------------------------------------
-- Join requests: approvers hear about a request; the requester hears "you're in".
create or replace function private.join_request_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  gname text;
  u uuid;
begin
  select name into gname from public.groups where id = new.group_id;
  for u in select private.members_with(new.group_id, 'approve') loop
    perform private.notify(u, 'join_request', new.user_id, new.group_id, p_title => gname);
  end loop;
  return null;
end;
$$;
revoke all on function private.join_request_notify() from public;
create trigger join_requests_notify after insert on public.join_requests
  for each row execute function private.join_request_notify();

create or replace function public.decide_join_request(p_group uuid, p_user uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_perm(p_group, 'approve') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.join_requests where group_id = p_group and user_id = p_user) then
    raise exception 'No such request.' using errcode = 'P0002';
  end if;
  delete from public.join_requests where group_id = p_group and user_id = p_user;
  if p_approve then
    insert into public.group_members (group_id, user_id) values (p_group, p_user) on conflict do nothing;
    perform private.notify(p_user, 'join_approved', null, p_group,
      p_title => (select name from public.groups where id = p_group));
  end if;
  -- The request is handled for every approver.
  update public.notifications set read_at = now()
  where kind = 'join_request' and group_id = p_group and actor_id = p_user and read_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Events: new ones go to the group; changes, reminders, and the location going
-- out go to those who said going or maybe. (The group chat posts too.)
create or replace function private.events_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  u uuid;
  kind text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'scheduled' then
      for u in select user_id from public.group_members where group_id = new.group_id loop
        perform private.notify(u, 'event_new', new.created_by, new.group_id, new.id, p_title => new.title,
          p_detail => jsonb_build_object('starts_at', new.starts_at));
      end loop;
    end if;
    return null;
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for u in select user_id from public.group_members where group_id = new.group_id loop
      perform private.notify(u, 'event_cancelled', null, new.group_id, new.id, p_title => new.title);
    end loop;
    return null;
  end if;
  kind := case
    when new.starts_at <> old.starts_at then 'event_changed'
    when new.sent_location_at is not null and old.sent_location_at is null then 'event_location'
    when new.sent_reminder_at is not null and old.sent_reminder_at is null and new.starts_at > now() then 'event_soon'
  end;
  if kind is not null and new.status = 'scheduled' then
    for u in select user_id from public.event_rsvps where event_id = new.id and status in ('going', 'maybe') loop
      perform private.notify(u, kind, null, new.group_id, new.id, p_title => new.title,
        p_detail => jsonb_build_object('starts_at', new.starts_at));
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function private.events_notify() from public;
create trigger events_notify after insert or update on public.events
  for each row execute function private.events_notify();

-- ---------------------------------------------------------------------------
-- Messages: one unread row per chat, counting up; reading the chat clears it.
create or replace function private.messages_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c public.conversations;
begin
  if new.sender_id is null then return null; end if; -- event posts have their own notifications
  select * into c from public.conversations where id = new.conversation_id;
  insert into public.notifications (user_id, kind, actor_id, group_id, conversation_id, title, detail)
  select r.uid, 'message', new.sender_id, c.group_id, c.id,
         (select name from public.groups where id = c.group_id), jsonb_build_object('count', 1)
  from (
    select user_id as uid from public.conversation_members where conversation_id = c.id and c.kind = 'direct'
    union
    select user_id from public.group_members where group_id = c.group_id and c.kind = 'group'
  ) r
  where r.uid <> new.sender_id and not private.blocked_between(r.uid, new.sender_id)
  on conflict (user_id, conversation_id) where kind = 'message' and read_at is null
  do update set actor_id = excluded.actor_id, created_at = now(),
    detail = jsonb_build_object('count', coalesce((public.notifications.detail ->> 'count')::int, 1) + 1);
  return null;
end;
$$;
revoke all on function private.messages_notify() from public;
create trigger messages_notify after insert on public.messages
  for each row execute function private.messages_notify();

create or replace function private.chat_read_clears()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.notifications set read_at = now()
  where user_id = new.user_id and conversation_id = new.conversation_id and kind = 'message' and read_at is null
    and created_at <= new.last_read_at;
  return null;
end;
$$;
revoke all on function private.chat_read_clears() from public;
create trigger conversation_read_clears after insert or update of last_read_at on public.conversation_members
  for each row execute function private.chat_read_clears();

-- ---------------------------------------------------------------------------
-- Score this road: the requester hears when it's done (or couldn't be done).
create or replace function private.road_scores_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status in ('done', 'failed') and old.status is distinct from new.status then
    perform private.notify(new.requested_by, 'road_scored', null, null, null, new.spot_id,
      p_title => (select name from public.spots where id = new.spot_id),
      p_detail => jsonb_build_object('status', new.status));
  end if;
  return null;
end;
$$;
revoke all on function private.road_scores_notify() from public;
create trigger road_scores_notify after update of status on public.road_scores
  for each row execute function private.road_scores_notify();

-- Public spots: the owner hears the admin's decision; the admin hears about new ones waiting.
create or replace function private.spots_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  u uuid;
begin
  if new.public_status is distinct from old.public_status then
    if old.public_status = 'pending' and new.public_status in ('approved', 'rejected') then
      perform private.notify(new.owner_id, 'spot_reviewed', null, null, null, new.id, p_title => new.name,
        p_detail => jsonb_build_object('status', new.public_status, 'note', new.public_note));
    elsif new.public_status = 'pending' then
      for u in select user_id from private.site_admins loop
        perform private.notify(u, 'admin_spot_review', new.owner_id, null, null, new.id, p_title => new.name);
      end loop;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.spots_notify() from public;
create trigger spots_notify after update of public_status on public.spots
  for each row execute function private.spots_notify();

-- Group spots: approvers hear about a proposal; the proposer hears it was added.
create or replace function private.spot_groups_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  u uuid;
  gname text;
  sname text;
begin
  select name into gname from public.groups where id = new.group_id;
  select name into sname from public.spots where id = new.spot_id;
  if tg_op = 'INSERT' and new.status = 'proposed' then
    for u in select private.members_with(new.group_id, 'spots') loop
      perform private.notify(u, 'group_spot_proposed', new.added_by, new.group_id, null, new.spot_id, p_title => gname,
        p_detail => jsonb_build_object('spot', sname));
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'proposed' and new.status = 'accepted' then
    perform private.notify(new.added_by, 'group_spot_accepted', null, new.group_id, null, new.spot_id, p_title => gname,
      p_detail => jsonb_build_object('spot', sname));
  end if;
  return null;
end;
$$;
revoke all on function private.spot_groups_notify() from public;
create trigger spot_groups_notify after insert or update of status on public.spot_groups
  for each row execute function private.spot_groups_notify();

-- Road checks: everyone whose flag helped hears when a check is accepted; the
-- admin hears when one is waiting.
create or replace function private.road_checks_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  u uuid;
  since timestamptz := case when tg_op = 'UPDATE' and old.status = 'dismissed' then old.decided_at end;
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') then
    for u in
      select r.user_id from public.road_ratings r
      where r.road_id = new.road_id and r.updated_at > coalesce(since, '-infinity'::timestamptz)
        and case when new.kind = 'rough' then r.pavement = 'rough' else new.kind = any (r.flags) end
        and not exists (select 1 from private.site_admins a where a.user_id = r.user_id)
    loop
      perform private.notify(u, 'road_check_helped', null, p_road => new.road_id, p_detail => jsonb_build_object('kind', new.kind));
    end loop;
  elsif new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    for u in select user_id from private.site_admins loop
      perform private.notify(u, 'admin_road_check', null, p_road => new.road_id, p_detail => jsonb_build_object('kind', new.kind));
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function private.road_checks_notify() from public;
create trigger road_checks_notify after insert or update of status on public.road_checks
  for each row execute function private.road_checks_notify();

-- ---------------------------------------------------------------------------
-- Old notifications go away: read ones after 60 days, all after 120.
create or replace function private.sweep_notifications()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.notifications
  where (read_at is not null and read_at < now() - interval '60 days') or created_at < now() - interval '120 days';
$$;
revoke all on function private.sweep_notifications() from public;
select cron.schedule('sunday-line-notification-sweep', '41 4 * * *', 'select private.sweep_notifications()');
