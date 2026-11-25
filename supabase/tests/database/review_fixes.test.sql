-- Fixes from the project review (plan 11.81).
begin;
select plan(13);

insert into auth.users (id, email) values
  ('4a000000-0000-0000-0000-000000000001', 'ra@example.test'),
  ('4b000000-0000-0000-0000-000000000002', 'rb@example.test'),
  ('4c000000-0000-0000-0000-000000000003', 'rc@example.test'),
  ('4d000000-0000-0000-0000-000000000004', 'rd@example.test'),
  ('4e000000-0000-0000-0000-000000000005', 're@example.test');
insert into public.profiles (id, username, display_name, created_at) values
  ('4a000000-0000-0000-0000-000000000001', 'r_old1', 'Old One', now() - interval '30 days'),
  ('4b000000-0000-0000-0000-000000000002', 'r_old2', 'Old Two', now() - interval '30 days'),
  ('4c000000-0000-0000-0000-000000000003', 'r_new', 'New', now() - interval '1 day'),
  ('4d000000-0000-0000-0000-000000000004', 'r_old3', 'Old Three', now() - interval '30 days'),
  ('4e000000-0000-0000-0000-000000000005', 'r_admin', 'Admin', now() - interval '30 days');
insert into private.site_admins (user_id) values ('4e000000-0000-0000-0000-000000000005');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.rep(uid uuid) returns int language sql as $$ select points from public.rep_summary(uid) $$;

-- ---- Flags are timed when added, not when the review is saved ----
select pg_temp.act_as('4c000000-0000-0000-0000-000000000003');
insert into public.road_ratings (road_id, flags) values ('bbbbbbbbbbb1', '{gravel}');
reset role;
-- Pretend the flag was added 8 days ago, when this account was brand new.
alter table public.road_ratings disable trigger road_ratings_time_flags;
update public.road_ratings set flag_times = jsonb_build_object('gravel', now() - interval '8 days')
where road_id = 'bbbbbbbbbbb1';
alter table public.road_ratings enable trigger road_ratings_time_flags;
update public.profiles set created_at = now() - interval '9 days' where id = '4c000000-0000-0000-0000-000000000003';
select pg_temp.act_as('4c000000-0000-0000-0000-000000000003');
update public.road_ratings set note = 'still gravel', flags = '{gravel}' where road_id = 'bbbbbbbbbbb1';
reset role;
select ok((select (flag_times ->> 'gravel')::timestamptz < now() - interval '7 days' from public.road_ratings where road_id = 'bbbbbbbbbbb1'),
  're-saving a review keeps when its flag was added');

-- Members can't set the flag times themselves.
select pg_temp.act_as('4c000000-0000-0000-0000-000000000003');
select throws_ok($$ update public.road_ratings set flag_times = '{}' where road_id = 'bbbbbbbbbbb1' $$, '42501', null,
  'members cannot write flag times');
reset role;

