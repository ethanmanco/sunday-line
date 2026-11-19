-- Security tests for groups: visibility, joining, invites, roles, removal.
begin;
select plan(39);

-- O organizes, M will moderate, X and S are regular people, E is a latecomer.
insert into auth.users (id, email) values
  ('0a000000-0000-0000-0000-000000000001', 'o@example.test'),
  ('0b000000-0000-0000-0000-000000000002', 'm@example.test'),
  ('0c000000-0000-0000-0000-000000000003', 'x@example.test'),
  ('0d000000-0000-0000-0000-000000000004', 's@example.test'),
  ('0e000000-0000-0000-0000-000000000005', 'e@example.test'),
  ('0f000000-0000-0000-0000-000000000006', 'noprofile@example.test');
insert into public.profiles (id, username, display_name) values
  ('0a000000-0000-0000-0000-000000000001', 'g_org', 'Org'),
  ('0b000000-0000-0000-0000-000000000002', 'g_mod', 'Mod'),
  ('0c000000-0000-0000-0000-000000000003', 'g_x', 'Xavi'),
  ('0d000000-0000-0000-0000-000000000004', 'g_s', 'Sam'),
  ('0e000000-0000-0000-0000-000000000005', 'g_e', 'Eve');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create temp table ids (k text primary key, v text);
grant all on ids to anon, authenticated;
create or replace function pg_temp.id(key text) returns uuid language sql as $$
  select g.id from public.groups g where g.short_id = (select v from ids where k = key);
$$;

-- ---- Creating ----
select pg_temp.act_as('0f000000-0000-0000-0000-000000000006');
select throws_ok($$ select public.create_group('Nope', null, null, 'public', 'open') $$, '42501', null,
  'you need a profile to create a group');

select pg_temp.act_as('0a000000-0000-0000-0000-000000000001');
insert into ids values ('pub', public.create_group('Shreveport Sunday Drivers', 'Twisties and coffee', 'Shreveport, LA', 'public', 'request'));
insert into ids values ('priv', public.create_group('Track Night Crew', null, null, 'private', 'request'));
insert into ids values ('open', public.create_group('Open Cruise', null, null, 'public', 'open'));
select is((select role::text from public.group_members where group_id = pg_temp.id('pub') and user_id = '0a000000-0000-0000-0000-000000000001'),
  'organizer', 'the creator becomes the organizer');
