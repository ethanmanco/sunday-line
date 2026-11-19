-- Group events, plus keeping private-group spots off profiles
-- (docs/plan.md 11.18).
--
-- * Events belong to a group; only members see them. The organizer and
--   moderators with the "events" permission create and change them.
-- * An event's location is a spot: public, the group's, or the creator's own.
--   A copy of the spot is kept with the event, in its own table, so the
--   location can stay hidden until a chosen time before the start. Until then
--   only event managers see it.
-- * Optional posts in the group chat: when the event is created, a reminder
--   before it, the morning of, and when the location is released. A scheduled
--   job (pg_cron, every 5 minutes) sends the timed ones. These posts come from
--   Sunday Line itself, not from a person.

-- ---------------------------------------------------------------------------
-- Spots from private groups never appear on profiles.
create or replace function private.profile_shows_spot(owner uuid, spot_group uuid, picked boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    (spot_group is null or exists (select 1 from public.groups g where g.id = spot_group and g.visibility = 'public'))
    and coalesce((
      select case p.spots_display
        when 'all' then true
        when 'selected' then picked
        when 'groups' then spot_group is not null and exists (
          select 1 from public.profile_spot_groups x where x.user_id = owner and x.group_id = spot_group)
        else false
      end
      from public.profiles p where p.id = owner
    ), false);
$$;

drop policy "Your own profile spot groups" on public.profile_spot_groups;
create policy "See your own profile spot groups" on public.profile_spot_groups
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Pick public groups for your profile" on public.profile_spot_groups
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.groups g where g.id = group_id and g.visibility = 'public')
  );
create policy "Unpick groups" on public.profile_spot_groups
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Messages from Sunday Line itself (event posts): no sender, tied to an event.
create type public.event_status as enum ('scheduled', 'cancelled');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 80),
  description text check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'America/Chicago' check (char_length(timezone) between 3 and 64),
  status public.event_status not null default 'scheduled',
  -- null: show the location right away. Otherwise this many minutes before the start.
  location_release_minutes int check (location_release_minutes between 0 and 20160),
  announce_on_create boolean not null default true,
  -- null: no reminder. Otherwise this many minutes before the start.
  remind_before_minutes int check (remind_before_minutes between 60 and 20160),
  remind_day_of boolean not null default true,
  sent_reminder_at timestamptz,
  sent_day_of_at timestamptz,
  sent_location_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index events_group on public.events (group_id, starts_at);
create index events_due on public.events (starts_at) where status = 'scheduled';
create trigger events_touch before update on public.events for each row execute function public.touch_updated_at();

alter table public.messages
  alter column sender_id drop not null,
  add column event_id uuid references public.events (id) on delete set null,
  add constraint system_messages_have_an_event check (sender_id is not null or event_id is not null);

-- Unread counts and read marks must handle messages without a sender.
create or replace function private.message_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  if new.sender_id is not null then
    insert into public.conversation_members (conversation_id, user_id, last_read_at)
    values (new.conversation_id, new.sender_id, new.created_at)
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  end if;
  return null;
end;
$$;

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
      where x.conversation_id = v.id and x.sender_id is distinct from auth.uid()
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

-- ---------------------------------------------------------------------------
-- Event location: a copy of the chosen spot, hidden until released.
create table public.event_locations (
  event_id uuid primary key references public.events (id) on delete cascade,
  spot_id uuid references public.spots (id) on delete set null,
  name text not null,
  kind public.spot_kind not null,
  category public.spot_category,
  lat double precision not null,
  lng double precision not null,
  line text,
  notes text
);

