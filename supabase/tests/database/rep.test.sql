-- Rep for confirmed road checks (plan 11.78).
begin;
select plan(21);

insert into auth.users (id, email) values
  ('3a000000-0000-0000-0000-000000000001', 'ka@example.test'),
  ('3b000000-0000-0000-0000-000000000002', 'kb@example.test'),
  ('3c000000-0000-0000-0000-000000000003', 'kc@example.test'),
  ('3d000000-0000-0000-0000-000000000004', 'kd@example.test'),
  ('3e000000-0000-0000-0000-000000000005', 'ke@example.test');
-- Three week-old accounts, one brand new, and the admin.
insert into public.profiles (id, username, display_name, created_at) values
  ('3a000000-0000-0000-0000-000000000001', 'k_old1', 'Old One', now() - interval '30 days'),
  ('3b000000-0000-0000-0000-000000000002', 'k_old2', 'Old Two', now() - interval '30 days'),
  ('3c000000-0000-0000-0000-000000000003', 'k_new', 'New', now() - interval '1 day'),
  ('3d000000-0000-0000-0000-000000000004', 'k_old3', 'Old Three', now() - interval '30 days'),
  ('3e000000-0000-0000-0000-000000000005', 'k_admin', 'Admin', now() - interval '30 days');
insert into private.site_admins (user_id) values ('3e000000-0000-0000-0000-000000000005');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.rep(uid uuid) returns int language sql as $$ select points from public.rep_summary(uid) $$;

-- ---- Three flags queue a bounty road; nobody is paid yet ----
select pg_temp.act_as('3a000000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa1', '{private}');
select pg_temp.act_as('3b000000-0000-0000-0000-000000000002');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa1', '{private}');
select pg_temp.act_as('3c000000-0000-0000-0000-000000000003');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa1', '{private}');
reset role;
select is((select status from public.road_checks where road_id = 'aaaaaaaaaaa1' and kind = 'private'), 'pending', 'three flags put the road in the queue');
select is(pg_temp.rep('3a000000-0000-0000-0000-000000000001'), 0, 'agreeing alone earns nothing');

