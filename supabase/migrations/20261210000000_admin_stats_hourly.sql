-- Site stats by the hour (plan 11.74).
--
-- The page-view counter also keeps a count per hour (Central time) and kind of
-- page, so the chart can group by hour. Still nothing about the visitor: no
-- account, address, device, location, cookie or referrer. Hourly counts are
-- deleted after 90 days. admin_stats takes p_group 'hour' for windows of up to
-- 14 days; the other counts (sign-ups, reviews, heads-ups, spots, messages,
-- active members) come from their own times, so their past hours show too.

create table private.page_views_hourly (
  hour timestamp not null, -- start of the hour, Central time
  page text not null,
  views integer not null default 0,
  primary key (hour, page)
);

create or replace function public.count_view(p_page text, p_road text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  v_hour timestamp := date_trunc('hour', now() at time zone 'America/Chicago');
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
  insert into private.page_views_hourly (hour, page, views) values (v_hour, p_page, 1)
  on conflict (hour, page) do update set views = private.page_views_hourly.views + 1;
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
  delete from private.road_views where day < (now() at time zone 'America/Chicago')::date - 120;
  delete from private.page_views where day < (now() at time zone 'America/Chicago')::date - 400;
  delete from private.page_views_hourly where hour < (now() at time zone 'America/Chicago') - interval '90 days';
$$;
revoke all on function private.sweep_view_counts() from public;
-- ---- The admin's stats ----
create or replace function public.admin_stats(
  p_days integer default 30,
  p_from date default null,
  p_to date default null,
  p_group text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_group text := case when p_group in ('hour', 'day', 'week', 'month') then p_group else 'day' end;
  v_series jsonb;
  v_previous jsonb;
  v_start date;
  v_from date;
  v_to date;
  v_len integer;
  v_prev_from date;
  v_from_ts timestamptz;
  v_end_ts timestamptz;
  v_prev_ts timestamptz;
  v_week_ts timestamptz := ((v_today - 6)::timestamp at time zone 'America/Chicago');
  result jsonb;
begin
  if not private.is_site_admin() then
    raise exception 'only the site admin sees site stats' using errcode = '42501';
  end if;

  -- The first day anything happened on the site.
  v_start := least(
    coalesce((select min(created_at at time zone 'America/Chicago')::date from public.profiles), v_today),
    coalesce((select min(day) from private.page_views), v_today)
  );

  if p_from is not null then
    v_from := p_from;
    v_to := least(coalesce(p_to, v_today), v_today);
  elsif coalesce(p_days, 30) <= 0 then
    v_from := v_start;
    v_to := v_today;
  else
    v_to := v_today;
    v_from := v_today - (least(p_days, 1096) - 1);
  end if;
  if v_from > v_to then
    v_from := v_to;
  end if;
  -- At most three years at a time.
  v_from := greatest(v_from, v_to - 1095);
  -- By the hour: at most 14 days (336 bars).
  if v_group = 'hour' then
    v_from := greatest(v_from, v_to - 13);
  end if;
  v_len := v_to - v_from + 1;
  v_prev_from := v_from - v_len;
  v_from_ts := (v_from::timestamp at time zone 'America/Chicago');
  v_end_ts := ((v_to + 1)::timestamp at time zone 'America/Chicago');
  v_prev_ts := (v_prev_from::timestamp at time zone 'America/Chicago');

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
  -- Every day of this period and the one before, with its bucket (day, week or month).
  days as (
    select d::date as day,
      (d::date >= v_from) as is_current,
      greatest(
        date_trunc(case when v_group = 'hour' then 'day' else v_group end, d::date::timestamp)::date,
        case when d::date >= v_from then v_from else v_prev_from end
      ) as bucket
    from generate_series(v_prev_from, v_to, interval '1 day') d
  ),
  daily as (
    select days.day, days.is_current, days.bucket,
      coalesce(s.n, 0) as signups, coalesce(r.n, 0) as reviews, coalesce(h.n, 0) as heads_ups,
      coalesce(sp.n, 0) as spots, coalesce(m.n, 0) as messages,
      coalesce(v.views, 0) as views, coalesce(v.visits, 0) as visits
    from days
    left join (select (created_at at time zone 'America/Chicago')::date as day, count(*) as n from public.profiles
               where created_at >= v_prev_ts group by 1) s on s.day = days.day
    left join (select (created_at at time zone 'America/Chicago')::date as day, count(*) as n from public.road_ratings
               where created_at >= v_prev_ts group by 1) r on r.day = days.day
    left join (select (created_at at time zone 'America/Chicago')::date as day, count(*) as n from public.heads_ups
               where created_at >= v_prev_ts group by 1) h on h.day = days.day
    left join (select (created_at at time zone 'America/Chicago')::date as day, count(*) as n from public.spots
               where created_at >= v_prev_ts group by 1) sp on sp.day = days.day
    left join (select (created_at at time zone 'America/Chicago')::date as day, count(*) as n from public.messages
               where created_at >= v_prev_ts group by 1) m on m.day = days.day
    left join (select day,
                 sum(views) filter (where page not in ('visit_guest', 'visit_member')) as views,
                 sum(views) filter (where page in ('visit_guest', 'visit_member')) as visits
               from private.page_views where day >= v_prev_from group by day) v on v.day = days.day
  ),
  active as (
    -- Distinct people per bucket, not a sum of days.
    select days.bucket, days.is_current, count(distinct a.user_id) as n
    from activity a
    join days on days.day = (a.at at time zone 'America/Chicago')::date
    where a.at >= v_prev_ts and a.at < v_end_ts
    group by 1, 2
  ),
  buckets as (
    select daily.bucket, daily.is_current,
      sum(signups) as signups, sum(reviews) as reviews, sum(heads_ups) as heads_ups, sum(spots) as spots,
      sum(messages) as messages, sum(views) as views, sum(visits) as visits
    from daily group by 1, 2
  ),
  series as (
    select b.is_current, jsonb_agg(jsonb_build_object(
      'day', b.bucket,
      'signups', b.signups,
      'active', coalesce(a.n, 0),
      'reviews', b.reviews,
      'heads_ups', b.heads_ups,
      'spots', b.spots,
      'messages', b.messages,
      'views', b.views,
      'visits', b.visits
    ) order by b.bucket) as rows
    from buckets b
    left join active a on a.bucket = b.bucket and a.is_current = b.is_current
    group by b.is_current
  ),
  contributors as (
    select p.username, p.display_name,
      (select count(*) from public.road_ratings r where r.user_id = p.id) as reviews,
      (select count(*) from public.heads_ups h where h.created_by = p.id) as heads_ups,
      (select count(*) from public.spots s where s.owner_id = p.id and s.public_status = 'approved') as public_spots
    from public.profiles p
  )
  select jsonb_build_object(
    'days', v_len,
    'since', v_from,
    'until', v_to,
    'today', v_today,
    'first_day', v_start,
    'group', v_group,
    'previous_since', v_prev_from,
    'people', jsonb_build_object(
      'accounts', (select count(*) from auth.users),
      'profiles', (select count(*) from public.profiles),
      'private_profiles', (select count(*) from public.profiles where is_private),
      'new_7d', (select count(*) from public.profiles where created_at >= v_week_ts),
      'new_period', (select count(*) from public.profiles where created_at >= v_from_ts and created_at < v_end_ts),
      'active_today', (select count(distinct user_id) from activity where at >= (v_today::timestamp at time zone 'America/Chicago')),
      'active_7d', (select count(distinct user_id) from activity where at >= v_week_ts),
      'active_period', (select count(distinct user_id) from activity where at >= v_from_ts and at < v_end_ts),
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
                       where day between v_from and v_to and page not in ('visit_guest', 'visit_member')),
      'visits_today', (select coalesce(sum(views), 0) from private.page_views
                       where day = v_today and page in ('visit_guest', 'visit_member')),
      'visits_7d', (select coalesce(sum(views), 0) from private.page_views
                    where day >= v_today - 6 and page in ('visit_guest', 'visit_member')),
      'visits_period', (select coalesce(sum(views), 0) from private.page_views
                        where day between v_from and v_to and page in ('visit_guest', 'visit_member')),
      'member_visits_7d', (select coalesce(sum(views), 0) from private.page_views
                           where day >= v_today - 6 and page = 'visit_member'),
      'counting_since', (select min(day) from private.page_views),
      'pages', coalesce((
        select jsonb_agg(jsonb_build_object('page', page, 'views', views) order by views desc, page)
        from (select page, sum(views) as views from private.page_views
              where day between v_from and v_to and page not in ('visit_guest', 'visit_member') group by page) x
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
              where day between v_from and v_to group by road_id order by 2 desc, 1 limit 10) x
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
      'messages_period', (select count(*) from public.messages where created_at >= v_from_ts and created_at < v_end_ts),
      'chats_active_7d', (select count(distinct conversation_id) from public.messages where created_at >= v_week_ts)
    ),
    'notifications', jsonb_build_object(
      'sent_7d', (select count(*) from public.notifications where created_at >= v_week_ts),
      'pushed_7d', (select count(*) from public.notifications where pushed_at >= v_week_ts)
    ),
    'series', coalesce((select rows from series where is_current), '[]'::jsonb),
    'previous', coalesce((select rows from series where not is_current), '[]'::jsonb),
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

  -- By the hour (11.74): the same counts per hour. Page views and visits come
  -- from the hourly counter, which starts when this migration ran.
  if v_group = 'hour' then
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
    hours as (
      select h as hour, (h >= v_from::timestamp) as is_current
      from generate_series(v_prev_from::timestamp, (v_to + 1)::timestamp - interval '1 hour', interval '1 hour') h
    ),
    hourly as (
      select hours.hour, hours.is_current,
        coalesce(s.n, 0) as signups, coalesce(r.n, 0) as reviews, coalesce(h.n, 0) as heads_ups,
        coalesce(sp.n, 0) as spots, coalesce(m.n, 0) as messages, coalesce(a.n, 0) as active,
        coalesce(v.views, 0) as views, coalesce(v.visits, 0) as visits
      from hours
      left join (select date_trunc('hour', created_at at time zone 'America/Chicago') as hour, count(*) as n from public.profiles
                 where created_at >= v_prev_ts and created_at < v_end_ts group by 1) s on s.hour = hours.hour
      left join (select date_trunc('hour', created_at at time zone 'America/Chicago') as hour, count(*) as n from public.road_ratings
                 where created_at >= v_prev_ts and created_at < v_end_ts group by 1) r on r.hour = hours.hour
      left join (select date_trunc('hour', created_at at time zone 'America/Chicago') as hour, count(*) as n from public.heads_ups
                 where created_at >= v_prev_ts and created_at < v_end_ts group by 1) h on h.hour = hours.hour
      left join (select date_trunc('hour', created_at at time zone 'America/Chicago') as hour, count(*) as n from public.spots
                 where created_at >= v_prev_ts and created_at < v_end_ts group by 1) sp on sp.hour = hours.hour
      left join (select date_trunc('hour', created_at at time zone 'America/Chicago') as hour, count(*) as n from public.messages
                 where created_at >= v_prev_ts and created_at < v_end_ts group by 1) m on m.hour = hours.hour
      left join (select date_trunc('hour', at at time zone 'America/Chicago') as hour, count(distinct user_id) as n from activity
                 where at >= v_prev_ts and at < v_end_ts group by 1) a on a.hour = hours.hour
      left join (select hour,
                   sum(views) filter (where page not in ('visit_guest', 'visit_member')) as views,
                   sum(views) filter (where page in ('visit_guest', 'visit_member')) as visits
                 from private.page_views_hourly where hour >= v_prev_from::timestamp group by hour) v on v.hour = hours.hour
    )
    select
      coalesce(jsonb_agg(jsonb_build_object('day', to_char(hour, 'YYYY-MM-DD"T"HH24:00'), 'signups', signups, 'active', active, 'reviews', reviews, 'heads_ups', heads_ups,
        'spots', spots, 'messages', messages, 'views', views, 'visits', visits,
        'future', hour > date_trunc('hour', now() at time zone 'America/Chicago')) order by hour) filter (where is_current), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object('day', to_char(hour, 'YYYY-MM-DD"T"HH24:00'), 'signups', signups, 'active', active, 'reviews', reviews, 'heads_ups', heads_ups,
        'spots', spots, 'messages', messages, 'views', views, 'visits', visits) order by hour)
        filter (where not is_current), '[]'::jsonb)
    into v_series, v_previous
    from hourly;
    result := result || jsonb_build_object('series', v_series, 'previous', v_previous);
  end if;
  result := result || jsonb_build_object('hourly_since', (select to_char(min(hour), 'YYYY-MM-DD"T"HH24:00') from private.page_views_hourly));

  return result;
end;
$$;
revoke all on function public.admin_stats(integer, date, date, text) from public;
grant execute on function public.admin_stats(integer, date, date, text) to authenticated;
