-- Finding people: search, suggestions, and blocks.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('8a000000-0000-0000-0000-000000000001', 'a@example.test'),
  ('8b000000-0000-0000-0000-000000000002', 'b@example.test'),
  ('8c000000-0000-0000-0000-000000000003', 'c@example.test'),
  ('8d000000-0000-0000-0000-000000000004', 'd@example.test');
insert into public.profiles (id, username, display_name) values
  ('8a000000-0000-0000-0000-000000000001', 'p_alex', 'Alex Racer'),
  ('8b000000-0000-0000-0000-000000000002', 'p_blake', 'Blake Miata'),
  ('8c000000-0000-0000-0000-000000000003', 'p_casey', 'Casey'),
  ('8d000000-0000-0000-0000-000000000004', 'p_drew', 'Drew Miata');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.search_people('miata')), 2, 'search matches display names');
select is((select username from public.search_people('p_ca')), 'p_casey', 'search matches the start of a username');
select is((select count(*)::int from public.search_people('p_alex')), 0, 'you don''t find yourself');
select is((select count(*)::int from public.search_people('%')), 0, 'wildcards are treated as plain text');

-- Drew blocks Alex: they no longer find each other.
select pg_temp.act_as('8d000000-0000-0000-0000-000000000004');
insert into public.blocks (blocked_id) values ('8a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.search_people('p_alex')), 0, 'you don''t find people you blocked');
select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.search_people('drew')), 0, 'you don''t find people who blocked you');

-- Suggestions: Blake follows Alex; Casey shares a group with Alex.
select pg_temp.act_as('8b000000-0000-0000-0000-000000000002');
insert into public.follows (followee_id) values ('8a000000-0000-0000-0000-000000000001');
select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
create temp table made as select public.create_group('Miata Club', null, null, 'public', 'open') as sid;
select pg_temp.act_as('8c000000-0000-0000-0000-000000000003');
select public.join_group((select g.id from public.groups g join made on g.short_id = made.sid));
select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
select is((select reason from public.suggest_people() where username = 'p_blake'), 'Follows you', 'suggests people who follow you');
select is((select reason from public.suggest_people() where username = 'p_casey'), 'In Miata Club', 'suggests people in your groups');
insert into public.follows (followee_id) values ('8c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.suggest_people() where username = 'p_casey'), 0, 'stops suggesting once you follow');

select * from finish();
rollback;
