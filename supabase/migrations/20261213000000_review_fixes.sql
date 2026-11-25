-- Fixes from the project review (plan 11.81).
--
-- 1. Push details. The push sender (11.76, 11.77) read messages, events and
--    notifications directly, but the service role has no read access to those
--    tables, so pushes went out without the message text, the event's time
--    zone, or the count on the app icon. claim_push now returns them.
-- 2. Meet locations. A spot in a private group couldn't be added to a public
--    group, but it could still be picked as a public group's meet location,
--    which copies its place to everyone who joins. Now it can't.
-- 3. Rep. Flags are timed one by one (flag_times), set only when that flag is
--    added, so re-saving a review no longer makes a new account's flag look a
--    week old, or brings a dismissed check back. The people flagging a check
--    when it reaches the queue are remembered, so taking a flag off before the
--    admin decides doesn't dodge a dismissal. Undoing an accepted check takes
--    back what it paid from everyone it paid, flag or no flag.

-- ---- 1. Push details ----------------------------------------------------------
create or replace function public.claim_push(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n public.notifications;
begin
  update public.notifications set pushed_at = now()
  where id = p_id and pushed_at is null and read_at is null and created_at > now() - interval '15 minutes'
  returning * into n;
  if n.id is null then return null; end if;
  return to_jsonb(n) || jsonb_build_object(
    'actor', (select jsonb_build_object('username', username, 'display_name', display_name) from public.profiles where id = n.actor_id),
    'group', (select jsonb_build_object('short_id', short_id) from public.groups where id = n.group_id),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
                         from public.push_subscriptions where user_id = n.user_id), '[]'::jsonb),
    -- The start of the latest message by whoever it's from (messages, mentions).
    'said', case when n.kind in ('message', 'mention') and n.conversation_id is not null and n.actor_id is not null then
      (select jsonb_build_object('body', m.body, 'photo', m.media_path is not null) from public.messages m
       where m.conversation_id = n.conversation_id and m.sender_id = n.actor_id
       order by m.created_at desc limit 1) end,
    'timezone', (select e.timezone from public.events e where e.id = n.event_id),
    'unread', (select count(*) from public.notifications x where x.user_id = n.user_id and x.read_at is null)
  );
end;
$$;
revoke all on function public.claim_push(uuid) from public, anon, authenticated;
grant execute on function public.claim_push(uuid) to service_role;

-- ---- 2. Meet locations --------------------------------------------------------
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
  if s.id is null or not coalesce(
    s.public_status = 'approved'
    or exists (select 1 from public.spot_groups sg where sg.spot_id = s.id and sg.group_id = ev.group_id and sg.status = 'accepted')
    or s.owner_id = auth.uid(),
    false
  ) then
    raise exception 'Pick a public spot, one of this group''s spots, or one of yours.' using errcode = '42501';
  end if;
  -- Same rule as adding a spot to a group: a private group's spot stays out of public groups.
  if (select g.visibility from public.groups g where g.id = ev.group_id) = 'public'
     and s.public_status is distinct from 'approved' and private.spot_in_private_group(s.id) then
    raise exception 'A spot in a private group can''t be a public group''s meet spot.' using errcode = '23514';
  end if;
  insert into public.event_locations (event_id, spot_id, name, kind, category, lat, lng, line, notes)
  values (p_event, s.id, s.name, s.kind, s.category, s.lat, s.lng, s.line, s.description)
  on conflict (event_id) do update set
    spot_id = excluded.spot_id, name = excluded.name, kind = excluded.kind, category = excluded.category,
    lat = excluded.lat, lng = excluded.lng, line = excluded.line, notes = excluded.notes;
end;
$$;

-- ---- 3. Rep -------------------------------------------------------------------
-- When each flag on a review was added: {"gravel": "2026-11-20T...", "rough": ...}.
-- "rough" stands for Pavement: rough. Set by the database only.
alter table public.road_ratings add column flag_times jsonb not null default '{}'::jsonb;
-- Existing flags date from the review's last save (without touching that date).
alter table public.road_ratings disable trigger road_ratings_touch;
update public.road_ratings r set flag_times = coalesce((
  select jsonb_object_agg(k, r.updated_at)
  from unnest(array(select unnest(r.flags) except select 'police')
              || case when r.pavement = 'rough' then array['rough'] else array[]::text[] end) k
), '{}'::jsonb);
alter table public.road_ratings enable trigger road_ratings_touch;

