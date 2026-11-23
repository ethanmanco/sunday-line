-- Web push (plan 11.43). Run with: npx supabase test db
begin;
select plan(14);

insert into auth.users (id, email) values
  ('6a000000-0000-0000-0000-000000000001', 'pia@example.test'),
  ('6a000000-0000-0000-0000-000000000002', 'quin@example.test');
insert into public.profiles (id, username, display_name) values
  ('6a000000-0000-0000-0000-000000000001', 'pia', 'Pia'),
  ('6a000000-0000-0000-0000-000000000002', 'quin', 'Quin');
-- Keep the test off the network: the sender's address is a placeholder.
update private.app_settings set value = 'https://example.test/push' where key = 'push_function_url';

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.queued() returns int language sql as $$
  select count(*)::int from net.http_request_queue where url = 'https://example.test/push';
$$;

select pg_temp.act_as('6a000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values ('https://push.example/a', '6a000000-0000-0000-0000-000000000001', 'k', 'a') $$, '42501', null,
  'devices are saved only through the function');
select lives_ok($$ select public.save_push_subscription('https://push.example/a', 'key', 'auth') $$, 'a member saves this device');
select throws_ok($$ select public.save_push_subscription('http://push.example/b', 'key', 'auth') $$, '23514', null,
  'push addresses must be https');
select is((select count(*)::int from public.push_subscriptions), 1, 'members see their own devices');

-- The same browser, now signed in as someone else, moves to them.
select pg_temp.act_as('6a000000-0000-0000-0000-000000000002');
select public.save_push_subscription('https://push.example/a', 'key2', 'auth2');
reset role;
select is((select user_id::text from public.push_subscriptions where endpoint = 'https://push.example/a'),
  '6a000000-0000-0000-0000-000000000002', 'a device belongs to whoever signed in last');

select pg_temp.act_as('6a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.push_subscriptions), 0, 'and the first member no longer sees it');
select public.remove_push_subscription('https://push.example/a');
reset role;
select is((select count(*)::int from public.push_subscriptions), 1, 'nobody can remove someone else''s device');

-- A new notification for someone with a device asks the sender to push it; others don't.
select is(pg_temp.queued(), 0, 'nothing queued yet');
select pg_temp.act_as('6a000000-0000-0000-0000-000000000001');
insert into public.follows (follower_id, followee_id) values ('6a000000-0000-0000-0000-000000000001', '6a000000-0000-0000-0000-000000000002');
reset role;
select is(pg_temp.queued(), 1, 'a notification for a member with a device is sent to the push sender');
select pg_temp.act_as('6a000000-0000-0000-0000-000000000002');
insert into public.follows (follower_id, followee_id) values ('6a000000-0000-0000-0000-000000000002', '6a000000-0000-0000-0000-000000000001');
reset role;
select is(pg_temp.queued(), 1, 'members without a device aren''t pushed');

-- The sender's way in: service role only, and each notification once.
select pg_temp.act_as('6a000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.claim_push((select id from public.notifications limit 1)) $$, '42501', null,
  'members cannot claim pushes');
reset role;
select set_config('t.nid', (select id::text from public.notifications where user_id = '6a000000-0000-0000-0000-000000000002' and kind = 'new_follower'), true);
select set_config('role', 'service_role', true);
select is(jsonb_array_length(public.claim_push(current_setting('t.nid')::uuid) -> 'devices'),
  1, 'the sender gets the notification and the member''s devices');
select is(public.claim_push(current_setting('t.nid')::uuid),
  null, 'a notification is pushed only once');
select public.drop_push_device('https://push.example/a');
reset role;
select is((select count(*)::int from public.push_subscriptions), 0, 'the sender can forget a dead device');

select * from finish();
rollback;
