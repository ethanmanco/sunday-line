-- Private members' reviews: public, but anonymous (plan 11.84).
begin;
select plan(9);

insert into auth.users (id, email) values
  ('5a000000-0000-0000-0000-000000000001', 'pa@example.test'),
  ('5b000000-0000-0000-0000-000000000002', 'pb@example.test'),
  ('5c000000-0000-0000-0000-000000000003', 'pc@example.test');
insert into public.profiles (id, username, display_name, is_private) values
  ('5a000000-0000-0000-0000-000000000001', 'priv_rev', 'Private Reviewer', true),
  ('5b000000-0000-0000-0000-000000000002', 'pub_rev', 'Public Reviewer', false),
  ('5c000000-0000-0000-0000-000000000003', 'their_follower', 'Follower', false);
insert into public.follows (follower_id, followee_id, status) values
  ('5c000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000001', 'accepted');
update public.follows set status = 'accepted'
where follower_id = '5c000000-0000-0000-0000-000000000003' and followee_id = '5a000000-0000-0000-0000-000000000001';

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, worth, note) values ('ccccccccccc1', 3, 'Great curves by the lake');
insert into public.speed_reports (road_id, posted_limit) values ('ccccccccccc1', 45);
select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
insert into public.road_ratings (road_id, worth, note) values ('ccccccccccc1', 4, 'Worth the trip');

-- Signed out.
select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.road_ratings where road_id = 'ccccccccccc1'), 1,
  'signed out, only the public member''s review row shows');
select is((select count(*)::int from public.road_ratings where user_id = '5a000000-0000-0000-0000-000000000001'), 0,
  'a private member''s reviews can''t be listed by person');
select is((select count(*)::int from public.speed_reports where user_id = '5a000000-0000-0000-0000-000000000001'), 0,
  'nor their speed reports');
select is((select ratings::int from public.road_community where road_id = 'ccccccccccc1'), 2, 'the summary still counts both');
select is((select count(*)::int from public.road_reviews('ccccccccccc1')), 2, 'both reviews'' text shows');
select is((select user_id from public.road_reviews('ccccccccccc1') where note like 'Great%'), null,
  'without the private member''s name');
select is((select username from public.road_reviews('ccccccccccc1') where note like 'Worth%'), 'pub_rev', 'public members keep theirs');

-- A follower sees who wrote it; so do they.
select pg_temp.act_as('5c000000-0000-0000-0000-000000000003');
select is((select username from public.road_reviews('ccccccccccc1') where note like 'Great%'), 'priv_rev', 'followers see the author');
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.road_ratings where user_id = auth.uid()), 1, 'members still read their own review');

select * from finish();
rollback;
