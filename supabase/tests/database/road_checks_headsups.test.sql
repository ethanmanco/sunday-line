-- Review flags, the road check queue, and heads-ups (plan 11.37-11.39).
-- Run with: npx supabase test db
begin;
select plan(26);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'c@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'admin@example.test');
insert into public.profiles (id, username, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'alice', 'Alice'),
  ('22222222-2222-2222-2222-222222222222', 'bob', 'Bob'),
  ('33333333-3333-3333-3333-333333333333', 'cara', 'Cara'),
  ('44444444-4444-4444-4444-444444444444', 'boss', 'Boss');
insert into private.site_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create or replace function pg_temp.check_status(p_road text, p_kind text) returns text language sql as $$
  select status from public.road_checks where road_id = p_road and kind = p_kind;
$$;

-- ---- Flags in reviews ----
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok($$ insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaaa', array['gravel']) $$,
  'a review can be just a flag');
select throws_ok($$ insert into public.road_ratings (road_id, flags) values ('bbbbbbbbbbbb', array['made-up']) $$,
  '23514', null, 'only known flags');
select lives_ok($$ insert into public.road_ratings (road_id, worth, local_best, note) values ('bbbbbbbbbbbb', 3, true, 'Best around here') $$,
  'a review with how far you''d drive, best around here, and a note');

reset role;
select is(pg_temp.check_status('aaaaaaaaaaaa', 'gravel'), null, 'one member''s flag does not queue a road');

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaaa', array['gravel', 'police']);
reset role;
select is(pg_temp.check_status('aaaaaaaaaaaa', 'gravel'), null, 'two flags do not queue it either');

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaaa', array['gravel']);
reset role;
select is(pg_temp.check_status('aaaaaaaaaaaa', 'gravel'), 'pending', 'three members flagging gravel queue the road');
select is(pg_temp.check_status('aaaaaaaaaaaa', 'police'), null, 'police flags never queue a road');

select pg_temp.act_anon();
select is((select count(*)::int from public.road_checks where road_id = 'aaaaaaaaaaaa'), 0,
  'pending checks are not public');
select is((select flag_gravel::int from public.road_community where road_id = 'aaaaaaaaaaaa'), 3, 'summary counts gravel flags');
select is((select flag_police::int from public.road_community where road_id = 'aaaaaaaaaaaa'), 1, 'summary counts police flags');
select is((select local_best::int from public.road_community where road_id = 'bbbbbbbbbbbb'), 1, 'summary counts best-around-here');

-- ---- The admin's review ----
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.review_road_check('aaaaaaaaaaaa', 'gravel', true) $$, '42501', null,
  'members cannot review checks');
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.road_checks where status = 'pending'), 1, 'the admin sees the queue');
select lives_ok($$ select public.review_road_check('aaaaaaaaaaaa', 'gravel', true) $$, 'the admin accepts it');
select pg_temp.act_anon();
select is((select status from public.road_checks where road_id = 'aaaaaaaaaaaa' and kind = 'gravel'), 'accepted',
  'accepted checks are public, so the app can apply them');

-- The admin's own flag counts at once.
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
insert into public.road_ratings (road_id, flags) values ('cccccccccccc', array['private']);
insert into public.road_ratings (road_id, pavement) values ('dddddddddddd', 'rough');
reset role;
select is(pg_temp.check_status('cccccccccccc', 'private'), 'accepted', 'the admin''s private flag is accepted at once');
select is(pg_temp.check_status('dddddddddddd', 'rough'), 'accepted', 'the admin''s rough pavement is accepted at once');

-- Dismissed checks come back only with three newer flags.
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select public.review_road_check('aaaaaaaaaaaa', 'gravel', false);
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
update public.road_ratings set note = 'still gravel' where road_id = 'aaaaaaaaaaaa';
reset role;
select is(pg_temp.check_status('aaaaaaaaaaaa', 'gravel'), 'dismissed', 'editing a note does not reopen a dismissed check');

-- ---- Heads-ups ----
select pg_temp.act_anon();
select throws_ok($$ select public.add_heads_up('police', -93.75, 32.5, null) $$, '42501', null,
  'signed-out visitors cannot post heads-ups');
select throws_ok($$ select count(*) from public.heads_ups $$, '42501', null,
  'nobody reads the heads-up table directly (who posted stays private)');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.add_heads_up('debris', -93.75, 32.5, 'Tire in the left lane') $$, 'a member posts a heads-up');
select throws_ok($$ select public.add_heads_up('aliens', -93.75, 32.5, null) $$, '23514', null, 'only known kinds');

select pg_temp.act_anon();
select is((select count(*)::int from public.live_heads_ups(-94, 32, -93, 33)), 1, 'anyone sees live heads-ups');
select is((select mine from public.live_heads_ups(-94, 32, -93, 33)), false, 'and not whose they are');

-- Two "gone" votes end it.
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select public.vote_heads_up((select id from public.live_heads_ups(-94, 32, -93, 33)), false);
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
select public.vote_heads_up((select id from public.live_heads_ups(-94, 32, -93, 33)), false);
select pg_temp.act_anon();
select is((select count(*)::int from public.live_heads_ups(-94, 32, -93, 33)), 0, 'two "gone" votes end a heads-up');

-- The poster can end their own.
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select public.add_heads_up('police', -93.7, 32.6, null);
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select public.vote_heads_up((select id from public.live_heads_ups(-94, 32, -93, 33) where mine), false);
select is((select count(*)::int from public.live_heads_ups(-94, 32, -93, 33)), 0, 'the poster can end their own');

select * from finish();
rollback;
