-- Road reviews: "how far would you drive for it" instead of 1-5 fun stars,
-- a "best around here" mark, and flags (gravel, private, closed, police).
-- Flags put a road in a review queue for the site admin; the admin's own flag
-- counts at once. Plus heads-ups: short-lived notes on the map (police, debris,
-- a crash) that expire by themselves. Plan 11.37-11.39.

-- ---------------------------------------------------------------------------
-- Reviews. No live ratings existed when this ran, so "fun" goes away cleanly.
drop view public.road_community;

alter table public.road_ratings drop constraint rating_says_something;
alter table public.road_ratings drop column fun;
-- 1 skip it, 2 fun if you're nearby, 3 worth a detour, 4 worth a road trip.
alter table public.road_ratings add column worth smallint check (worth between 1 and 4);
alter table public.road_ratings add column local_best boolean not null default false;
alter table public.road_ratings add column flags text[] not null default '{}'
  check (flags <@ array['gravel', 'private', 'closed', 'police']::text[] and cardinality(flags) <= 4);
alter table public.road_ratings add constraint rating_says_something check (
  worth is not null or local_best or pavement is not null or traffic is not null or drove_it
  or cardinality(flags) > 0 or nullif(btrim(note), '') is not null
);

revoke insert, update on public.road_ratings from authenticated;
grant insert (road_id, user_id, worth, local_best, pavement, traffic, vehicle, drove_it, flags, note) on public.road_ratings to authenticated;
grant update (worth, local_best, pavement, traffic, vehicle, drove_it, flags, note) on public.road_ratings to authenticated;

create view public.road_community
with (security_invoker = true) as
with r as (
  select
    road_id,
    count(*) as ratings,
    count(worth) as worth_count,
    count(*) filter (where worth = 1) as worth_skip,
    count(*) filter (where worth = 2) as worth_nearby,
    count(*) filter (where worth = 3) as worth_detour,
    count(*) filter (where worth = 4) as worth_trip,
    count(*) filter (where local_best) as local_best,
    count(*) filter (where drove_it) as drove_count,
    count(*) filter (where pavement = 'smooth') as pavement_smooth,
    count(*) filter (where pavement = 'patchy') as pavement_patchy,
    count(*) filter (where pavement = 'rough') as pavement_rough,
    count(*) filter (where pavement = 'loose_gravel') as pavement_loose_gravel,
    count(*) filter (where traffic = 'empty') as traffic_empty,
    count(*) filter (where traffic = 'light') as traffic_light,
    count(*) filter (where traffic = 'busy') as traffic_busy,
    count(*) filter (where vehicle = 'car') as by_car,
    count(*) filter (where vehicle = 'motorcycle') as by_motorcycle,
    count(*) filter (where 'gravel' = any (flags)) as flag_gravel,
    count(*) filter (where 'private' = any (flags)) as flag_private,
    count(*) filter (where 'closed' = any (flags)) as flag_closed,
    count(*) filter (where 'police' = any (flags)) as flag_police
  from public.road_ratings
  group by road_id
),
s as (
  select road_id, posted_limit, count(*) as reports,
         row_number() over (partition by road_id order by count(*) desc, posted_limit) as rank
  from public.speed_reports
  group by road_id, posted_limit
)
select
  coalesce(r.road_id, s.road_id) as road_id,
  coalesce(r.ratings, 0) as ratings,
  coalesce(r.worth_count, 0) as worth_count,
  coalesce(r.worth_skip, 0) as worth_skip,
  coalesce(r.worth_nearby, 0) as worth_nearby,
  coalesce(r.worth_detour, 0) as worth_detour,
  coalesce(r.worth_trip, 0) as worth_trip,
  coalesce(r.local_best, 0) as local_best,
  coalesce(r.drove_count, 0) as drove_count,
  coalesce(r.pavement_smooth, 0) as pavement_smooth,
  coalesce(r.pavement_patchy, 0) as pavement_patchy,
  coalesce(r.pavement_rough, 0) as pavement_rough,
  coalesce(r.pavement_loose_gravel, 0) as pavement_loose_gravel,
  coalesce(r.traffic_empty, 0) as traffic_empty,
  coalesce(r.traffic_light, 0) as traffic_light,
  coalesce(r.traffic_busy, 0) as traffic_busy,
  coalesce(r.by_car, 0) as by_car,
  coalesce(r.by_motorcycle, 0) as by_motorcycle,
  coalesce(r.flag_gravel, 0) as flag_gravel,
  coalesce(r.flag_private, 0) as flag_private,
  coalesce(r.flag_closed, 0) as flag_closed,
  coalesce(r.flag_police, 0) as flag_police,
  case when s.reports >= 2 then s.posted_limit end as reported_limit,
  coalesce(s.reports, 0) as reported_limit_count
