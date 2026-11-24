-- Recent heads-ups for the site admin (plan 11.69).
-- Run with: npx supabase test db
begin;
select plan(8);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'admin@example.test');
insert into public.profiles (id, username, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'alice', 'Alice'),
  ('22222222-2222-2222-2222-222222222222', 'bob', 'Bob'),
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

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select public.add_heads_up('debris', -84.5, 35.5, 'Rocks in the lane');
reset role;
select set_config('test.hu', (select id::text from public.heads_ups limit 1), true);
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select public.vote_heads_up(current_setting('test.hu')::uuid, false);

-- Who can see them
select pg_temp.act_anon();
select throws_ok($$ select * from public.admin_recent_heads_ups() $$, '42501', null, 'signed-out visitors cannot list heads-ups');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select throws_ok($$ select * from public.admin_recent_heads_ups() $$, '42501', null, 'members cannot, not even the poster');
select throws_ok($$ select * from public.heads_ups $$, '42501', null, 'and still cannot read the table directly');

select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.admin_recent_heads_ups()), 1, 'the admin sees recent heads-ups');
select is((select kind from public.admin_recent_heads_ups()), 'debris', 'with the kind');
select is((select note from public.admin_recent_heads_ups()), 'Rocks in the lane', 'and the note');
select is((select gone_count from public.admin_recent_heads_ups()), 1, 'and the votes');

-- Never who posted it.
select is(
  (select count(*)::int from information_schema.routines r
   join information_schema.parameters p on p.specific_name = r.specific_name
   where r.routine_schema = 'public' and r.routine_name = 'admin_recent_heads_ups'
     and p.parameter_mode = 'OUT' and p.parameter_name in ('created_by', 'user_id', 'poster')),
  0, 'the list never says who posted');

select * from finish();
rollback;
