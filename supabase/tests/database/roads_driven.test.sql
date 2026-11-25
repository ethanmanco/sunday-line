-- Roads a member has driven (plan 11.88).
begin;
select plan(4);

insert into auth.users (id, email) values
  ('9a100000-0000-0000-0000-000000000001', 'da@example.test'),
  ('9b100000-0000-0000-0000-000000000002', 'db@example.test');
insert into public.profiles (id, username, display_name, is_private) values
  ('9a100000-0000-0000-0000-000000000001', 'drives_private', 'Driver', true),
  ('9b100000-0000-0000-0000-000000000002', 'drives_follower', 'Follower', false);
insert into public.follows (follower_id, followee_id, status) values
  ('9b100000-0000-0000-0000-000000000002', '9a100000-0000-0000-0000-000000000001', 'accepted');
update public.follows set status = 'accepted' where follower_id = '9b100000-0000-0000-0000-000000000002';

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.act_as('9a100000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, drove_it, worth) values ('ddddddddddd1', true, 3), ('ddddddddddd2', false, 2);
select is((select count(*)::int from public.roads_driven(auth.uid())), 1, 'only roads marked "I drove it" count');

select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.roads_driven('9a100000-0000-0000-0000-000000000001')), 0,
  'a private member''s driven roads are hidden from strangers');

select pg_temp.act_as('9b100000-0000-0000-0000-000000000002');
select is((select road_id from public.roads_driven('9a100000-0000-0000-0000-000000000001')), 'ddddddddddd1',
  'their followers see them');

select set_config('role', 'postgres', true);
update public.profiles set is_private = false where id = '9a100000-0000-0000-0000-000000000001';
select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.roads_driven('9a100000-0000-0000-0000-000000000001')), 1, 'a public member''s are public');

select * from finish();
rollback;
