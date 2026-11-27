-- What visitors see of a group (plan 11.96).
begin;
select plan(7);

insert into auth.users (id, email) values
  ('96a00000-0000-0000-0000-000000000001', 'vo@example.test'),
  ('96b00000-0000-0000-0000-000000000002', 'vx@example.test');
insert into public.profiles (id, username, display_name) values
  ('96a00000-0000-0000-0000-000000000001', 'v_org', 'Org Person'),
  ('96b00000-0000-0000-0000-000000000002', 'v_out', 'Outsider');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;

select pg_temp.act_as('96a00000-0000-0000-0000-000000000001');
create temp table made as select public.create_group('Open Road Club', null, 'Tulsa, OK', 'public', 'open') as pub,
                                 public.create_group('Hidden Club', null, null, 'private', 'request') as priv;
select set_config('role', 'postgres', true);
insert into ids select 'pub', g.id from public.groups g join made on g.short_id = made.pub;
insert into ids select 'priv', g.id from public.groups g join made on g.short_id = made.priv;

-- Two upcoming, one past, one cancelled, one still running (started, not ended).
insert into public.events (group_id, created_by, title, starts_at, ends_at, status, announce_on_create)
select (select v from ids where k = 'pub'), '96a00000-0000-0000-0000-000000000001', t, s, e, st::public.event_status, false
from (values
  ('Soon', now() + interval '2 days', null::timestamptz, 'scheduled'),
  ('Later', now() + interval '20 days', null, 'scheduled'),
  ('Gone', now() - interval '5 days', null, 'scheduled'),
  ('Off', now() + interval '4 days', null, 'cancelled'),
  ('Running', now() - interval '1 hour', now() + interval '2 hours', 'scheduled')
) v(t, s, e, st);
-- New events always start scheduled; cancelling is a change afterwards, as in the app.
update public.events set status = 'cancelled' where title = 'Off';
insert into public.events (group_id, created_by, title, starts_at, announce_on_create)
values ((select v from ids where k = 'priv'), '96a00000-0000-0000-0000-000000000001', 'Secret meet', now() + interval '1 day', false);

-- A signed-out visitor
select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select organizer_username from public.group_visitor_summary((select v from ids where k = 'pub'))), 'v_org', 'visitors see who runs a public group');
select is((select upcoming_events from public.group_visitor_summary((select v from ids where k = 'pub'))), 3, 'upcoming counts scheduled events not yet over (cancelled and past left out)');
select is((select count(*)::int from public.group_visitor_summary((select v from ids where k = 'priv'))), 0, 'a private group shows visitors nothing');
select throws_ok($$ select count(*) from public.events $$, '42501', null, 'visitors still cannot read events themselves');

-- A signed-in outsider
select pg_temp.act_as('96b00000-0000-0000-0000-000000000002');
select is((select upcoming_events from public.group_visitor_summary((select v from ids where k = 'pub'))), 3, 'signed-in outsiders get the same summary');
select is((select count(*)::int from public.group_visitor_summary((select v from ids where k = 'priv'))), 0, 'and nothing for a private group');
select is((select count(*)::int from public.group_members where group_id = (select v from ids where k = 'pub')), 0, 'outsiders still cannot list members');

select * from finish();
rollback;
