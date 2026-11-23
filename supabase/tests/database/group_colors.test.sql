-- Group colors (plan 11.48). Run with: npx supabase test db
begin;
select plan(5);

insert into auth.users (id, email) values
  ('8a000000-0000-0000-0000-000000000001', 'ola@example.test'),
  ('8a000000-0000-0000-0000-000000000002', 'pat@example.test');
insert into public.profiles (id, username, display_name) values
  ('8a000000-0000-0000-0000-000000000001', 'ola', 'Ola'),
  ('8a000000-0000-0000-0000-000000000002', 'pat', 'Pat');
create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v text);
grant all on ids to authenticated;

select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
insert into ids values ('a', public.create_group('Color One', null, null, 'public', 'open'));
insert into ids values ('b', public.create_group('Color Two', null, null, 'public', 'open'));
insert into ids values ('c', public.create_group('Color Three', null, null, 'public', 'open'));

select is((select count(distinct color)::int from public.groups where short_id in (select v from ids)), 3,
  'a person''s new groups get different colors');
select lives_ok($$ update public.groups set color = 5 where short_id = (select v from ids where k = 'a') $$,
  'the organizer changes the color');
select is((select color::int from public.groups where short_id = (select v from ids where k = 'a')), 5, 'and it sticks');
select throws_ok($$ update public.groups set color = 9 where short_id = (select v from ids where k = 'a') $$,
  '23514', null, 'only palette colors');

select pg_temp.act_as('8a000000-0000-0000-0000-000000000002');
update public.groups set color = 1 where short_id = (select v from ids where k = 'a');
reset role;
select is((select color::int from public.groups where short_id = (select v from ids where k = 'a')), 5,
  'someone else can''t change it');

select * from finish();
rollback;
