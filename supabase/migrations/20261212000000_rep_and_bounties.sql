-- Rep for confirmed road checks, and bounties (plan 11.78).
--
-- Rep is paid for being right, never for agreeing: flags still need three
-- members to reach the site admin's queue, and nobody earns anything until the
-- admin accepts the check. A dismissed check costs the people who flagged it.
-- So extra accounts can't confirm their own flags, and wrong answers lose rep.
--
-- * Paid when a check is accepted, to everyone whose review flags it then
--   (the admin's own flags excepted). Points come with the decision: a bounty
--   (a road that needs a check) is worth a fifth of its Overall score, other
--   checks 5. Flags made after a check is accepted earn nothing.
-- * Accounts earn only for flags made once they're a week old; at most 50
--   points a day. Their flags still count toward the queue.
-- * A dismissed check costs 3 points per flagger; undoing an accepted one
--   takes back what it paid and charges the same 3 (only to those it paid).
--   Poor pavement is a matter of opinion, so it costs nothing.
-- * One row per person per road and kind: a later decision replaces the
--   earlier one, so nothing is paid or charged twice.
-- * Trusted checker: 5 or more confirmed checks and at least 80% of decided
--   flags right. Shown on profiles and reviews.
-- * New flag "paved": for roads whose surface needs a check. Accepted, it
--   moves the road onto Driver's roads.

-- ---- "Paved, I checked" -------------------------------------------------------
alter table public.road_ratings drop constraint road_ratings_flags_check;
alter table public.road_ratings add constraint road_ratings_flags_check
  check (flags <@ array['gravel', 'private', 'closed', 'police', 'paved']::text[] and cardinality(flags) <= 5);

alter table public.road_checks drop constraint road_checks_kind_check;
alter table public.road_checks add constraint road_checks_kind_check
  check (kind in ('gravel', 'private', 'closed', 'rough', 'paved'));
-- Rep paid for this check when accepted (the admin's choice, 1 to 40).
alter table public.road_checks add column points smallint check (points between 1 and 40);

create or replace view public.road_community
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
    count(*) filter (where 'police' = any (flags)) as flag_police,
    count(*) filter (where 'paved' = any (flags)) as flag_paved
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
  coalesce(s.reports, 0) as reported_limit_count,
  coalesce(r.flag_paved, 0) as flag_paved
from r
full join (select * from s where rank = 1) s on s.road_id = r.road_id;

-- ---- The ledger ---------------------------------------------------------------
create table public.rep_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  road_id text not null check (road_id ~ '^[a-f0-9]{12}$'),
  kind text not null,
  outcome text not null check (outcome in ('confirmed', 'dismissed')),
  points smallint not null,
  decided_at timestamptz not null default now(),
  primary key (user_id, road_id, kind)
);
create index rep_events_day on public.rep_events (user_id, decided_at);
alter table public.rep_events enable row level security;
-- Your own rows; everyone else sees totals through rep_summary().
create policy "See your own rep" on public.rep_events for select to authenticated using (user_id = (select auth.uid()));
grant select on public.rep_events to authenticated;

-- People whose review flags this kind on this road right now (not the admin).
create or replace function private.check_flaggers(p_road text, p_kind text)
returns table (user_id uuid, flagged_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.user_id, r.updated_at from public.road_ratings r
  where r.road_id = p_road
    and case when p_kind = 'rough' then r.pavement = 'rough' else p_kind = any (r.flags) end
    and not exists (select 1 from private.site_admins a where a.user_id = r.user_id);
$$;
revoke all on function private.check_flaggers(text, text) from public;

-- Positive points a person has been paid today (Central time).
create or replace function private.rep_today(p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(points), 0)::int from public.rep_events
  where user_id = p_user and points > 0
    and decided_at >= (date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago');
$$;
revoke all on function private.rep_today(uuid) from public;

-- Road checks: pay or charge the flaggers, tell them, and tell the admin when
-- one is waiting. (Replaces the notify-only version from 11.40.)
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
    for f in select * from private.check_flaggers(new.road_id, new.kind) loop
      pts := case
        -- A week old when they flagged it.
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
  elsif new.status = 'dismissed' and tg_op = 'UPDATE' and old.status <> 'dismissed' then
    -- Undoing an accepted check charges only the people it paid; flags made
    -- after it was settled were never paid, so they aren't charged either.
    for f in select c.* from private.check_flaggers(new.road_id, new.kind) c
             where old.status <> 'accepted' or exists (
               select 1 from public.rep_events e where e.user_id = c.user_id and e.road_id = new.road_id
                 and e.kind = new.kind and e.outcome = 'confirmed') loop
      insert into public.rep_events (user_id, road_id, kind, outcome, points)
      values (f.user_id, new.road_id, new.kind, 'dismissed', case when new.kind = 'rough' then 0 else -3 end)
      on conflict (user_id, road_id, kind) do update
        set outcome = 'dismissed', points = excluded.points, decided_at = now();
    end loop;
  elsif new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    for u in select user_id from private.site_admins loop
      perform private.notify(u, 'admin_road_check', null, p_road => new.road_id, p_detail => jsonb_build_object('kind', new.kind));
    end loop;
  end if;
  return null;
end;
$$;

-- The admin accepts (with the rep it pays) or dismisses a check, or undoes one.
drop function public.review_road_check(text, text, boolean);
create function public.review_road_check(p_road text, p_kind text, p_accept boolean, p_points integer default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  pts smallint := case when p_accept then least(40, greatest(1, coalesce(p_points, 5))) end;
begin
  if not private.is_site_admin() then
    raise exception 'only the site admin reviews road checks' using errcode = '42501';
  end if;
  insert into public.road_checks (road_id, kind, status, decided_at, points)
  values (p_road, p_kind, case when p_accept then 'accepted' else 'dismissed' end, now(), pts)
  on conflict (road_id, kind) do update
    set status = case when p_accept then 'accepted' else 'dismissed' end, decided_at = now(),
        points = coalesce(pts, public.road_checks.points);
end;
$$;
revoke all on function public.review_road_check(text, text, boolean, integer) from public;
grant execute on function public.review_road_check(text, text, boolean, integer) to authenticated;

-- ---- What anyone can see ------------------------------------------------------
-- A member's rep: points (never shown below 0), confirmed and dismissed checks
-- (poor pavement, being opinion, isn't counted against anyone), trusted.
create or replace function public.rep_summary(p_user uuid)
returns table (points integer, confirmed integer, dismissed integer, trusted boolean)
language sql stable security definer set search_path = ''
as $$
  with e as (
    select
      greatest(0, coalesce(sum(points), 0))::int as points,
      (count(*) filter (where outcome = 'confirmed'))::int as confirmed,
      (count(*) filter (where outcome = 'dismissed' and kind <> 'rough'))::int as dismissed
    from public.rep_events where user_id = p_user
  )
  select points, confirmed, dismissed, confirmed >= 5 and confirmed * 100 >= 80 * (confirmed + dismissed) from e;
$$;
revoke all on function public.rep_summary(uuid) from public;
grant execute on function public.rep_summary(uuid) to anon, authenticated;

-- Which of these people are trusted checkers (for badges next to reviews).
create or replace function public.trusted_checkers(p_ids uuid[])
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select u from unnest(p_ids[1:100]) as u
  where (select trusted from public.rep_summary(u));
$$;
revoke all on function public.trusted_checkers(uuid[]) from public;
grant execute on function public.trusted_checkers(uuid[]) to anon, authenticated;
