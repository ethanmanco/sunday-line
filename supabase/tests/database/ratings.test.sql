-- Security tests for profiles, road ratings, and speed reports.
-- Run with: npx supabase test db
begin;
select plan(24);

-- Two people.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test');

-- Helpers to act as someone.
create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

-- ---- Profiles ----
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ insert into public.profiles (id, username, display_name) values ('11111111-1111-1111-1111-111111111111', 'alice', 'Alice') $$,
  'a person can create their own profile');
select throws_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'notbob', 'Not Bob') $$,
  '42501', null, 'nobody can create a profile for someone else');

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'bob', 'Bob') $$,
  'second person creates their profile');
update public.profiles set display_name = 'Hacked' where id = '11111111-1111-1111-1111-111111111111';
select is((select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Alice', 'nobody can rename someone else');
select pg_temp.act_anon();
select is((select count(*)::int from public.profiles where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')), 2, 'anyone can see display names');
select throws_ok($$ select terms_accepted_at from public.profiles $$, '42501', null,
  'signed-out visitors cannot read private profile columns');

-- ---- Ratings ----
select throws_ok(
  $$ insert into public.road_ratings (road_id, user_id, fun) values ('aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 5) $$,
  '42501', null, 'signed-out visitors cannot rate');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ insert into public.road_ratings (road_id, fun, pavement, drove_it) values ('aaaaaaaaaaaa', 5, 'smooth', true) $$,
  'a person can rate a road (user id defaults to them)');
select throws_ok(
  $$ insert into public.road_ratings (road_id, user_id, fun) values ('aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 1) $$,
  '42501', null, 'nobody can rate as someone else');
select throws_ok(
  $$ insert into public.road_ratings (road_id, fun) values ('not-a-road!', 3) $$,
  '23514', null, 'road ids must look like real road ids');
select throws_ok(
  $$ insert into public.road_ratings (road_id, fun) values ('bbbbbbbbbbbb', 9) $$,
  '23514', null, 'fun is 1 to 5');
select throws_ok(
  $$ insert into public.road_ratings (road_id) values ('cccccccccccc') $$,
  '23514', null, 'an empty rating is refused');

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ insert into public.road_ratings (road_id, fun, pavement) values ('aaaaaaaaaaaa', 3, 'loose_gravel') $$,
  'second person rates the same road');
update public.road_ratings set fun = 1 where user_id = '11111111-1111-1111-1111-111111111111';
delete from public.road_ratings where user_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.act_anon();
select is((select fun::int from public.road_ratings where user_id = '11111111-1111-1111-1111-111111111111'),
  5, 'nobody can change or delete someone else''s rating');

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ update public.road_ratings set user_id = '11111111-1111-1111-1111-111111111111' where user_id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null, 'a rating cannot be handed to someone else');

-- ---- Speed reports ----
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok($$ insert into public.speed_reports (road_id, posted_limit) values ('aaaaaaaaaaaa', 55) $$,
  'a person can report a posted limit');
select throws_ok($$ insert into public.speed_reports (road_id, posted_limit) values ('aaaaaaaaaaaa', 57) $$,
  '23514', null, 'limits are multiples of 5 (and one report per person per road)');

select pg_temp.act_anon();
select is((select reported_limit from public.road_community where road_id = 'aaaaaaaaaaaa'), null::smallint,
  'one report does not replace the estimate');

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select lives_ok($$ insert into public.speed_reports (road_id, posted_limit) values ('aaaaaaaaaaaa', 55) $$,
  'second report');

-- ---- Summary ----
select pg_temp.act_anon();
select is((select ratings::int from public.road_community where road_id = 'aaaaaaaaaaaa'), 2, 'summary counts ratings');
select is((select fun_avg from public.road_community where road_id = 'aaaaaaaaaaaa'), 4.0, 'summary averages fun');
select is((select pavement_loose_gravel::int from public.road_community where road_id = 'aaaaaaaaaaaa'), 1,
  'summary counts loose gravel reports');
select is((select reported_limit::int from public.road_community where road_id = 'aaaaaaaaaaaa'), 55,
  'two matching reports set the reported limit');

-- ---- Deleting an account removes everything they posted ----
reset role;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select is((select count(*)::int from public.road_ratings where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'deleting an account removes its ratings');

select * from finish();
rollback;