create or replace function private.time_flags()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kinds text[] := array(select unnest(new.flags) except select 'police');
begin
  if new.pavement = 'rough' then kinds := kinds || 'rough'::text; end if;
  new.flag_times := coalesce((
    select jsonb_object_agg(k, case when tg_op = 'UPDATE' and old.flag_times ? k then old.flag_times -> k else to_jsonb(now()) end)
    from unnest(kinds) k
  ), '{}'::jsonb);
  return new;
end;
$$;
revoke all on function private.time_flags() from public;
create trigger road_ratings_time_flags before insert or update on public.road_ratings
  for each row execute function private.time_flags();

-- Members who flagged a kind on a road (flags added after `since`).
create or replace function private.flag_count(p_road text, p_kind text, p_since timestamptz)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.road_ratings r
  where r.road_id = p_road and r.flag_times ? p_kind
    and (r.flag_times ->> p_kind)::timestamptz > coalesce(p_since, '-infinity'::timestamptz);
$$;

-- People whose review flags this kind on this road right now (not the admin), and when they flagged it.
create or replace function private.check_flaggers(p_road text, p_kind text)
returns table (user_id uuid, flagged_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.user_id, (r.flag_times ->> p_kind)::timestamptz from public.road_ratings r
  where r.road_id = p_road and r.flag_times ? p_kind
    and not exists (select 1 from private.site_admins a where a.user_id = r.user_id);
$$;

-- Who was flagging a check when it went to the admin's queue.
create table private.road_check_flaggers (
  road_id text not null,
  kind text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (road_id, kind, user_id)
);

create or replace function private.road_checks_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  f record;
  pts int;
  u uuid;
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') then
    -- Paid: everyone flagging it now, if their account was a week old when they flagged it.
    for f in select * from private.check_flaggers(new.road_id, new.kind) loop
      pts := case
        when (select p.created_at from public.profiles p where p.id = f.user_id) > f.flagged_at - interval '7 days' then 0
        else least(coalesce(new.points, 5), greatest(0, 50 - private.rep_today(f.user_id)))
      end;
      insert into public.rep_events (user_id, road_id, kind, outcome, points)
      values (f.user_id, new.road_id, new.kind, 'confirmed', pts)
      on conflict (user_id, road_id, kind) do update
        set outcome = 'confirmed', points = excluded.points, decided_at = now();
      perform private.notify(f.user_id, 'road_check_helped', null, p_road => new.road_id,
        p_detail => jsonb_build_object('kind', new.kind, 'points', pts));
    end loop;
    delete from private.road_check_flaggers where road_id = new.road_id and kind = new.kind;
  elsif new.status = 'dismissed' and tg_op = 'UPDATE' and old.status <> 'dismissed' then
    for u in
      -- Undoing an accepted check: everyone it paid.
      select e.user_id from public.rep_events e
      where old.status = 'accepted' and e.road_id = new.road_id and e.kind = new.kind and e.outcome = 'confirmed'
      union
      -- Dismissing a waiting one: everyone flagging it when it reached the queue, or now.
      select c.user_id from private.road_check_flaggers c
      where old.status <> 'accepted' and c.road_id = new.road_id and c.kind = new.kind
      union
      select c.user_id from private.check_flaggers(new.road_id, new.kind) c
      where old.status <> 'accepted'
    loop
      insert into public.rep_events (user_id, road_id, kind, outcome, points)
      values (u, new.road_id, new.kind, 'dismissed', case when new.kind = 'rough' then 0 else -3 end)
      on conflict (user_id, road_id, kind) do update
        set outcome = 'dismissed', points = excluded.points, decided_at = now();
    end loop;
    delete from private.road_check_flaggers where road_id = new.road_id and kind = new.kind;
  elsif new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    insert into private.road_check_flaggers (road_id, kind, user_id)
    select new.road_id, new.kind, c.user_id from private.check_flaggers(new.road_id, new.kind) c
    on conflict do nothing;
    for u in select user_id from private.site_admins loop
      perform private.notify(u, 'admin_road_check', null, p_road => new.road_id, p_detail => jsonb_build_object('kind', new.kind));
    end loop;
  end if;
  return null;
end;
$$;

-- Checks already waiting: remember who's flagging them now.
insert into private.road_check_flaggers (road_id, kind, user_id)
select c.road_id, c.kind, f.user_id from public.road_checks c, private.check_flaggers(c.road_id, c.kind) f
where c.status = 'pending'
on conflict do nothing;
