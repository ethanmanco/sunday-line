-- Site stats for the admin (plan 11.66).
--
-- Traffic: an anonymous page-view counter. Each page the app shows adds one to
-- a count for (day, kind of page), and road pages also add one to (day, road).
-- Nothing about the visitor is kept: no user id, no IP address, no device, no
-- location, no cookie, no referrer. A "visit" is counted once per browser
-- session the same way (signed in or not, nothing more). Browsers that send
-- Global Privacy Control or Do Not Track count nothing (the app checks).
--
-- Stats: one function, admin_stats(), that only the site admin can call. It
-- returns counts and daily totals built from what the app already stores; it
-- never returns message text, locations, private spots or group members. The
-- top contributors list counts public things only (reviews, heads-ups, spots
-- on the public map).

-- ---- Page view counts (private schema: not reachable through the API) ----
create table private.page_views (
  day date not null,
  page text not null,
  views integer not null default 0,
  primary key (day, page)
);

create table private.road_views (
  day date not null,
  road_id text not null check (road_id ~ '^[a-f0-9]{12}$'),
  views integer not null default 0,
  primary key (day, road_id)
);

-- Kinds of page. Ids, usernames and invite tokens in the address are never kept.
create or replace function public.count_view(p_page text, p_road text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'UTC')::date;
begin
  if p_page is null or p_page not in (
    'visit_guest', 'visit_member',
    'map', 'road', 'group', 'groups', 'event', 'profile', 'people', 'messages',
    'notifications', 'spots', 'about', 'me', 'join', 'signin', 'other'
  ) then
    return;
  end if;
  insert into private.page_views (day, page, views) values (today, p_page, 1)
  on conflict (day, page) do update set views = private.page_views.views + 1;
  if p_page = 'road' and p_road ~ '^[a-f0-9]{12}$' then
    insert into private.road_views (day, road_id, views) values (today, p_road, 1)
    on conflict (day, road_id) do update set views = private.road_views.views + 1;
  end if;
end;
$$;
revoke all on function public.count_view(text, text) from public;
grant execute on function public.count_view(text, text) to anon, authenticated;

-- Old counts go: road views after 120 days, page views after 400.
create or replace function private.sweep_view_counts()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.road_views where day < (now() at time zone 'UTC')::date - 120;
  delete from private.page_views where day < (now() at time zone 'UTC')::date - 400;
$$;
revoke all on function private.sweep_view_counts() from public;
select cron.schedule('sunday-line-view-count-sweep', '23 5 * * *', 'select private.sweep_view_counts()');

-- ---- The admin's stats ----
create or replace function public.admin_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(7, least(coalesce(p_days, 30), 365));
  v_today date := (now() at time zone 'UTC')::date;
  v_since date := v_today - (v_days - 1);
  v_since_ts timestamptz := (v_since::timestamp at time zone 'UTC');
  v_week_ts timestamptz := ((v_today - 6)::timestamp at time zone 'UTC');
  result jsonb;
