-- Messages to private profiles wait for a follow (plan 11.75).
begin;
select plan(22);

insert into auth.users (id, email) values
  ('2a000000-0000-0000-0000-000000000001', 'ra@example.test'),
  ('2b000000-0000-0000-0000-000000000002', 'rb@example.test'),
  ('2c000000-0000-0000-0000-000000000003', 'rc@example.test'),
  ('2d000000-0000-0000-0000-000000000004', 'rd@example.test');
insert into public.profiles (id, username, display_name, is_private, dm_policy) values
  ('2a000000-0000-0000-0000-000000000001', 'r_pub', 'Pub', false, 'everyone'),
  ('2b000000-0000-0000-0000-000000000002', 'r_priv', 'Priv', true, 'everyone'),
  ('2c000000-0000-0000-0000-000000000003', 'r_sender', 'Sender', false, 'everyone'),
  ('2d000000-0000-0000-0000-000000000004', 'r_friend', 'Friend', false, 'everyone');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v text);
grant all on ids to anon, authenticated;
create or replace function pg_temp.c(key text) returns uuid language sql as $$ select v::uuid from ids where k = key $$;

-- ---- A public profile gets messages from anyone right away ----
select pg_temp.act_as('2c000000-0000-0000-0000-000000000003');
insert into ids values ('pub', public.start_direct('2a000000-0000-0000-0000-000000000001'));
insert into public.messages (conversation_id, body) values (pg_temp.c('pub'), 'hello public');
select is((select waiting from public.my_conversations() where id = pg_temp.c('pub')), false, 'a chat with a public profile is not waiting');
select pg_temp.act_as('2a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('pub')), 1, 'the public profile sees the message');
select is((select count(*)::int from public.notifications where kind = 'message' and conversation_id = pg_temp.c('pub')), 1, 'and is told');

-- ---- A private profile: a stranger's chat waits ----
select pg_temp.act_as('2c000000-0000-0000-0000-000000000003');
select is((select reach from public.message_candidates('r_priv') where username = 'r_priv'), 'request', 'the + list says it will wait');
insert into ids values ('priv', public.start_direct('2b000000-0000-0000-0000-000000000002'));
select lives_ok($$ insert into public.messages (conversation_id, body) values (pg_temp.c('priv'), 'hi private') $$, 'a stranger can send to a private profile');
insert into public.messages (conversation_id, body) values (pg_temp.c('priv'), 'second');
select is((select waiting from public.my_conversations() where id = pg_temp.c('priv')), true, 'the sender sees it is waiting');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('priv')), 2, 'the sender sees their own messages');
select is((select status::text from public.follows where follower_id = '2c000000-0000-0000-0000-000000000003' and followee_id = '2b000000-0000-0000-0000-000000000002'),
  'pending', 'the first message sends a follow request');

select pg_temp.act_as('2b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.my_conversations() where id = pg_temp.c('priv')), 0, 'the private profile has no chat in their inbox');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('priv')), 0, 'and cannot read the messages');
select is((select count(*)::int from public.conversations where id = pg_temp.c('priv')), 0, 'or see the chat exists');
select is((select count(*)::int from public.notifications where kind in ('message', 'mention')), 0, 'and is not told about messages');
select is((select count(*)::int from public.notifications where kind = 'follow_request'), 1, 'but gets the follow request');
select is(public.unread_count(), 0::bigint, 'and the waiting messages are not counted as unread');

-- ---- Accepting the follow request shows the chat ----
update public.follows set status = 'accepted'
where follower_id = '2c000000-0000-0000-0000-000000000003' and followee_id = '2b000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('priv')), 2, 'after accepting, the messages show');
select is((select (detail ->> 'count')::int from public.notifications where kind = 'message' and conversation_id = pg_temp.c('priv')), 2,
  'with one notification for what was waiting');
select is(public.unread_count(), 2::bigint, 'and they count as unread');
select pg_temp.act_as('2c000000-0000-0000-0000-000000000003');
select is((select waiting from public.my_conversations() where id = pg_temp.c('priv')), false, 'the sender sees it is no longer waiting');

-- ---- Someone the private profile follows lands right away ----
select pg_temp.act_as('2b000000-0000-0000-0000-000000000002');
insert into public.follows (followee_id) values ('2d000000-0000-0000-0000-000000000004');
select pg_temp.act_as('2d000000-0000-0000-0000-000000000004');
select is((select reach from public.message_candidates('r_priv') where username = 'r_priv'), 'direct', 'people they follow reach them directly');
insert into ids values ('friend', public.start_direct('2b000000-0000-0000-0000-000000000002'));
insert into public.messages (conversation_id, body) values (pg_temp.c('friend'), 'hey');
select pg_temp.act_as('2b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('friend')), 1, 'and their message shows right away');

-- ---- Declining keeps it hidden; going public shows it ----
select pg_temp.act_as('2a000000-0000-0000-0000-000000000001');
insert into ids values ('pub2priv', public.start_direct('2b000000-0000-0000-0000-000000000002'));
insert into public.messages (conversation_id, body) values (pg_temp.c('pub2priv'), 'hello?');
select pg_temp.act_as('2b000000-0000-0000-0000-000000000002');
delete from public.follows where follower_id = '2a000000-0000-0000-0000-000000000001' and followee_id = '2b000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('pub2priv')), 0, 'declining the request keeps the chat hidden');
update public.profiles set is_private = false where id = '2b000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('pub2priv')), 1, 'switching to public shows waiting chats');

select * from finish();
rollback;
