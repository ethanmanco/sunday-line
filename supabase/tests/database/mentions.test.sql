-- @mentions in chats (plan 11.62). Run with: npx supabase test db
begin;
select plan(12);

insert into auth.users (id, email) values
  ('6b000000-0000-0000-0000-000000000001', 'amy@example.test'),
  ('6b000000-0000-0000-0000-000000000002', 'bo@example.test'),
  ('6b000000-0000-0000-0000-000000000003', 'cy@example.test'),
  ('6b000000-0000-0000-0000-000000000004', 'dee@example.test');
insert into public.profiles (id, username, display_name) values
  ('6b000000-0000-0000-0000-000000000001', 'amy_r', 'Amy'),
  ('6b000000-0000-0000-0000-000000000002', 'bo_r', 'Bo'),
  ('6b000000-0000-0000-0000-000000000003', 'cy_r', 'Cy'),
  ('6b000000-0000-0000-0000-000000000004', 'dee_r', 'Dee');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v text);
grant all on ids to authenticated;
create or replace function pg_temp.n(uid uuid, k text) returns int language sql as $$
  select count(*)::int from public.notifications where user_id = uid and kind = k and read_at is null;
$$;

-- Amy, Bo and Cy are in a group; Dee isn't.
select pg_temp.act_as('6b000000-0000-0000-0000-000000000001');
insert into ids values ('g', public.create_group('Canyon Crew', null, null, 'public', 'open'));
insert into ids values ('gid', (select id::text from public.groups where short_id = (select v from ids where k = 'g')));
select pg_temp.act_as('6b000000-0000-0000-0000-000000000002');
select public.join_group((select v::uuid from ids where k = 'gid'));
select pg_temp.act_as('6b000000-0000-0000-0000-000000000003');
select public.join_group((select v::uuid from ids where k = 'gid'));
reset role;
insert into ids values ('chat', (select id::text from public.conversations where group_id = (select v::uuid from ids where k = 'gid')));

-- The @ suggestions.
select pg_temp.act_as('6b000000-0000-0000-0000-000000000001');
select is((select array_agg(username order by username) from public.chat_people((select v::uuid from ids where k = 'chat'))),
  array['bo_r', 'cy_r'], 'the suggestions are everyone else in the chat');
select pg_temp.act_as('6b000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.chat_people((select v::uuid from ids where k = 'chat'))), 0,
  'someone outside the chat sees nobody');

-- Amy mentions Bo (any case), Dee (not in the chat) and an email address.
select pg_temp.act_as('6b000000-0000-0000-0000-000000000001');
insert into public.messages (conversation_id, body)
values ((select v::uuid from ids where k = 'chat'), 'Ride Sunday @BO_R? Dee too: @dee_r. Mail cy_r@example.test');
reset role;
select is(pg_temp.n('6b000000-0000-0000-0000-000000000002', 'mention'), 1, 'a mentioned member hears about it');
select is(pg_temp.n('6b000000-0000-0000-0000-000000000002', 'message'), 0, 'the mention replaces the usual message note');
select is(pg_temp.n('6b000000-0000-0000-0000-000000000003', 'mention'), 0, 'an email address isn''t a mention');
select is(pg_temp.n('6b000000-0000-0000-0000-000000000003', 'message'), 1, 'everyone else gets the usual note');
select is((select count(*)::int from public.notifications where user_id = '6b000000-0000-0000-0000-000000000004'), 0,
  'someone outside the chat isn''t told');
select is((select title from public.notifications where user_id = '6b000000-0000-0000-0000-000000000002' and kind = 'mention'),
  'Canyon Crew', 'the mention names the group');

-- Mentioning yourself does nothing.
select pg_temp.act_as('6b000000-0000-0000-0000-000000000001');
insert into public.messages (conversation_id, body) values ((select v::uuid from ids where k = 'chat'), 'note to self @amy_r');
reset role;
select is(pg_temp.n('6b000000-0000-0000-0000-000000000001', 'mention'), 0, 'mentioning yourself does nothing');

-- Reading the chat clears the mention.
select pg_temp.act_as('6b000000-0000-0000-0000-000000000002');
select public.mark_read((select v::uuid from ids where k = 'chat'));
reset role;
select is(pg_temp.n('6b000000-0000-0000-0000-000000000002', 'mention'), 0, 'reading the chat clears the mention');

-- Blocks: no mention across a block, and blocked people aren't suggested.
select pg_temp.act_as('6b000000-0000-0000-0000-000000000003');
insert into public.blocks (blocker_id, blocked_id) values ('6b000000-0000-0000-0000-000000000003', '6b000000-0000-0000-0000-000000000001');
select pg_temp.act_as('6b000000-0000-0000-0000-000000000001');
insert into public.messages (conversation_id, body) values ((select v::uuid from ids where k = 'chat'), 'you there @cy_r');
select is((select count(*)::int from public.chat_people((select v::uuid from ids where k = 'chat')) where username = 'cy_r'), 0,
  'people across a block aren''t suggested');
reset role;
select is(pg_temp.n('6b000000-0000-0000-0000-000000000003', 'mention'), 0, 'no mention from someone you blocked');

select * from finish();
rollback;