-- ---- Re-saving reviews doesn't bring a dismissed check back ----
select pg_temp.act_as('4a000000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, flags) values ('bbbbbbbbbbb2', '{closed}');
select pg_temp.act_as('4b000000-0000-0000-0000-000000000002');
insert into public.road_ratings (road_id, flags) values ('bbbbbbbbbbb2', '{closed}');
select pg_temp.act_as('4d000000-0000-0000-0000-000000000004');
insert into public.road_ratings (road_id, flags) values ('bbbbbbbbbbb2', '{closed}');
-- One of them takes the flag off before the admin looks.
update public.road_ratings set flags = '{}', note = 'never mind' where road_id = 'bbbbbbbbbbb2';
select pg_temp.act_as('4e000000-0000-0000-0000-000000000005');
select public.review_road_check('bbbbbbbbbbb2', 'closed', false);
reset role;
select is(pg_temp.rep('4d000000-0000-0000-0000-000000000004'), 0, 'taking a flag off before a dismissal still costs (shown floored at 0)');
select is((select points from public.rep_events where user_id = '4d000000-0000-0000-0000-000000000004' and road_id = 'bbbbbbbbbbb2'),
  -3::smallint, 'the charge is recorded');
select pg_temp.act_as('4a000000-0000-0000-0000-000000000001');
update public.road_ratings set note = 'again', flags = '{closed}' where road_id = 'bbbbbbbbbbb2';
select pg_temp.act_as('4b000000-0000-0000-0000-000000000002');
update public.road_ratings set note = 'again', flags = '{closed}' where road_id = 'bbbbbbbbbbb2';
select pg_temp.act_as('4d000000-0000-0000-0000-000000000004');
update public.road_ratings set note = 'again', flags = '{closed}' where road_id = 'bbbbbbbbbbb2';
reset role;
-- 4d re-added the flag (new), the other two only re-saved: not three newer flags.
select is((select status from public.road_checks where road_id = 'bbbbbbbbbbb2' and kind = 'closed'), 'dismissed',
  're-saving reviews does not bring a dismissed check back');

-- ---- Undoing an accepted check takes back from everyone it paid ----
select pg_temp.act_as('4a000000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, flags) values ('bbbbbbbbbbb3', '{private}');
select pg_temp.act_as('4b000000-0000-0000-0000-000000000002');
insert into public.road_ratings (road_id, flags) values ('bbbbbbbbbbb3', '{private}');
select pg_temp.act_as('4e000000-0000-0000-0000-000000000005');
select public.review_road_check('bbbbbbbbbbb3', 'private', true, 10);
reset role;
select is((select points from public.rep_events where user_id = '4b000000-0000-0000-0000-000000000002' and road_id = 'bbbbbbbbbbb3'),
  10::smallint, 'paid when accepted');
select pg_temp.act_as('4b000000-0000-0000-0000-000000000002');
update public.road_ratings set flags = '{}', note = 'never mind' where road_id = 'bbbbbbbbbbb3';
select pg_temp.act_as('4e000000-0000-0000-0000-000000000005');
select public.review_road_check('bbbbbbbbbbb3', 'private', false);
reset role;
select is((select points from public.rep_events where user_id = '4b000000-0000-0000-0000-000000000002' and road_id = 'bbbbbbbbbbb3'),
  -3::smallint, 'taking the flag off before an undo does not keep the points');
select is((select outcome from public.rep_events where user_id = '4b000000-0000-0000-0000-000000000002' and road_id = 'bbbbbbbbbbb3'),
  'dismissed', 'or the confirmed check');

-- ---- A private group's spot can't be a public group's meet spot ----
insert into public.groups (id, short_id, name, visibility, created_by) values
  ('4f000000-0000-0000-0000-00000000000a', 'rvwpriv1', 'Night Crew', 'private', '4a000000-0000-0000-0000-000000000001'),
  ('4f000000-0000-0000-0000-00000000000b', 'rvwpub01', 'Austin Cars', 'public', '4a000000-0000-0000-0000-000000000001');
insert into public.group_members (group_id, user_id, role) values
  ('4f000000-0000-0000-0000-00000000000a', '4a000000-0000-0000-0000-000000000001', 'organizer'),
  ('4f000000-0000-0000-0000-00000000000b', '4a000000-0000-0000-0000-000000000001', 'organizer');
insert into public.spots (id, owner_id, kind, name, category, lat, lng) values
  ('4f000000-0000-0000-0000-0000000000c1', '4a000000-0000-0000-0000-000000000001', 'point', 'Back lot', 'meetup', 30.1, -97.1),
  ('4f000000-0000-0000-0000-0000000000c2', '4a000000-0000-0000-0000-000000000001', 'point', 'Coffee shop', 'meetup', 30.2, -97.2);
insert into public.spot_groups (spot_id, group_id, status, added_by) values
  ('4f000000-0000-0000-0000-0000000000c1', '4f000000-0000-0000-0000-00000000000a', 'accepted', '4a000000-0000-0000-0000-000000000001');
insert into public.events (id, group_id, created_by, title, starts_at, announce_on_create) values
  ('4f000000-0000-0000-0000-0000000000e1', '4f000000-0000-0000-0000-00000000000b', '4a000000-0000-0000-0000-000000000001', 'Meet', now() + interval '3 days', false),
  ('4f000000-0000-0000-0000-0000000000e2', '4f000000-0000-0000-0000-00000000000a', '4a000000-0000-0000-0000-000000000001', 'Night', now() + interval '3 days', false);
select pg_temp.act_as('4a000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.set_event_location('4f000000-0000-0000-0000-0000000000e1', '4f000000-0000-0000-0000-0000000000c1') $$,
  '23514', null, 'a private group''s spot cannot be a public group''s meet spot');
select lives_ok($$ select public.set_event_location('4f000000-0000-0000-0000-0000000000e1', '4f000000-0000-0000-0000-0000000000c2') $$,
  'your other spots still can');
select lives_ok($$ select public.set_event_location('4f000000-0000-0000-0000-0000000000e2', '4f000000-0000-0000-0000-0000000000c1') $$,
  'and the private group can still meet there');
reset role;

-- ---- Pushes carry the message text, time zone and unread count ----
insert into public.conversations (id, kind, direct_key) values ('4f000000-0000-0000-0000-0000000000d1', 'direct', 'review-fixes-test');
insert into public.conversation_members (conversation_id, user_id) values
  ('4f000000-0000-0000-0000-0000000000d1', '4a000000-0000-0000-0000-000000000001'),
  ('4f000000-0000-0000-0000-0000000000d1', '4b000000-0000-0000-0000-000000000002');
insert into public.messages (conversation_id, sender_id, body) values
  ('4f000000-0000-0000-0000-0000000000d1', '4a000000-0000-0000-0000-000000000001', 'Meet at the gas station?');
select set_config('t.nid', (select id::text from public.notifications
  where user_id = '4b000000-0000-0000-0000-000000000002' and kind = 'message' order by created_at desc limit 1), true);
select set_config('t.unread', (select count(*)::text from public.notifications
  where user_id = '4b000000-0000-0000-0000-000000000002' and read_at is null), true);
select set_config('role', 'service_role', true);
select set_config('t.push', public.claim_push(current_setting('t.nid')::uuid)::text, true);
reset role;
select is(current_setting('t.push')::jsonb -> 'said' ->> 'body', 'Meet at the gas station?', 'a message push carries the message');
select is((current_setting('t.push')::jsonb ->> 'unread')::int, current_setting('t.unread')::int, 'and the unread count');

select * from finish();
rollback;
