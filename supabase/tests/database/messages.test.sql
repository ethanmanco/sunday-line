-- Security tests for direct messages and group chats.
begin;
select plan(29);

insert into auth.users (id, email) values
  ('1a000000-0000-0000-0000-000000000001', 'a@example.test'),
  ('1b000000-0000-0000-0000-000000000002', 'b@example.test'),
  ('1c000000-0000-0000-0000-000000000003', 'c@example.test'),
  ('1d000000-0000-0000-0000-000000000004', 'd@example.test');
insert into public.profiles (id, username, display_name, dm_policy) values
  ('1a000000-0000-0000-0000-000000000001', 'm_a', 'Ana', 'everyone'),
  ('1b000000-0000-0000-0000-000000000002', 'm_b', 'Ben', 'everyone'),
  ('1c000000-0000-0000-0000-000000000003', 'm_c', 'Cy', 'everyone'),
  ('1d000000-0000-0000-0000-000000000004', 'm_d', 'Dee', 'following');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create temp table ids (k text primary key, v text);
grant all on ids to anon, authenticated;
create or replace function pg_temp.c(key text) returns uuid language sql as $$ select v::uuid from ids where k = key $$;

-- ---- Starting a conversation ----
select pg_temp.act_as('1a000000-0000-0000-0000-000000000001');
insert into ids values ('ab', public.start_direct('1b000000-0000-0000-0000-000000000002'));
select is(public.start_direct('1b000000-0000-0000-0000-000000000002'), pg_temp.c('ab'), 'a pair of people has one conversation');
select lives_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('ab'), 'Sunday drive?') $$, 'people can message each other');
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('ab'), '1b000000-0000-0000-0000-000000000002', 'fake') $$,
  '42501', null, 'nobody can send as someone else');
select throws_ok($$ select public.start_direct('1a000000-0000-0000-0000-000000000001') $$, 'P0002', null, 'nobody messages themselves');

select pg_temp.act_as('1b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('ab')), 1, 'the other person sees the message');
select is((select unread::int from public.my_conversations() where id = pg_temp.c('ab')), 1, 'a new message counts as unread');
select public.mark_read(pg_temp.c('ab'));
select is((select unread::int from public.my_conversations() where id = pg_temp.c('ab')), 0, 'opening the conversation clears unread');
update public.messages set body = 'edited by B' where conversation_id = pg_temp.c('ab');
select is((select body from public.messages where conversation_id = pg_temp.c('ab')), 'Sunday drive?', 'nobody edits someone else''s message');
delete from public.messages where conversation_id = pg_temp.c('ab');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('ab')), 1, 'nobody deletes someone else''s message');

select pg_temp.act_as('1c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('ab')), 0, 'outsiders cannot read a conversation');
select is((select count(*)::int from public.conversations where id = pg_temp.c('ab')), 0, 'outsiders cannot even see it exists');
select throws_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('ab'), 'hi') $$,
  '42501', null, 'outsiders cannot post into a conversation by guessing its ID');

select pg_temp.act_anon();
select throws_ok($$ select count(*) from public.messages $$, '42501', null, 'signed-out visitors cannot read messages at all');

-- ---- Who can message me ----
select pg_temp.act_as('1a000000-0000-0000-0000-000000000001');
update public.messages set body = 'Sunday drive? 9am' where conversation_id = pg_temp.c('ab');
select isnt((select edited_at from public.messages where conversation_id = pg_temp.c('ab')), null, 'editing your own message marks it edited');
select throws_ok($$ select public.start_direct('1d000000-0000-0000-0000-000000000004') $$,
  '42501', null, '"people I follow" refuses strangers');

select pg_temp.act_as('1d000000-0000-0000-0000-000000000004');
insert into public.follows (followee_id) values ('1a000000-0000-0000-0000-000000000001');
select pg_temp.act_as('1a000000-0000-0000-0000-000000000001');
select lives_ok($$ insert into ids values ('ad', public.start_direct('1d000000-0000-0000-0000-000000000004')) $$,
  '"people I follow" lets in people they follow');

select pg_temp.act_as('1b000000-0000-0000-0000-000000000002');
update public.profiles set dm_policy = 'nobody' where id = '1b000000-0000-0000-0000-000000000002';
select pg_temp.act_as('1c000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.start_direct('1b000000-0000-0000-0000-000000000002') $$,
  '42501', null, '"nobody" refuses new conversations');
select pg_temp.act_as('1a000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('ab'), 'still there?') $$,
  '42501', null, '"nobody" also stops more messages in an old conversation');
select pg_temp.act_as('1b000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('ab'), 'yes, 9am works') $$,
  'people with "nobody" can still write to others');
select pg_temp.act_as('1a000000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('ab'), 'see you there') $$,
  'once they write to you, you can reply');

-- ---- Blocking ----
select pg_temp.act_as('1b000000-0000-0000-0000-000000000002');
update public.profiles set dm_policy = 'everyone' where id = '1b000000-0000-0000-0000-000000000002';
insert into public.blocks (blocked_id) values ('1a000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('ab'), 'x') $$,
  '42501', null, 'the blocker cannot message the blocked person');
select pg_temp.act_as('1a000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('ab'), 'x') $$,
  '42501', null, 'a blocked person cannot message the blocker');
select throws_ok($$ select public.start_direct('1b000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'a blocked person cannot reopen the conversation');

-- ---- Group chats ----
insert into ids values ('g', public.create_group('Chat Club', null, null, 'public', 'open'));
insert into ids values ('gc', (select c.id::text from public.conversations c join public.groups g on g.id = c.group_id where g.short_id = (select v from ids where k = 'g')));
select lives_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('gc'), 'Welcome!') $$, 'members post in the group chat');

select pg_temp.act_as('1c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('gc')), 0, 'non-members cannot read a group chat');
select throws_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('gc'), 'hi') $$,
  '42501', null, 'non-members cannot post in a group chat');
select public.join_group((select id from public.groups where short_id = (select v from ids where k = 'g')));
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('gc')), 1, 'joining the group opens the chat');

-- ---- Chat photos ----
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('message-media', (select v from ids where k = 'ab') || '/1c000000-0000-0000-0000-000000000003-x.webp') $$,
  '42501', null, 'outsiders cannot upload into someone else''s conversation');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('message-media', (select v from ids where k = 'gc') || '/1c000000-0000-0000-0000-000000000003-x.webp') $$,
  'members upload chat photos');

select * from finish();
rollback;