select is((select count(*)::int from public.conversations where group_id = pg_temp.id('pub')), 1, 'every group gets a group chat');
select throws_ok(
  $$ insert into public.group_members (group_id, user_id) values (pg_temp.id('pub'), '0d000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'nobody adds members directly; only through joining, approval, or invites');

-- ---- Who can see what ----
select pg_temp.act_anon();
select is((select count(*)::int from public.groups where short_id = (select v from ids where k = 'pub')), 1, 'public groups are visible to everyone');
select is((select count(*)::int from public.groups where short_id = (select v from ids where k = 'priv')), 0, 'private groups are hidden from signed-out visitors');
select is(public.group_member_count(pg_temp.id('pub'))::int, 1, 'anyone can see a public group''s member count');

select pg_temp.act_as('0d000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.groups where short_id = (select v from ids where k = 'priv')), 0, 'private groups are hidden from non-members');
select is((select count(*)::int from public.group_members where group_id = pg_temp.id('pub')), 0, 'non-members cannot list a group''s members');

-- ---- Joining ----
select lives_ok($$ select public.join_group(pg_temp.id('open')) $$, 'anyone can join an open public group');
select throws_ok($$ select public.join_group(pg_temp.id('pub')) $$, '42501', null, 'a group that asks first cannot be joined directly');
select lives_ok(
  $$ insert into public.join_requests (group_id, message) values (pg_temp.id('pub'), 'I drive an MX-5') $$,
  'anyone can ask to join a public group');
select throws_ok($$ select public.decide_join_request(pg_temp.id('pub'), '0d000000-0000-0000-0000-000000000004', true) $$,
  '42501', null, 'nobody approves their own request');

select pg_temp.act_as('0a000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.decide_join_request(pg_temp.id('pub'), '0d000000-0000-0000-0000-000000000004', true) $$,
  'the organizer approves requests');
select is((select count(*)::int from public.group_members where group_id = pg_temp.id('pub')), 2, 'an approved person becomes a member');

-- ---- Invite links ----
insert into ids values ('tok', public.create_invite(pg_temp.id('priv'), 'For X', null, 1));
insert into ids values ('tok2', public.create_invite(pg_temp.id('priv'), 'Revoked', null, null));
select throws_ok($$ select count(*) from private.invite_tokens $$, '42501', null, 'nobody can read invite tokens, not even the organizer');
select set_config('role', 'postgres', true);
select is((select count(*)::int from private.invite_tokens where token_hash = extensions.digest((select v from ids where k = 'tok'), 'sha256')), 1,
  'invite tokens are stored as SHA-256 hashes');
select is((select count(*)::int from private.invite_tokens where position(convert_to((select v from ids where k = 'tok'), 'utf8') in token_hash) > 0), 0,
  'the token itself is never stored');
select pg_temp.act_as('0a000000-0000-0000-0000-000000000001');
select public.revoke_invite((select id from public.group_invites where label = 'Revoked'));

select pg_temp.act_anon();
select is((select group_name from public.invite_preview((select v from ids where k = 'tok'))), 'Track Night Crew',
  'an invite link shows the group name before joining');
select is((select count(*)::int from public.invite_preview('not-a-real-token')), 0, 'a made-up token shows nothing');

select pg_temp.act_as('0c000000-0000-0000-0000-000000000003');
select is(public.redeem_invite((select v from ids where k = 'tok')), (select v from ids where k = 'priv'), 'an invite link joins a private group');
select is((select count(*)::int from public.groups where short_id = (select v from ids where k = 'priv')), 1, 'members see their private group');
select throws_ok($$ select public.redeem_invite('not-a-real-token') $$, 'P0002', null, 'a made-up token does not work');

select pg_temp.act_as('0e000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.redeem_invite((select v from ids where k = 'tok')) $$, '42501', null, 'an invite stops working at its use limit');
select throws_ok($$ select public.redeem_invite((select v from ids where k = 'tok2')) $$, '42501', null, 'a revoked invite does not work');
select throws_ok(
  $$ insert into public.join_requests (group_id) values (pg_temp.id('priv')) $$,
  '42501', null, 'nobody can ask to join a group they can''t see');

-- ---- Outsiders ----
select pg_temp.act_as('0e000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.remove_member(pg_temp.id('pub'), '0d000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'people outside a group cannot remove its members');

-- ---- Roles and permissions ----
select pg_temp.act_as('0b000000-0000-0000-0000-000000000002');
select public.join_group(pg_temp.id('open'));
select throws_ok($$ select public.set_member_role(pg_temp.id('open'), '0b000000-0000-0000-0000-000000000002', 'moderator', array['remove']) $$,
  '42501', null, 'members cannot promote themselves');

select pg_temp.act_as('0a000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_member_role(pg_temp.id('open'), '0b000000-0000-0000-0000-000000000002', 'moderator', array['approve']) $$,
  'the organizer makes a moderator');

select pg_temp.act_as('0b000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.remove_member(pg_temp.id('open'), '0d000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'a moderator without the remove permission cannot remove members');
select throws_ok($$ select public.create_invite(pg_temp.id('open'), null, null, null) $$,
  '42501', null, 'a moderator without the invite permission cannot make invite links');

select pg_temp.act_as('0a000000-0000-0000-0000-000000000001');
select public.set_member_role(pg_temp.id('open'), '0b000000-0000-0000-0000-000000000002', 'moderator', array['approve', 'remove']);

select pg_temp.act_as('0b000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.remove_member(pg_temp.id('open'), '0d000000-0000-0000-0000-000000000004') $$,
  'a moderator with the remove permission removes a member');
select throws_ok($$ select public.remove_member(pg_temp.id('open'), '0a000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'nobody removes the organizer');
update public.groups set name = 'Hijacked' where id = pg_temp.id('open');
select is((select name from public.groups where id = pg_temp.id('open')), 'Open Cruise', 'only the organizer edits the group');

-- ---- Leaving and handing off ----
select pg_temp.act_as('0a000000-0000-0000-0000-000000000001');
delete from public.group_members where group_id = pg_temp.id('open') and user_id = '0a000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.group_members where group_id = pg_temp.id('open') and role = 'organizer'), 1,
  'the organizer cannot just leave');
select lives_ok($$ select public.transfer_organizer(pg_temp.id('open'), '0b000000-0000-0000-0000-000000000002') $$,
  'the organizer hands the group to a member');
select is((select role::text from public.group_members where group_id = pg_temp.id('open') and user_id = '0b000000-0000-0000-0000-000000000002'),
  'organizer', 'the new organizer takes over');
select is((select role::text from public.group_members where group_id = pg_temp.id('open') and user_id = '0a000000-0000-0000-0000-000000000001'),
  'moderator', 'the old organizer becomes a moderator');
select lives_ok($$ delete from public.group_members where group_id = pg_temp.id('open') and user_id = '0a000000-0000-0000-0000-000000000001' $$,
  'members can leave');

select * from finish();
rollback;
