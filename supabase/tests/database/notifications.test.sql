-- Notifications (plan 11.40). Run with: npx supabase test db
begin;
select plan(31);

insert into auth.users (id, email) values
  ('5a000000-0000-0000-0000-000000000001', 'ann@example.test'),
  ('5a000000-0000-0000-0000-000000000002', 'ben@example.test'),
  ('5a000000-0000-0000-0000-000000000003', 'cat@example.test'),
  ('5a000000-0000-0000-0000-000000000004', 'boss@example.test');
insert into public.profiles (id, username, display_name, is_private) values
  ('5a000000-0000-0000-0000-000000000001', 'ann', 'Ann', false),
  ('5a000000-0000-0000-0000-000000000002', 'ben', 'Ben', true),
  ('5a000000-0000-0000-0000-000000000003', 'cat', 'Cat', false),
  ('5a000000-0000-0000-0000-000000000004', 'boss', 'Boss', false);
insert into private.site_admins (user_id) values ('5a000000-0000-0000-0000-000000000004');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v text);
grant all on ids to authenticated;
create or replace function pg_temp.n(uid uuid, k text) returns int language sql as $$
  select count(*)::int from public.notifications where user_id = uid and kind = k;
$$;
create or replace function pg_temp.unread(uid uuid, k text) returns int language sql as $$
  select count(*)::int from public.notifications where user_id = uid and kind = k and read_at is null;
$$;

-- ---- Follows ----
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
insert into public.follows (follower_id, followee_id) values ('5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000002');
insert into public.follows (follower_id, followee_id) values ('5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000003');
reset role;
select is(pg_temp.n('5a000000-0000-0000-0000-000000000002', 'follow_request'), 1, 'a private profile hears about a follow request');
select is(pg_temp.n('5a000000-0000-0000-0000-000000000003', 'new_follower'), 1, 'a public profile hears about a new follower');

select pg_temp.act_as('5a000000-0000-0000-0000-000000000002');
update public.follows set status = 'accepted'
  where follower_id = '5a000000-0000-0000-0000-000000000001' and followee_id = '5a000000-0000-0000-0000-000000000002';
reset role;
select is(pg_temp.n('5a000000-0000-0000-0000-000000000001', 'follow_accepted'), 1, 'the follower hears the request was accepted');
select is(pg_temp.unread('5a000000-0000-0000-0000-000000000002', 'follow_request'), 0, 'accepting clears the request');

-- Nobody can read someone else's notifications.
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.notifications where user_id <> '5a000000-0000-0000-0000-000000000001'), 0,
  'members see only their own notifications');
select throws_ok($$ insert into public.notifications (user_id, kind) values ('5a000000-0000-0000-0000-000000000002', 'new_follower') $$,
  '42501', null, 'nobody writes notifications directly');

-- ---- Groups: direct invites and join requests ----
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
insert into ids values ('g', public.create_group('Night Drivers', null, null, 'private', 'request'));
insert into ids values ('gid', (select id::text from public.groups where short_id = (select v from ids where k = 'g')));
select lives_ok($$ select public.invite_to_group((select v::uuid from ids where k = 'gid'), 'cat') $$, 'an organizer invites a member by username');
select throws_ok($$ select public.invite_to_group((select v::uuid from ids where k = 'gid'), 'nobody_here') $$, 'P0002', null,
  'unknown usernames are refused');
reset role;
select is(pg_temp.n('5a000000-0000-0000-0000-000000000003', 'group_invite'), 1, 'the invitee hears about the invite');
select is((select title from public.notifications where user_id = '5a000000-0000-0000-0000-000000000003' and kind = 'group_invite'),
  'Night Drivers', 'the invite carries the group''s name');

select pg_temp.act_as('5a000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.answer_group_invite((select v::uuid from ids where k = 'gid'), true) $$, 'P0002', null,
  'nobody can accept an invite they don''t have');
select throws_ok($$ select public.invite_to_group((select v::uuid from ids where k = 'gid'), 'ann') $$, '42501', null,
  'non-members cannot invite');