create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status text not null check (status in ('going', 'maybe', 'no')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create trigger event_rsvps_touch before update on public.event_rsvps for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers.
create or replace function private.event_group(e uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select group_id from public.events where id = e; $$;

-- Is the location visible to the caller now?
create or replace function private.event_location_visible(e uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.events ev
    where ev.id = e and private.is_member(ev.group_id)
      and (
        private.has_perm(ev.group_id, 'events')
        or ev.location_release_minutes is null
        or now() >= ev.starts_at - make_interval(mins => ev.location_release_minutes)
      )
  );
$$;

-- "Sat, Nov 22 at 9:00 AM" in the event's own time zone.
create or replace function private.event_when(ev public.events)
returns text
language sql stable set search_path = ''
as $$
  select trim(to_char(ev.starts_at at time zone ev.timezone, 'Dy, Mon FMDD "at" FMHH12:MI AM'));
$$;

-- When the morning-of post goes out: 8 AM local, or an hour before an early start.
create or replace function private.event_day_of_at(ev public.events)
returns timestamptz
language sql stable set search_path = ''
as $$
  select case
    when extract(hour from ev.starts_at at time zone ev.timezone) < 9 then ev.starts_at - interval '1 hour'
    else (date_trunc('day', ev.starts_at at time zone ev.timezone) + interval '8 hours') at time zone ev.timezone
  end;
$$;

-- Post in the event's group chat as Sunday Line.
create or replace function private.post_event_message(ev public.events, body text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.messages (conversation_id, sender_id, body, event_id)
  select c.id, null, body, ev.id from public.conversations c where c.group_id = ev.group_id;
end;
$$;

revoke all on function private.event_group(uuid) from public;
revoke all on function private.event_location_visible(uuid) from public;
revoke all on function private.post_event_message(public.events, text) from public;
grant execute on function private.event_group(uuid) to authenticated;
grant execute on function private.event_location_visible(uuid) to authenticated;
grant execute on function private.event_when(public.events) to authenticated;
grant execute on function private.event_day_of_at(public.events) to authenticated;

-- ---------------------------------------------------------------------------
-- Row rules. Signed-out visitors see no events.
alter table public.events enable row level security;
alter table public.event_locations enable row level security;
alter table public.event_rsvps enable row level security;

create policy "Members see their group's events" on public.events
  for select to authenticated using (private.is_member(group_id));
create policy "Event managers create events" on public.events
  for insert to authenticated with check (private.has_perm(group_id, 'events') and created_by = (select auth.uid()));
create policy "Event managers change events" on public.events
  for update to authenticated using (private.has_perm(group_id, 'events')) with check (private.has_perm(group_id, 'events'));
create policy "Event managers delete events" on public.events
  for delete to authenticated using (private.has_perm(group_id, 'events'));

grant select on public.events to authenticated;
grant insert (group_id, created_by, title, description, starts_at, ends_at, timezone, location_release_minutes,
              announce_on_create, remind_before_minutes, remind_day_of) on public.events to authenticated;
grant update (title, description, starts_at, ends_at, timezone, status, location_release_minutes,
              announce_on_create, remind_before_minutes, remind_day_of) on public.events to authenticated;
grant delete on public.events to authenticated;

create policy "Members see the location once it's released" on public.event_locations
  for select to authenticated using (private.event_location_visible(event_id));
grant select on public.event_locations to authenticated;

create policy "Members see RSVPs" on public.event_rsvps
  for select to authenticated using (private.is_member(private.event_group(event_id)));
create policy "RSVP as yourself" on public.event_rsvps
  for insert to authenticated with check (user_id = (select auth.uid()) and private.is_member(private.event_group(event_id)));
create policy "Change your RSVP" on public.event_rsvps
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Remove your RSVP" on public.event_rsvps
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.event_rsvps to authenticated;
grant insert (event_id, user_id, status) on public.event_rsvps to authenticated;
grant update (status) on public.event_rsvps to authenticated;

-- ---------------------------------------------------------------------------
-- Choose the location: a spot the caller may use for this group's event.
create or replace function public.set_event_location(p_event uuid, p_spot uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ev public.events%rowtype;
  s public.spots%rowtype;
begin
  select * into ev from public.events where id = p_event;
  if ev.id is null or not private.has_perm(ev.group_id, 'events') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_spot is null then
    delete from public.event_locations where event_id = p_event;
    return;
  end if;
  select * into s from public.spots where id = p_spot;
  -- coalesce: a spot with no group must count as "no", not "unknown".
  if s.id is null or not coalesce(
    s.public_status = 'approved'
    or (s.group_id = ev.group_id and s.group_status = 'accepted')
    or s.owner_id = auth.uid(),
    false
  ) then
    raise exception 'Pick a public spot, one of this group''s spots, or one of yours.' using errcode = '42501';
  end if;
  insert into public.event_locations (event_id, spot_id, name, kind, category, lat, lng, line, notes)
  values (p_event, s.id, s.name, s.kind, s.category, s.lat, s.lng, s.line, s.description)
  on conflict (event_id) do update set
    spot_id = excluded.spot_id, name = excluded.name, kind = excluded.kind, category = excluded.category,
    lat = excluded.lat, lng = excluded.lng, line = excluded.line, notes = excluded.notes;
end;
$$;
revoke all on function public.set_event_location(uuid, uuid) from public;
grant execute on function public.set_event_location(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Posts when an event is created or changed. Timed posts whose moment has
-- already passed are marked done so they don't fire late.
create or replace function private.event_mark_passed(ev public.events)
returns public.events
language plpgsql stable set search_path = ''
as $$
begin
  if ev.remind_before_minutes is not null and now() >= ev.starts_at - make_interval(mins => ev.remind_before_minutes) then
    ev.sent_reminder_at := now();
  end if;
  if ev.remind_day_of and now() >= private.event_day_of_at(ev) then
    ev.sent_day_of_at := now();
  end if;
  if ev.location_release_minutes is not null and now() >= ev.starts_at - make_interval(mins => ev.location_release_minutes) then
    ev.sent_location_at := now();
  end if;
  return ev;
end;
$$;

create or replace function private.event_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.sent_reminder_at := null;
    new.sent_day_of_at := null;
    new.sent_location_at := null;
    new.status := 'scheduled';
    new := private.event_mark_passed(new);
  elsif new.starts_at is distinct from old.starts_at
     or new.remind_before_minutes is distinct from old.remind_before_minutes
     or new.remind_day_of is distinct from old.remind_day_of
     or new.location_release_minutes is distinct from old.location_release_minutes then
    -- New timing: schedule again, skipping moments already past.
    new.sent_reminder_at := null;
    new.sent_day_of_at := null;
    new.sent_location_at := null;
    new := private.event_mark_passed(new);
  end if;
  return new;
end;
$$;
create trigger events_before_write before insert or update on public.events
  for each row execute function private.event_before_write();

create or replace function private.event_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.announce_on_create then
      perform private.post_event_message(new, format('New event: %s, %s. Open the group''s Events tab to RSVP.', new.title, private.event_when(new)));
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.post_event_message(new, format('Canceled: %s (%s).', new.title, private.event_when(new)));
  elsif new.status = 'scheduled' and new.starts_at is distinct from old.starts_at then
    perform private.post_event_message(new, format('Time change: %s is now %s.', new.title, private.event_when(new)));
  end if;
  return null;
end;
$$;
create trigger events_after_write after insert or update on public.events
  for each row execute function private.event_after_write();

-- ---------------------------------------------------------------------------
-- The scheduled job: reminders, morning-of posts, and location releases.
create or replace function private.run_event_jobs()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  ev public.events%rowtype;
  n int := 0;
begin
  for ev in
    select * from public.events
    where status = 'scheduled' and starts_at > now() - interval '1 hour' and starts_at < now() + interval '15 days'
    for update skip locked
  loop
    if ev.remind_before_minutes is not null and ev.sent_reminder_at is null
       and now() >= ev.starts_at - make_interval(mins => ev.remind_before_minutes) and now() < ev.starts_at then
      perform private.post_event_message(ev, format('Coming up: %s, %s.', ev.title, private.event_when(ev)));
      update public.events set sent_reminder_at = now() where id = ev.id;
      n := n + 1;
    end if;
    if ev.remind_day_of and ev.sent_day_of_at is null
       and now() >= private.event_day_of_at(ev) and now() < ev.starts_at then
      perform private.post_event_message(ev, format('Today: %s, %s.', ev.title, private.event_when(ev)));
      update public.events set sent_day_of_at = now() where id = ev.id;
      n := n + 1;
    end if;
    if ev.location_release_minutes is not null and ev.sent_location_at is null
       and now() >= ev.starts_at - make_interval(mins => ev.location_release_minutes) then
      if exists (select 1 from public.event_locations l where l.event_id = ev.id) then
        perform private.post_event_message(ev, format('The location for %s is out. Open the event to see it.', ev.title));
      end if;
      update public.events set sent_location_at = now() where id = ev.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function private.run_event_jobs() from public;

create extension if not exists pg_cron;
select cron.schedule('sunday-line-event-posts', '*/5 * * * *', 'select private.run_event_jobs()');

-- ---------------------------------------------------------------------------
-- Fix: someone outside a group got a NULL role here, and NULL slipped past the
-- check. Treat "no role" as "not allowed".
create or replace function public.remove_member(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  mine public.group_role := private.group_role(p_group);
  theirs public.group_role;
begin
  select role into theirs from public.group_members where group_id = p_group and user_id = p_user;
  if theirs is null then
    raise exception 'Not a member.' using errcode = 'P0002';
  end if;
  if mine is null or theirs = 'organizer' or p_user = auth.uid() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not coalesce(mine = 'organizer' or (theirs = 'member' and private.has_perm(p_group, 'remove')), false) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
end;
$$;