from r
full join (select * from s where rank = 1) s on s.road_id = r.road_id;

grant select on public.road_community to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Road checks: what members' flags say about a road, once reviewed.
-- kind: gravel, private, closed, rough (from Pavement: rough).
-- status: pending (3 members flagged it, waiting for the admin), accepted (the
-- app applies it), dismissed (the admin looked and it's fine; 3 newer flags
-- bring it back).
create table public.road_checks (
  road_id text not null check (road_id ~ '^[a-f0-9]{12}$'),
  kind text not null check (kind in ('gravel', 'private', 'closed', 'rough')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  flagged_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (road_id, kind)
);

alter table public.road_checks enable row level security;
create policy "Accepted checks are public; the admin sees all" on public.road_checks
  for select to anon, authenticated using (status = 'accepted' or (select private.is_site_admin()));
grant select on public.road_checks to anon, authenticated;

-- Members who flagged a kind on a road (reviews flagged after `since`).
create or replace function private.flag_count(p_road text, p_kind text, p_since timestamptz)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.road_ratings r
  where r.road_id = p_road and r.updated_at > coalesce(p_since, '-infinity'::timestamptz)
    and case when p_kind = 'rough' then r.pavement = 'rough' else p_kind = any (r.flags) end;
$$;
revoke all on function private.flag_count(text, text, timestamptz) from public;

-- After a review is saved: the admin's flags count at once; 3 members' flags
-- queue the road for review.
create or replace function private.check_road_flags()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  k text;
  kinds text[] := array(select unnest(new.flags) except select 'police');
  existing public.road_checks;
  is_admin boolean := exists (select 1 from private.site_admins where user_id = new.user_id);
begin
  if new.pavement = 'rough' then kinds := kinds || 'rough'::text; end if;
  foreach k in array kinds loop
    select * into existing from public.road_checks where road_id = new.road_id and kind = k;
    if is_admin then
      insert into public.road_checks (road_id, kind, status, flagged_at, decided_at)
      values (new.road_id, k, 'accepted', now(), now())
      on conflict (road_id, kind) do update set status = 'accepted', decided_at = now();
    elsif existing is null then
      if private.flag_count(new.road_id, k, null) >= 3 then
        insert into public.road_checks (road_id, kind) values (new.road_id, k);
      end if;
    elsif existing.status = 'dismissed' and private.flag_count(new.road_id, k, existing.decided_at) >= 3 then
      update public.road_checks set status = 'pending', flagged_at = now(), decided_at = null
      where road_id = new.road_id and kind = k;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.check_road_flags() from public;

create trigger road_ratings_check_flags after insert or update of flags, pavement on public.road_ratings
  for each row execute function private.check_road_flags();

-- The admin accepts or dismisses a check (or undoes an accepted one).
create or replace function public.review_road_check(p_road text, p_kind text, p_accept boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_site_admin() then
    raise exception 'only the site admin reviews road checks' using errcode = '42501';
  end if;
  insert into public.road_checks (road_id, kind, status, decided_at)
  values (p_road, p_kind, case when p_accept then 'accepted' else 'dismissed' end, now())
  on conflict (road_id, kind) do update
    set status = case when p_accept then 'accepted' else 'dismissed' end, decided_at = now();
end;
$$;
revoke all on function public.review_road_check(text, text, boolean) from public;
grant execute on function public.review_road_check(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Heads-ups: short-lived notes about something on a road right now. Shown
-- without who posted them (where someone was, and when, stays theirs).
create table public.heads_ups (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('police', 'crash', 'stalled', 'debris', 'spill', 'animal', 'work', 'flooding')),
  lng double precision not null check (lng between -180 and -60),
  lat double precision not null check (lat between 15 and 72),
  note text check (char_length(note) <= 120),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index heads_ups_live on public.heads_ups (expires_at);
create index heads_ups_by on public.heads_ups (created_by, created_at);
alter table public.heads_ups enable row level security;
-- No direct access: reading and writing go through the functions below.

create table public.heads_up_votes (
  heads_up_id uuid not null references public.heads_ups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  still_there boolean not null,
  voted_at timestamptz not null default now(),
  primary key (heads_up_id, user_id)
);
alter table public.heads_up_votes enable row level security;

-- How long each kind lasts before it needs a "still there".
create or replace function private.heads_up_life(p_kind text)
returns interval
language sql immutable set search_path = ''
as $$
  select case p_kind
    when 'police' then interval '1 hour'
    when 'animal' then interval '1 hour'
    when 'crash' then interval '2 hours'
    when 'stalled' then interval '2 hours'
    when 'debris' then interval '3 hours'
    when 'spill' then interval '4 hours'
    when 'flooding' then interval '12 hours'
    when 'work' then interval '12 hours'
  end;
$$;

create or replace function public.add_heads_up(p_kind text, p_lng double precision, p_lat double precision, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'sign in and set up a profile first' using errcode = '42501';
  end if;
  if private.heads_up_life(p_kind) is null then
    raise exception 'unknown kind of heads-up' using errcode = '23514';
  end if;
  if (select count(*) from public.heads_ups where created_by = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'that''s the limit for today' using errcode = '54000';
  end if;
  insert into public.heads_ups (kind, lng, lat, note, created_by, expires_at)
  values (p_kind, p_lng, p_lat, nullif(btrim(p_note), ''), uid, now() + private.heads_up_life(p_kind))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.add_heads_up(text, double precision, double precision, text) from public;
grant execute on function public.add_heads_up(text, double precision, double precision, text) to authenticated;

-- Live heads-ups in a box, newest first, with "mine" for the poster's own.
create or replace function public.live_heads_ups(w double precision, s double precision, e double precision, n double precision)
returns table (id uuid, kind text, lng double precision, lat double precision, note text,
               created_at timestamptz, expires_at timestamptz, still_count integer, mine boolean)
language sql stable security definer set search_path = ''
as $$
  select h.id, h.kind, h.lng, h.lat, h.note, h.created_at, h.expires_at,
         (select count(*)::int from public.heads_up_votes v where v.heads_up_id = h.id and v.still_there),
         coalesce(h.created_by = auth.uid(), false)
  from public.heads_ups h
  where h.expires_at > now() and h.lng between w and e and h.lat between s and n
  order by h.created_at desc
  limit 300;
$$;
revoke all on function public.live_heads_ups(double precision, double precision, double precision, double precision) from public;
grant execute on function public.live_heads_ups(double precision, double precision, double precision, double precision) to anon, authenticated;

-- "Still there" pushes the end time out by the kind's life; two "gone" votes
-- (or the poster's own) end it now.
create or replace function public.vote_heads_up(p_id uuid, p_still_there boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  h public.heads_ups;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'sign in and set up a profile first' using errcode = '42501';
  end if;
  select * into h from public.heads_ups where id = p_id and expires_at > now();
  if h is null then return; end if;
  if not p_still_there and h.created_by = uid then
    update public.heads_ups set expires_at = now() where id = p_id;
    return;
  end if;
  insert into public.heads_up_votes (heads_up_id, user_id, still_there) values (p_id, uid, p_still_there)
  on conflict (heads_up_id, user_id) do update set still_there = excluded.still_there, voted_at = now();
  if p_still_there then
    update public.heads_ups set expires_at = greatest(expires_at, now() + private.heads_up_life(kind)) where id = p_id;
  elsif (select count(*) from public.heads_up_votes where heads_up_id = p_id and not still_there) >= 2 then
    update public.heads_ups set expires_at = now() where id = p_id;
  end if;
end;
$$;
revoke all on function public.vote_heads_up(uuid, boolean) from public;
grant execute on function public.vote_heads_up(uuid, boolean) to authenticated;

-- Expired heads-ups are deleted after a day.
create or replace function private.sweep_heads_ups()
returns void
language sql security definer set search_path = ''
as $$ delete from public.heads_ups where expires_at < now() - interval '1 day'; $$;
revoke all on function private.sweep_heads_ups() from public;
select cron.schedule('sunday-line-heads-up-sweep', '17 * * * *', 'select private.sweep_heads_ups()');