select pg_temp.act_as('5a000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.answer_group_invite((select v::uuid from ids where k = 'gid'), true) $$, 'the invitee accepts');
reset role;
select is((select count(*)::int from public.group_members where user_id = '5a000000-0000-0000-0000-000000000003'), 1, 'and is now a member');
select is(pg_temp.unread('5a000000-0000-0000-0000-000000000003', 'group_invite'), 0, 'accepting clears the invite');

-- Join requests go to approvers; approval goes to the requester.
select pg_temp.act_as('5a000000-0000-0000-0000-000000000004');
insert into ids values ('pub', public.create_group('Coffee Run', null, null, 'public', 'request'));
insert into ids values ('pubid', (select id::text from public.groups where short_id = (select v from ids where k = 'pub')));
select pg_temp.act_as('5a000000-0000-0000-0000-000000000002');
insert into public.join_requests (group_id) values ((select v::uuid from ids where k = 'pubid'));
reset role;
select is(pg_temp.n('5a000000-0000-0000-0000-000000000004', 'join_request'), 1, 'the organizer hears about a join request');
select pg_temp.act_as('5a000000-0000-0000-0000-000000000004');
select public.decide_join_request((select v::uuid from ids where k = 'pubid'), '5a000000-0000-0000-0000-000000000002', true);
reset role;
select is(pg_temp.n('5a000000-0000-0000-0000-000000000002', 'join_approved'), 1, 'the requester hears they''re in');
select is(pg_temp.unread('5a000000-0000-0000-0000-000000000004', 'join_request'), 0, 'deciding clears the request');

-- ---- Events ----
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
insert into public.events (group_id, title, starts_at)
values ((select v::uuid from ids where k = 'gid'), 'Sunday loop', now() + interval '3 days');
reset role;
select is(pg_temp.n('5a000000-0000-0000-0000-000000000003', 'event_new'), 1, 'members hear about a new event');
select is(pg_temp.n('5a000000-0000-0000-0000-000000000001', 'event_new'), 0, 'the creator isn''t told about their own event');
select pg_temp.act_as('5a000000-0000-0000-0000-000000000003');
insert into public.event_rsvps (event_id, status) values ((select id from public.events where title = 'Sunday loop'), 'going');
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
update public.events set starts_at = now() + interval '4 days' where title = 'Sunday loop';
reset role;
select is(pg_temp.n('5a000000-0000-0000-0000-000000000003', 'event_changed'), 1, 'people going hear about a time change');

-- ---- Messages ----
select pg_temp.act_as('5a000000-0000-0000-0000-000000000003');
insert into ids values ('dm', public.start_direct('5a000000-0000-0000-0000-000000000001')::text);
insert into public.messages (conversation_id, body) values ((select v::uuid from ids where k = 'dm'), 'Sunday?');
insert into public.messages (conversation_id, body) values ((select v::uuid from ids where k = 'dm'), '9am?');
reset role;
select is(pg_temp.unread('5a000000-0000-0000-0000-000000000001', 'message'), 1, 'one unread row per chat');
select is((select (detail ->> 'count')::int from public.notifications where user_id = '5a000000-0000-0000-0000-000000000001' and kind = 'message'),
  2, 'it counts the messages');
select is(pg_temp.n('5a000000-0000-0000-0000-000000000003', 'message'), 0, 'senders aren''t told about their own messages');
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
select public.mark_read((select v::uuid from ids where k = 'dm'));
reset role;
select is(pg_temp.unread('5a000000-0000-0000-0000-000000000001', 'message'), 0, 'reading the chat clears it');

-- Blocks: no notifications across a block.
select pg_temp.act_as('5a000000-0000-0000-0000-000000000003');
insert into public.blocks (blocker_id, blocked_id) values ('5a000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000002');
select pg_temp.act_as('5a000000-0000-0000-0000-000000000004');
insert into ids values ('pub2', public.create_group('Block Test', null, null, 'public', 'open'));
insert into ids values ('pub2id', (select id::text from public.groups where short_id = (select v from ids where k = 'pub2')));
select pg_temp.act_as('5a000000-0000-0000-0000-000000000003');
select public.join_group((select v::uuid from ids where k = 'pub2id'));
select pg_temp.act_as('5a000000-0000-0000-0000-000000000002');
select public.join_group((select v::uuid from ids where k = 'pub2id'));
insert into public.messages (conversation_id, body)
values ((select id from public.conversations where group_id = (select v::uuid from ids where k = 'pub2id')), 'hello all');
reset role;
select is((select count(*)::int from public.notifications n where n.user_id = '5a000000-0000-0000-0000-000000000003'
  and n.actor_id = '5a000000-0000-0000-0000-000000000002'), 0, 'nothing from someone you blocked');
select is((select count(*)::int from public.notifications n where n.user_id = '5a000000-0000-0000-0000-000000000004'
  and n.kind = 'message' and n.actor_id = '5a000000-0000-0000-0000-000000000002'), 1, 'other members still hear about the message');

-- ---- Road checks: "your flag helped" ----
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
insert into public.road_ratings (road_id, flags) values ('abcdefabcdef', array['gravel']);
select pg_temp.act_as('5a000000-0000-0000-0000-000000000002');
insert into public.road_ratings (road_id, flags) values ('abcdefabcdef', array['gravel']);
select pg_temp.act_as('5a000000-0000-0000-0000-000000000003');
insert into public.road_ratings (road_id, flags) values ('abcdefabcdef', array['gravel']);
reset role;
select is(pg_temp.n('5a000000-0000-0000-0000-000000000004', 'admin_road_check'), 1, 'the admin hears a check is waiting');
select pg_temp.act_as('5a000000-0000-0000-0000-000000000004');
select public.review_road_check('abcdefabcdef', 'gravel', true);
reset role;
select is((select count(*)::int from public.notifications where kind = 'road_check_helped' and road_id = 'abcdefabcdef'), 3,
  'everyone whose flag helped hears it was accepted');

-- Marking read.
select pg_temp.act_as('5a000000-0000-0000-0000-000000000003');
select ok(public.unread_notifications() > 0, 'there are unread notifications');
select public.mark_notifications_read();
select is(public.unread_notifications(), 0, 'mark all read');

select * from finish();
rollback;