-- Members can't decide checks or write rep themselves.
select pg_temp.act_as('3a000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.review_road_check('aaaaaaaaaaa1', 'private', true, 40) $$, '42501', null, 'members cannot accept their own checks');
select throws_ok($$ insert into public.rep_events (user_id, road_id, kind, outcome, points) values (auth.uid(), 'aaaaaaaaaaa1', 'x', 'confirmed', 40) $$,
  '42501', null, 'members cannot write rep');

-- ---- The admin accepts it as a bounty worth 11 ----
select pg_temp.act_as('3e000000-0000-0000-0000-000000000005');
select public.review_road_check('aaaaaaaaaaa1', 'private', true, 11);
reset role;
select is(pg_temp.rep('3a000000-0000-0000-0000-000000000001'), 11, 'a confirmed check pays the bounty');
select is(pg_temp.rep('3b000000-0000-0000-0000-000000000002'), 11, 'to each week-old flagger');
select is(pg_temp.rep('3c000000-0000-0000-0000-000000000003'), 0, 'a brand-new account earns nothing');
select is((select (detail ->> 'points')::int from public.notifications
           where user_id = '3a000000-0000-0000-0000-000000000001' and kind = 'road_check_helped'), 11, 'and they are told the points');

-- Flagging after it's accepted pays nothing.
select pg_temp.act_as('3d000000-0000-0000-0000-000000000004');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa1', '{private}');
reset role;
select is(pg_temp.rep('3d000000-0000-0000-0000-000000000004'), 0, 'late flags on a settled check earn nothing');

-- Accepting again doesn't pay twice.
select pg_temp.act_as('3e000000-0000-0000-0000-000000000005');
select public.review_road_check('aaaaaaaaaaa1', 'private', true, 11);
reset role;
select is(pg_temp.rep('3a000000-0000-0000-0000-000000000001'), 11, 'nothing is paid twice');

-- ---- A wrong check costs ----
select pg_temp.act_as('3a000000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa2', '{gravel}');
select pg_temp.act_as('3b000000-0000-0000-0000-000000000002');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa2', '{gravel}');
select pg_temp.act_as('3d000000-0000-0000-0000-000000000004');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa2', '{gravel}');
select pg_temp.act_as('3e000000-0000-0000-0000-000000000005');
select public.review_road_check('aaaaaaaaaaa2', 'gravel', false);
reset role;
select is(pg_temp.rep('3a000000-0000-0000-0000-000000000001'), 8, 'a dismissed check costs 3');
select is((select dismissed from public.rep_summary('3a000000-0000-0000-0000-000000000001')), 1, 'and counts against accuracy');

-- Undoing an accepted check takes its points back.
select pg_temp.act_as('3e000000-0000-0000-0000-000000000005');
select public.review_road_check('aaaaaaaaaaa1', 'private', false);
reset role;
select is(pg_temp.rep('3b000000-0000-0000-0000-000000000002'), 0, 'undoing a check takes the points back (never shown below 0)');
select is((select points from public.rep_events where user_id = '3b000000-0000-0000-0000-000000000002' and road_id = 'aaaaaaaaaaa1'), -3::smallint,
  'and charges for the wrong flag');
select is((select count(*)::int from public.rep_events where user_id = '3d000000-0000-0000-0000-000000000004' and road_id = 'aaaaaaaaaaa1'), 0,
  'someone who flagged after it was settled is not charged by the undo');

-- ---- Poor pavement is opinion: no charge ----
select pg_temp.act_as('3a000000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, pavement) values ('aaaaaaaaaaa3', 'rough');
select pg_temp.act_as('3b000000-0000-0000-0000-000000000002');
insert into public.road_ratings (road_id, pavement) values ('aaaaaaaaaaa3', 'rough');
select pg_temp.act_as('3d000000-0000-0000-0000-000000000004');
insert into public.road_ratings (road_id, pavement) values ('aaaaaaaaaaa3', 'rough');
select pg_temp.act_as('3e000000-0000-0000-0000-000000000005');
select public.review_road_check('aaaaaaaaaaa3', 'rough', false);
reset role;
select is((select points from public.rep_events where user_id = '3a000000-0000-0000-0000-000000000001' and road_id = 'aaaaaaaaaaa3'), 0::smallint,
  'a dismissed poor-pavement check costs nothing');

-- ---- The daily cap and "paved" ----
select pg_temp.act_as('3a000000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa4', '{paved}'), ('aaaaaaaaaaa5', '{paved}');
select pg_temp.act_as('3b000000-0000-0000-0000-000000000002');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa4', '{paved}'), ('aaaaaaaaaaa5', '{paved}');
select pg_temp.act_as('3d000000-0000-0000-0000-000000000004');
insert into public.road_ratings (road_id, flags) values ('aaaaaaaaaaa4', '{paved}'), ('aaaaaaaaaaa5', '{paved}');
reset role;
select is((select count(*)::int from public.road_checks where kind = 'paved' and status = 'pending'), 2, 'three "paved" flags queue a check too');
select pg_temp.act_as('3e000000-0000-0000-0000-000000000005');
select public.review_road_check('aaaaaaaaaaa4', 'paved', true, 40);
select public.review_road_check('aaaaaaaaaaa5', 'paved', true, 40);
reset role;
select is((select sum(points)::int from public.rep_events where user_id = '3d000000-0000-0000-0000-000000000004' and points > 0), 50,
  'no more than 50 points a day');

-- ---- Trusted checker ----
select is((select trusted from public.rep_summary('3d000000-0000-0000-0000-000000000004')), false, 'two confirmed checks is not yet trusted');
insert into public.rep_events (user_id, road_id, kind, outcome, points)
select '3d000000-0000-0000-0000-000000000004', 'bbbbbbbbbbb' || g, 'private', 'confirmed', 5 from generate_series(1, 3) g;
select is((select trusted from public.rep_summary('3d000000-0000-0000-0000-000000000004')), true, 'five confirmed and 80% right is trusted');
select results_eq($$ select * from public.trusted_checkers(array['3d000000-0000-0000-0000-000000000004', '3a000000-0000-0000-0000-000000000001']::uuid[]) $$,
  $$ values ('3d000000-0000-0000-0000-000000000004'::uuid) $$, 'badges go only to trusted checkers');

select * from finish();
rollback;
