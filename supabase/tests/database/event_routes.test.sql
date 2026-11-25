-- Meets with a route (plan 11.87).
begin;
select plan(7);

insert into auth.users (id, email) values
  ('8a000000-0000-0000-0000-000000000001', 'ro@example.test'),
  ('8b000000-0000-0000-0000-000000000002', 'rm@example.test'),
  ('8c000000-0000-0000-0000-000000000003', 'rx@example.test');
insert into public.profiles (id, username, display_name) values
  ('8a000000-0000-0000-0000-000000000001', 'r_org', 'Org'),
  ('8b000000-0000-0000-0000-000000000002', 'r_mem', 'Mem'),
  ('8c000000-0000-0000-0000-000000000003', 'r_out', 'Out');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k = key $$;

select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
create temp table made as select public.create_group('Route Club', null, null, 'private', 'request') as sid;
insert into ids select 'g', g.id from public.groups g join made on g.short_id = made.sid;
select set_config('role', 'postgres', true);
insert into public.group_members (group_id, user_id) values (pg_temp.id('g'), '8b000000-0000-0000-0000-000000000002');
grant select on made to authenticated;

-- An event three days out; the location (and route) is shared an hour before.
insert into public.events (id, group_id, created_by, title, starts_at, location_release_minutes, announce_on_create)
values ('8f000000-0000-0000-0000-0000000000e1', pg_temp.id('g'), '8a000000-0000-0000-0000-000000000001', 'Loop day', now() + interval '3 days', 60, false);

create temp table route as select '[
  {"road_id": "aaaaaaaaaaa1", "name": "Lake Road", "from": [-93.6, 32.5], "to": [-93.5, 32.5], "line": "_tjeE~fhzP?owH", "miles": 5.8},
  {"road_id": "aaaaaaaaaaa2", "name": "Hill Road", "from": [-93.4, 32.6], "to": [-93.3, 32.6], "miles": 6.1}
]'::jsonb as r;
grant select on route to authenticated;

select pg_temp.act_as('8b000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.set_event_route('8f000000-0000-0000-0000-0000000000e1', (select r from route)) $$, '42501', null,
  'members without the events permission cannot set a route');

select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_event_route('8f000000-0000-0000-0000-0000000000e1', (select r from route)) $$, 'the organizer sets it');
select is((select string_agg(name, ', ' order by position) from public.event_roads where event_id = '8f000000-0000-0000-0000-0000000000e1'),
  'Lake Road, Hill Road', 'in order, and the organizer sees it now');

select pg_temp.act_as('8b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.event_roads), 0, 'members don''t see it before the location is out');
select pg_temp.act_as('8c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.event_roads), 0, 'people outside the group never do');

select set_config('role', 'postgres', true);
update public.events set starts_at = now() + interval '30 minutes' where id = '8f000000-0000-0000-0000-0000000000e1';
select pg_temp.act_as('8b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.event_roads), 2, 'members see it once the location is out');

select pg_temp.act_as('8a000000-0000-0000-0000-000000000001');
select public.set_event_route('8f000000-0000-0000-0000-0000000000e1', '[]');
select is((select count(*)::int from public.event_roads), 0, 'clearing the route removes it');

select * from finish();
rollback;
