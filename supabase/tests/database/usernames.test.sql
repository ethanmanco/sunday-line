-- Username rules: unique, lowercase handle, 3 to 20 characters, not reserved.
-- Run with: npx supabase test db
begin;
select plan(12);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ insert into public.profiles (id, display_name) values ('11111111-1111-1111-1111-111111111111', 'Alice') $$,
  '23502', null, 'a profile needs a username');
select lives_ok(
  $$ insert into public.profiles (id, username, display_name) values ('11111111-1111-1111-1111-111111111111', 'mango', 'Mango') $$,
  'a valid username is accepted');

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'mango', 'Other') $$,
  '23505', null, 'a taken username is refused');
select throws_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'Mango', 'Other') $$,
  '23514', null, 'capital letters are refused, so Mango and mango cannot both exist');
select throws_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'ab', 'Other') $$,
  '23514', null, 'too short is refused');
select throws_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'a_very_long_username_x', 'Other') $$,
  '23514', null, 'more than 20 characters is refused');
select throws_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'm2 comp', 'Other') $$,
  '23514', null, 'spaces and symbols are refused');
select throws_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'admin', 'Other') $$,
  '23514', null, 'reserved names are refused');
select lives_ok(
  $$ insert into public.profiles (id, username, display_name) values ('22222222-2222-2222-2222-222222222222', 'track_rat_99', 'Mango') $$,
  'display names do not need to be unique');

select throws_ok(
  $$ update public.profiles set username = 'mango' where id = '22222222-2222-2222-2222-222222222222' $$,
  '23505', null, 'cannot change to a taken username');
update public.profiles set username = 'hijack' where id = '11111111-1111-1111-1111-111111111111';
select is((select username from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'mango', 'nobody can change someone else''s username');

select pg_temp.act_anon();
select is((select count(*)::int from public.profiles where username = 'mango'), 1,
  'signed-out visitors can look up a username');

select * from finish();
rollback;
