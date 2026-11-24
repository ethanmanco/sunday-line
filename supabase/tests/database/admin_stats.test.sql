-- Site stats for the admin and the anonymous view counter (plan 11.66, ranges 11.68).
-- Run with: npx supabase test db
begin;
select plan(33);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'admin@example.test');
insert into public.profiles (id, username, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'alice', 'Alice'),
  ('44444444-4444-4444-4444-444444444444', 'boss', 'Boss');
insert into private.site_admins (user_id) values ('44444444-4444-4444-4444-444444444444');
-- Start from no counts (the local database may have some from browsing; rolled back at the end).
delete from private.page_views;
delete from private.road_views;

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create or replace function pg_temp.views(p text) returns int language sql as $$
  select coalesce(sum(views), 0)::int from private.page_views where page = p;
$$;

-- ---- Who can see the stats ----
select pg_temp.act_anon();
select throws_ok($$ select public.admin_stats() $$, '42501', null, 'signed-out visitors cannot see site stats');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.admin_stats() $$, '42501', null, 'members cannot see site stats');
select throws_ok($$ select public.admin_stats(7) $$, '42501', null, 'members cannot see site stats for any period');
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select lives_ok($$ select public.admin_stats() $$, 'the admin sees site stats');

-- ---- The view counter: anyone can add one, nobody can read it through the API ----
select pg_temp.act_anon();
select lives_ok($$ select public.count_view('map') $$, 'signed-out visitors count a page view');
select lives_ok($$ select public.count_view('road', 'aaaaaaaaaaaa') $$, 'a road page counts the road');
select lives_ok($$ select public.count_view('road', 'aaaaaaaaaaaa') $$, 'and again');
select lives_ok($$ select public.count_view('visit_guest') $$, 'a visit counts');
select lives_ok($$ select public.count_view('made-up') $$, 'unknown pages are ignored, not errors');
select lives_ok($$ select public.count_view('road', 'not a road id; drop table x') $$, 'bad road ids are ignored');
select throws_ok($$ select * from private.page_views $$, '42501', null, 'visitors cannot read the counts');
select throws_ok($$ insert into private.page_views (day, page, views) values (current_date, 'map', 1000) $$,
  '42501', null, 'visitors cannot write the counts directly');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.count_view('visit_member') $$, 'members count a visit too');
select throws_ok($$ select * from private.road_views $$, '42501', null, 'members cannot read road counts');

reset role;
select is(pg_temp.views('map'), 1, 'one map view');
select is(pg_temp.views('road'), 3, 'three road page views (the bad id still counts as a road page)');
select is((select sum(views)::int from private.road_views where road_id = 'aaaaaaaaaaaa'), 2, 'two views of that road');
select is((select count(*)::int from private.page_views where page = 'made-up'), 0, 'the unknown page was not kept');
select is((select count(*)::int from private.road_views where road_id <> 'aaaaaaaaaaaa'), 0, 'the bad road id was not kept');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'private' and table_name in ('page_views', 'road_views')
     and column_name not in ('day', 'page', 'road_id', 'views')),
  0, 'the counts keep nothing about the visitor');

-- ---- What the admin sees ----
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
insert into public.road_ratings (road_id, worth) values ('aaaaaaaaaaaa', 3);
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select is((public.admin_stats() -> 'traffic' ->> 'views_today')::int, 4, 'page views today (visits not included)');
select is((public.admin_stats() -> 'traffic' ->> 'visits_today')::int, 2, 'visits today');
select is(public.admin_stats() -> 'roads' -> 'most_viewed' -> 0 ->> 'road_id', 'aaaaaaaaaaaa', 'most viewed road');
select is(public.admin_stats() -> 'contributors' -> 0 ->> 'username', 'alice', 'top contributor');

-- ---- Ranges, grouping, and the period before (11.68) ----
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.admin_stats(null, '2026-11-02', '2026-11-08', 'week') $$, '42501', null,
  'members cannot see stats for a date range either');

reset role;
-- Alice was active on two days of one week (Monday 2 to Sunday 8 November 2026).
insert into public.speed_reports (road_id, user_id, posted_limit, reported_at) values
  ('bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 45, '2026-11-03 15:00+00'),
  ('cccccccccccc', '11111111-1111-1111-1111-111111111111', 45, '2026-11-05 15:00+00');
insert into private.page_views (day, page, views) values ('2026-11-03', 'map', 5), ('2026-10-28', 'map', 2);

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select is(public.admin_stats(null, '2026-11-02', '2026-11-08') ->> 'since', '2026-11-02', 'a date range starts where asked');
select is((public.admin_stats(null, '2026-11-02', '2026-11-08') ->> 'days')::int, 7, 'and is seven days long');
select is(jsonb_array_length(public.admin_stats(null, '2026-11-02', '2026-11-08') -> 'series'), 7, 'one row per day');
select is(
  (select sum((r ->> 'active')::int)::int from jsonb_array_elements(public.admin_stats(null, '2026-11-02', '2026-11-08') -> 'series') r),
  2, 'by day, Alice counts on each day she was active');
select is(jsonb_array_length(public.admin_stats(null, '2026-11-02', '2026-11-08', 'week') -> 'series'), 1, 'by week, one row');
select is((public.admin_stats(null, '2026-11-02', '2026-11-08', 'week') -> 'series' -> 0 ->> 'active')::int, 1,
  'by week, Alice counts once');
select is((public.admin_stats(null, '2026-11-02', '2026-11-08', 'week') -> 'previous' -> 0 ->> 'views')::int, 2,
  'the week before comes back for comparing');
select is(public.admin_stats(0) ->> 'since', '2026-10-28', 'all time starts on the first day anything was counted');

select * from finish();
rollback;