begin
  if not private.is_site_admin() then
    raise exception 'only the site admin sees site stats' using errcode = '42501';
  end if;

  with
  activity as (
    -- Who did something, and when. Only used for counts below.
    select user_id, updated_at as at from public.road_ratings
    union all select user_id, reported_at from public.speed_reports
    union all select sender_id, created_at from public.messages where sender_id is not null
    union all select user_id, last_read_at from public.conversation_members where last_read_at is not null
    union all select created_by, created_at from public.heads_ups where created_by is not null
    union all select user_id, voted_at from public.heads_up_votes
    union all select owner_id, updated_at from public.spots
    union all select user_id, updated_at from public.event_rsvps
    union all select created_by, created_at from public.events where created_by is not null
    union all select follower_id, created_at from public.follows
    union all select user_id, joined_at from public.group_members
    union all select id, updated_at from public.profiles
    union all select id, last_sign_in_at from auth.users where last_sign_in_at is not null
  ),
  days as (
    select d::date as day from generate_series(v_since, v_today, interval '1 day') d
  ),
  series as (
    select jsonb_agg(jsonb_build_object(
      'day', days.day,
      'signups', (select count(*) from public.profiles p where (p.created_at at time zone 'UTC')::date = days.day),
      'active', (select count(distinct a.user_id) from activity a where (a.at at time zone 'UTC')::date = days.day),
      'reviews', (select count(*) from public.road_ratings r where (r.created_at at time zone 'UTC')::date = days.day),
      'heads_ups', (select count(*) from public.heads_ups h where (h.created_at at time zone 'UTC')::date = days.day),
      'spots', (select count(*) from public.spots s where (s.created_at at time zone 'UTC')::date = days.day),
      'messages', (select count(*) from public.messages m where (m.created_at at time zone 'UTC')::date = days.day),
      'views', (select coalesce(sum(v.views), 0) from private.page_views v
                where v.day = days.day and v.page not in ('visit_guest', 'visit_member')),
      'visits', (select coalesce(sum(v.views), 0) from private.page_views v
                 where v.day = days.day and v.page in ('visit_guest', 'visit_member'))
    ) order by days.day) as rows
    from days
  ),
  contributors as (
    select p.username, p.display_name,
      (select count(*) from public.road_ratings r where r.user_id = p.id) as reviews,
      (select count(*) from public.heads_ups h where h.created_by = p.id) as heads_ups,
      (select count(*) from public.spots s where s.owner_id = p.id and s.public_status = 'approved') as public_spots
    from public.profiles p
  )
  select jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'today', v_today,
    'people', jsonb_build_object(
      'accounts', (select count(*) from auth.users),
      'profiles', (select count(*) from public.profiles),
      'private_profiles', (select count(*) from public.profiles where is_private),
      'new_7d', (select count(*) from public.profiles where created_at >= v_week_ts),
      'new_period', (select count(*) from public.profiles where created_at >= v_since_ts),
      'active_today', (select count(distinct user_id) from activity where at >= (v_today::timestamp at time zone 'UTC')),
      'active_7d', (select count(distinct user_id) from activity where at >= v_week_ts),
      'active_period', (select count(distinct user_id) from activity where at >= v_since_ts),
      'follows', (select count(*) from public.follows where status = 'accepted'),
      'vehicles', (select count(*) from public.vehicles),
      'photos', (select count(*) from public.profile_media) + (select count(*) from public.vehicle_photos),
      'push_people', (select count(distinct user_id) from public.push_subscriptions),
      'push_devices', (select count(*) from public.push_subscriptions)
    ),
    'traffic', jsonb_build_object(
      'views_today', (select coalesce(sum(views), 0) from private.page_views
                      where day = v_today and page not in ('visit_guest', 'visit_member')),
      'views_7d', (select coalesce(sum(views), 0) from private.page_views
                   where day >= v_today - 6 and page not in ('visit_guest', 'visit_member')),
      'views_period', (select coalesce(sum(views), 0) from private.page_views
                       where day >= v_since and page not in ('visit_guest', 'visit_member')),
      'visits_today', (select coalesce(sum(views), 0) from private.page_views
                       where day = v_today and page in ('visit_guest', 'visit_member')),
      'visits_7d', (select coalesce(sum(views), 0) from private.page_views
                    where day >= v_today - 6 and page in ('visit_guest', 'visit_member')),
      'member_visits_7d', (select coalesce(sum(views), 0) from private.page_views
                           where day >= v_today - 6 and page = 'visit_member'),
      'counting_since', (select min(day) from private.page_views),
      'pages', coalesce((
        select jsonb_agg(jsonb_build_object('page', page, 'views', views) order by views desc, page)
        from (select page, sum(views) as views from private.page_views
              where day >= v_since and page not in ('visit_guest', 'visit_member') group by page) x
      ), '[]'::jsonb)
    ),
    'roads', jsonb_build_object(
      'reviews', (select count(*) from public.road_ratings),
      'reviews_7d', (select count(*) from public.road_ratings where created_at >= v_week_ts),
      'roads_reviewed', (select count(distinct road_id) from public.road_ratings),
      'speed_reports', (select count(*) from public.speed_reports),
      'checks_waiting', (select count(*) from public.road_checks where status = 'pending'),
      'checks_accepted', (select count(*) from public.road_checks where status = 'accepted'),
      'most_viewed', coalesce((
        select jsonb_agg(jsonb_build_object('road_id', road_id, 'views', views) order by views desc, road_id)
        from (select road_id, sum(views) as views from private.road_views
              where day >= v_since group by road_id order by 2 desc, 1 limit 10) x
      ), '[]'::jsonb),
      'most_reviewed', coalesce((
        select jsonb_agg(jsonb_build_object('road_id', road_id, 'reviews', reviews) order by reviews desc, road_id)
        from (select road_id, count(*) as reviews from public.road_ratings
              group by road_id order by 2 desc, 1 limit 10) x
      ), '[]'::jsonb)
    ),
    'spots', jsonb_build_object(
      'spots', (select count(*) from public.spots),
      'public', (select count(*) from public.spots where public_status = 'approved'),
      'waiting', (select count(*) from public.spots where public_status = 'pending'),
      'scored_roads', (select count(*) from public.road_scores where status = 'done'),
      'heads_ups', (select count(*) from public.heads_ups),
      'heads_ups_live', (select count(*) from public.heads_ups where expires_at > now()),
      'heads_ups_7d', (select count(*) from public.heads_ups where created_at >= v_week_ts)
    ),
    'groups', jsonb_build_object(
      'groups', (select count(*) from public.groups),
      'public_groups', (select count(*) from public.groups where visibility = 'public'),
      'memberships', (select count(*) from public.group_members),
      'events_upcoming', (select count(*) from public.events where status = 'scheduled' and starts_at > now()),
      'events', (select count(*) from public.events),
      'rsvps', (select count(*) from public.event_rsvps),
      'messages_7d', (select count(*) from public.messages where created_at >= v_week_ts),
      'messages_period', (select count(*) from public.messages where created_at >= v_since_ts),
      'chats_active_7d', (select count(distinct conversation_id) from public.messages where created_at >= v_week_ts)
    ),
    'notifications', jsonb_build_object(
      'sent_7d', (select count(*) from public.notifications where created_at >= v_week_ts),
      'pushed_7d', (select count(*) from public.notifications where pushed_at >= v_week_ts)
    ),
    'series', (select coalesce(rows, '[]'::jsonb) from series),
    'contributors', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.reviews + c.heads_ups + c.public_spots desc, c.username)
      from (select * from contributors where reviews + heads_ups + public_spots > 0
            order by reviews + heads_ups + public_spots desc, username limit 10) c
    ), '[]'::jsonb),
    'makes', coalesce((
      select jsonb_agg(jsonb_build_object('make', make, 'count', n) order by n desc, make)
      from (select initcap(lower(trim(make))) as make, count(*) as n from public.vehicles
            where trim(coalesce(make, '')) <> '' group by 1 order by 2 desc, 1 limit 8) x
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;
revoke all on function public.admin_stats(integer) from public;
grant execute on function public.admin_stats(integer) to authenticated;
