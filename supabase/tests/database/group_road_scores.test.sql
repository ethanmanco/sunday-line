-- Scoring roads from a group page, and private groups' roads on the public map (plan 11.59).
-- Run with: npx supabase test db
begin;
select plan(8);

insert into auth.users (id, email) values
  ('8a000000-0000-0000-0000-000000000001', 'gs_org@example.test'),
  ('8b000000-0000-0000-0000-000000000002', 'gs_member@example.test'),
  ('8c000000-0000-0000-0000-000000000003', 'gs_stranger@example.test');
insert into public.profiles (id, username, display_name, created_at) values
  ('8a000000-0000-0000-0000-000000000001', 'gs_org', 'Org', now() - interval '30 days'),
  ('8b000000-0000-0000-0000-000000000002', 'gs_member', 'Member', now() - interval '30 days'),
  ('8c000000-0000-0000-0000-000000000003', 'gs_stranger', 'Stranger', now() - interval '30 days');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v text);
grant all on ids to anon, authenticated, service_role;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from ids where k = key $$;

-- The organizer makes a public and a private group, and a road in the public one.
select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
insert into ids values ('pub_s', public.create_group('Open Club', null, null, 'public', 'open'));
insert into ids values ('pub', (select id::text from public.groups where short_id = (select v from ids where k = 'pub_s')));
insert into ids values ('priv_s', public.create_group('Hush Club', null, null, 'private', 'request'));
insert into ids values ('priv', (select id::text from public.groups where short_id = (select v from ids where k = 'priv_s')));
with x as (insert into public.spots (kind, name, lat, lng, line) values ('road', 'Club road', 32.4, -93.8, '_p~iF~ps|U_ulLnnqC') returning id)
insert into ids select 'club_road', id::text from x;
select public.add_spot_to_group(pg_temp.id('club_road'), pg_temp.id('pub'));
with x as (insert into public.spots (kind, name, lat, lng, line) values ('road', 'Pending road', 32.4, -93.8, '_p~iF~ps|U_ulLnnqC') returning id)
insert into ids select 'pending_road', id::text from x;

-- The member's own roads: one in the private group, one in the public group.
select pg_temp.act_as('8b000000-0000-0000-0000-000000000002');
with x as (insert into public.spots (kind, name, lat, lng, line) values ('road', 'Hush road', 32.4, -93.8, '_p~iF~ps|U_ulLnnqC') returning id)
insert into ids select 'hush_road', id::text from x;
with x as (insert into public.spots (kind, name, lat, lng, line) values ('road', 'Open road', 32.4, -93.8, '_p~iF~ps|U_ulLnnqC') returning id)
insert into ids select 'open_road', id::text from x;

select set_config('role', 'postgres', true);
insert into public.group_members (group_id, user_id) values
  (pg_temp.id('pub'), '8b000000-0000-0000-0000-000000000002'),
  (pg_temp.id('priv'), '8b000000-0000-0000-0000-000000000002');
insert into public.spot_groups (spot_id, group_id, status) values
  (pg_temp.id('pending_road'), pg_temp.id('pub'), 'proposed'),
  (pg_temp.id('hush_road'), pg_temp.id('priv'), 'accepted'),
  (pg_temp.id('open_road'), pg_temp.id('pub'), 'accepted');

-- Scores.
select pg_temp.act_as('8b000000-0000-0000-0000-000000000002');
select is(public.request_road_score(pg_temp.id('club_road'))::text, 'queued', 'a member asks for a group road to be scored');
select set_config('role', 'postgres', true);
select is((select requested_by from public.road_scores where spot_id = pg_temp.id('club_road')),
  '8b000000-0000-0000-0000-000000000002'::uuid, 'the member who asked gets the notification');
select pg_temp.act_as('8b000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.request_road_score(pg_temp.id('pending_road')) $$, '42501', null,
  'a road only suggested to the group can''t be scored by members');
select pg_temp.act_as('8c000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.request_road_score(pg_temp.id('club_road')) $$, '42501', null,
  'someone outside the group can''t ask');

-- The public map.
select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.submit_spot_public(pg_temp.id('hush_road')) $$, '42501', null,
  'a manager can''t put a private group''s road on the public map');
select lives_ok($$ select public.submit_spot_public(pg_temp.id('open_road')) $$,
  'a manager can put a public group''s road on the public map');
select pg_temp.act_as('8b000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.submit_spot_public(pg_temp.id('hush_road')) $$,
  'the owner still decides about their own road');
select set_config('role', 'postgres', true);
select isnt((select public_status::text from public.spots where id = pg_temp.id('hush_road')), 'none',
  'the owner''s submit went through');

select * from finish();
rollback;
