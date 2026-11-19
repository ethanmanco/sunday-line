-- Security tests for events, hidden locations, chat posts, and private-group
-- spots on profiles.
begin;
select plan(24);

insert into auth.users (id, email) values
  ('7a000000-0000-0000-0000-000000000001', 'o@example.test'),
  ('7b000000-0000-0000-0000-000000000002', 'm@example.test'),
  ('7c000000-0000-0000-0000-000000000003', 'x@example.test');
insert into public.profiles (id, username, display_name, created_at) values
  ('7a000000-0000-0000-0000-000000000001', 'e_org', 'Org', now() - interval '30 days'),
  ('7b000000-0000-0000-0000-000000000002', 'e_mem', 'Mem', now() - interval '30 days'),
  ('7c000000-0000-0000-0000-000000000003', 'e_out', 'Out', now() - interval '30 days');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k = key $$;
create or replace function pg_temp.posts() returns int language sql as $$
  select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id
  where c.group_id = (select v from ids where k = 'g') and m.sender_id is null
$$;

-- A private group: O organizes, M is a member.
select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
create temp table made as select public.create_group('Event Club', null, null, 'private', 'request') as sid;
insert into ids select 'g', g.id from public.groups g join made on g.short_id = made.sid;
select set_config('role', 'postgres', true);
insert into public.group_members (group_id, user_id) values (pg_temp.id('g'), '7b000000-0000-0000-0000-000000000002');
grant select on made to authenticated;

select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
with x as (insert into public.spots (kind, name, category, lat, lng) values ('point', 'Meet lot', 'meetup', 32.5, -93.7) returning id)
insert into ids select 'gspot', id from x;
select public.add_spot_to_group(pg_temp.id('gspot'), pg_temp.id('g'));
select pg_temp.act_as('7c000000-0000-0000-0000-000000000003');
with x as (insert into public.spots (kind, name, category, lat, lng) values ('point', 'Outsider lot', 'meetup', 32.6, -93.6) returning id)
insert into ids select 'xspot', id from x;

-- ---- Creating ----
select pg_temp.act_as('7b000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.events (group_id, title, starts_at) values (pg_temp.id('g'), 'Member event', now() + interval '3 days') $$,
  '42501', null, 'members without the events permission cannot create events');

select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
with x as (
  insert into public.events (group_id, title, starts_at, location_release_minutes, remind_before_minutes, remind_day_of)
  values (pg_temp.id('g'), 'Sunday loop', now() + interval '3 days', 60, 1440, true) returning id
) insert into ids select 'ev', id from x;
select is(pg_temp.posts(), 1, 'creating an event posts in the group chat');
select is((select sender_id from public.messages where event_id = pg_temp.id('ev') limit 1), null,
  'event posts come from Sunday Line, not a person');

select throws_ok($$ select public.set_event_location(pg_temp.id('ev'), pg_temp.id('xspot')) $$, '42501', null,
  'the location must be a spot the organizer may use');
select lives_ok($$ select public.set_event_location(pg_temp.id('ev'), pg_temp.id('gspot')) $$, 'a group spot works as the location');
select is((select count(*)::int from public.event_locations where event_id = pg_temp.id('ev')), 1, 'event managers always see the location');

-- ---- Hidden location ----
select pg_temp.act_as('7b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.events where id = pg_temp.id('ev')), 1, 'members see the event');
select is((select count(*)::int from public.event_locations where event_id = pg_temp.id('ev')), 0,
  'members don''t see the location before its release time');
update public.events set title = 'Hijacked' where id = pg_temp.id('ev');
select is((select title from public.events where id = pg_temp.id('ev')), 'Sunday loop', 'members cannot change events');
select lives_ok($$ insert into public.event_rsvps (event_id, status) values (pg_temp.id('ev'), 'going') $$, 'members RSVP');
select throws_ok(
  $$ insert into public.event_rsvps (event_id, user_id, status) values (pg_temp.id('ev'), '7a000000-0000-0000-0000-000000000001', 'no') $$,
  '42501', null, 'nobody RSVPs for someone else');
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, body, event_id)
     select c.id, null, 'Fake announcement', pg_temp.id('ev') from public.conversations c where c.group_id = pg_temp.id('g') $$,
  '42501', null, 'nobody can post as Sunday Line');

select pg_temp.act_as('7c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.events where id = pg_temp.id('ev')), 0, 'outsiders never see a group''s events');
select is((select count(*)::int from public.event_locations), 0, 'outsiders never see event locations');
select throws_ok($$ insert into public.event_rsvps (event_id, status) values (pg_temp.id('ev'), 'going') $$,
  '42501', null, 'outsiders cannot RSVP');

-- ---- Release time passed ----
select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
with x as (
  insert into public.events (group_id, title, starts_at, location_release_minutes, remind_before_minutes, announce_on_create)
  values (pg_temp.id('g'), 'Quick meet', now() + interval '30 minutes', 60, 1440, false) returning id
) insert into ids select 'soon', id from x;
select public.set_event_location(pg_temp.id('soon'), pg_temp.id('gspot'));
select isnt((select sent_reminder_at from public.events where id = pg_temp.id('soon')), null,
  'a reminder whose time already passed is skipped, not sent late');
select pg_temp.act_as('7b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.event_locations where event_id = pg_temp.id('soon')), 1,
  'members see the location once the release time arrives');

-- ---- The scheduled job ----
select set_config('role', 'postgres', true);
update public.events set sent_reminder_at = null, sent_location_at = null where id = pg_temp.id('soon');
select is(private.run_event_jobs(), 2, 'the job posts a due reminder and the location release');
select is(private.run_event_jobs(), 0, 'and never posts the same thing twice');
select matches((select string_agg(body, ' | ') from public.messages where event_id = pg_temp.id('soon')), 'location for Quick meet is out',
  'the release post says the location is out without naming it');

-- ---- Canceling ----
select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
update public.events set status = 'cancelled' where id = pg_temp.id('ev');
select is((select count(*)::int from public.messages where event_id = pg_temp.id('ev') and body like 'Canceled:%'), 1,
  'canceling posts in the group chat');

-- ---- Private-group spots stay off profiles ----
select pg_temp.act_as('7b000000-0000-0000-0000-000000000002');
with x as (insert into public.spots (kind, name, category, lat, lng) values ('point', 'Secret lot', 'meetup', 32.4, -93.8) returning id)
insert into ids select 'secret', id from x;
select public.add_spot_to_group(pg_temp.id('secret'), pg_temp.id('g'));
insert into public.spots (kind, name, category, lat, lng, show_on_profile) values ('point', 'My public lot', 'meetup', 32.4, -93.9, true);
update public.spots set show_on_profile = true where name = 'Secret lot';
select throws_ok($$ insert into public.profile_spot_groups (group_id) values (pg_temp.id('g')) $$, '42501', null,
  'a private group can''t be picked for the profile');
select pg_temp.act_as('7c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.profile_spots('7b000000-0000-0000-0000-000000000002') where name = 'Secret lot'), 0,
  'spots in a private group never show on a profile, even if picked');
select is((select count(*)::int from public.profile_spots('7b000000-0000-0000-0000-000000000002') where name = 'My public lot'), 1,
  'personal spots still show');

select * from finish();
rollback;
