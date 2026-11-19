-- Accounts, road ratings, and speed limit reports.
--
-- Rules (see docs/plan.md sections 4 and 11):
-- * Row level security on every table. Nothing is reachable without an
--   explicit GRANT (the project does not auto-expose new tables).
-- * Roads live in a static file, so ratings reference the road's 12-character
--   ID instead of a foreign key.
-- * People own what they post: only the author can change or delete it.
-- * No moderation and no report button, per the project rules.
-- * Users' own locations are never stored.

-- Shared: keep updated_at current.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: one per signed-in person, created by them after first sign-in.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  vehicle_note text check (char_length(vehicle_note) <= 80),
  terms_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;

create policy "Profiles are public" on public.profiles
  for select to anon, authenticated using (true);
create policy "Create your own profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "Edit your own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Delete your own profile" on public.profiles
  for delete to authenticated using (id = (select auth.uid()));

-- Public columns only; terms_accepted_at stays private to its owner's session.
grant select (id, display_name, vehicle_note, created_at) on public.profiles to anon, authenticated;
grant select (terms_accepted_at, updated_at) on public.profiles to authenticated;
grant insert (id, display_name, vehicle_note) on public.profiles to authenticated;
grant update (display_name, vehicle_note) on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Road ratings: one per person per road; every part is optional but one.
create type public.pavement_condition as enum ('smooth', 'patchy', 'rough', 'loose_gravel');
create type public.traffic_level as enum ('empty', 'light', 'busy');
create type public.vehicle_kind as enum ('car', 'motorcycle');

create table public.road_ratings (
  road_id text not null check (road_id ~ '^[a-f0-9]{12}$'),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  fun smallint check (fun between 1 and 5),
  pavement public.pavement_condition,
  traffic public.traffic_level,
  vehicle public.vehicle_kind,
  drove_it boolean not null default false,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (road_id, user_id),
  constraint rating_says_something check (
    fun is not null or pavement is not null or traffic is not null or drove_it or nullif(btrim(note), '') is not null
  )
);

create index road_ratings_user on public.road_ratings (user_id);

create trigger road_ratings_touch before update on public.road_ratings
  for each row execute function public.touch_updated_at();

alter table public.road_ratings enable row level security;

create policy "Ratings are public" on public.road_ratings
  for select to anon, authenticated using (true);
create policy "Rate as yourself" on public.road_ratings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Change your own rating" on public.road_ratings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Delete your own rating" on public.road_ratings
  for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.road_ratings to anon, authenticated;
grant insert (road_id, user_id, fun, pavement, traffic, vehicle, drove_it, note) on public.road_ratings to authenticated;
grant update (fun, pavement, traffic, vehicle, drove_it, note) on public.road_ratings to authenticated;
grant delete on public.road_ratings to authenticated;

-- ---------------------------------------------------------------------------
-- Speed limit reports: the posted limit a person saw. Two matching reports
-- replace the estimate shown for the road.
create table public.speed_reports (
  road_id text not null check (road_id ~ '^[a-f0-9]{12}$'),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  posted_limit smallint not null check (posted_limit between 5 and 85 and posted_limit % 5 = 0),
  reported_at timestamptz not null default now(),
  primary key (road_id, user_id)
);

alter table public.speed_reports enable row level security;

create policy "Speed reports are public" on public.speed_reports
  for select to anon, authenticated using (true);
create policy "Report as yourself" on public.speed_reports
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Change your own report" on public.speed_reports
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Delete your own report" on public.speed_reports
  for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.speed_reports to anon, authenticated;
grant insert (road_id, user_id, posted_limit) on public.speed_reports to authenticated;
grant update (posted_limit, reported_at) on public.speed_reports to authenticated;
grant delete on public.speed_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Per-road summary for the road page. security_invoker keeps the callers'
-- own access rules in force.
create view public.road_community
with (security_invoker = true) as
with r as (
  select
    road_id,
    count(*) as ratings,
    round(avg(fun)::numeric, 1) as fun_avg,
    count(fun) as fun_count,
    count(*) filter (where drove_it) as drove_count,
    count(*) filter (where pavement = 'smooth') as pavement_smooth,
    count(*) filter (where pavement = 'patchy') as pavement_patchy,
    count(*) filter (where pavement = 'rough') as pavement_rough,
    count(*) filter (where pavement = 'loose_gravel') as pavement_loose_gravel,
    count(*) filter (where traffic = 'empty') as traffic_empty,
    count(*) filter (where traffic = 'light') as traffic_light,
    count(*) filter (where traffic = 'busy') as traffic_busy,
    count(*) filter (where vehicle = 'car') as by_car,
    count(*) filter (where vehicle = 'motorcycle') as by_motorcycle
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
  r.fun_avg,
  coalesce(r.fun_count, 0) as fun_count,
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
  case when s.reports >= 2 then s.posted_limit end as reported_limit,
  coalesce(s.reports, 0) as reported_limit_count
from r
full join (select * from s where rank = 1) s on s.road_id = r.road_id;

grant select on public.road_community to anon, authenticated;
