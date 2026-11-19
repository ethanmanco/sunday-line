-- Security tests for profiles, follows, blocks, vehicles, gallery, and files.
-- Run with: npx supabase test db
begin;
select plan(40);

-- A and C have public profiles, B's is private.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test'),
  ('cccccccc-0000-0000-0000-000000000003', 'c@example.test');
insert into public.profiles (id, username, display_name, is_private) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice', 'Alice', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob', 'Bob', true),
  ('cccccccc-0000-0000-0000-000000000003', 'cara', 'Cara', false);
insert into public.vehicles (id, user_id, year, make, model) values
  ('b0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 2019, 'Mazda', 'Miata'),
  ('c0000000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-000000000003', 2021, 'Yamaha', 'MT-09');
insert into public.profile_media (user_id, path, kind) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002/g1.webp', 'image');
insert into storage.objects (bucket_id, name) values
  ('profile-media', 'bbbbbbbb-0000-0000-0000-000000000002/g1.webp'),
  ('profile-images', 'bbbbbbbb-0000-0000-0000-000000000002/avatar.webp');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

-- ---- Following a public profile ----
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.follows (followee_id, status) values ('cccccccc-0000-0000-0000-000000000003', 'accepted') $$,
  '42501', null, 'nobody can set a follow''s status themselves');
select lives_ok(
  $$ insert into public.follows (followee_id) values ('cccccccc-0000-0000-0000-000000000003') $$,
  'anyone can follow a public profile');
select is((select status::text from public.follows where followee_id = 'cccccccc-0000-0000-0000-000000000003'),
  'accepted', 'following a public profile is instant');
select throws_ok(
  $$ insert into public.follows (follower_id, followee_id) values ('bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003') $$,
  '42501', null, 'nobody can follow on someone else''s behalf');
select throws_ok(
  $$ insert into public.follows (followee_id) values ('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '23514', null, 'nobody can follow themselves');

-- ---- Following a private profile ----
select lives_ok(
  $$ insert into public.follows (followee_id) values ('bbbbbbbb-0000-0000-0000-000000000002') $$,
  'anyone can ask to follow a private profile');
select is((select status::text from public.follows where followee_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'pending', 'following a private profile starts as a request');
update public.follows set status = 'accepted' where followee_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is((select status::text from public.follows where followee_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'pending', 'nobody can approve their own request');
select is((select count(*)::int from public.vehicles where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'a pending request does not show a private profile''s vehicles');
select is((select count(*)::int from public.profile_media where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'a pending request does not show a private profile''s gallery');
select is((select count(*)::int from storage.objects where name = 'bbbbbbbb-0000-0000-0000-000000000002/g1.webp'), 0,
  'a pending request cannot fetch a private gallery file');

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select is((select count(*)::int from public.follows where followee_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'others cannot see who follows or asked to follow a private profile');

select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*)::int from public.follows where followee_id = 'bbbbbbbb-0000-0000-0000-000000000002' and status = 'pending'), 1,
  'the private profile sees its requests');
update public.follows set status = 'accepted'
  where follower_id = 'aaaaaaaa-0000-0000-0000-000000000001' and followee_id = 'bbbbbbbb-0000-0000-0000-000000000002';

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.vehicles where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 1,
  'an approved follower sees a private profile''s vehicles');
select is((select count(*)::int from storage.objects where name = 'bbbbbbbb-0000-0000-0000-000000000002/g1.webp'), 1,
  'an approved follower can fetch a private gallery file');

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select is((select count(*)::int from public.vehicles where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'non-followers still cannot see a private profile''s vehicles');
select is((select count(*)::int from storage.objects where name = 'bbbbbbbb-0000-0000-0000-000000000002/g1.webp'), 0,
  'non-followers still cannot fetch a private gallery file');

select pg_temp.act_anon();
select is((select count(*)::int from public.vehicles where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'signed-out visitors cannot see a private profile''s vehicles');
select is((select count(*)::int from public.vehicles where user_id = 'cccccccc-0000-0000-0000-000000000003'), 1,
  'signed-out visitors can see a public profile''s vehicles');
select is((select count(*)::int from public.follows where followee_id = 'cccccccc-0000-0000-0000-000000000003'), 1,
  'signed-out visitors can see follows between public profiles');
select is((select count(*)::int from public.follows where followee_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'signed-out visitors cannot see a private profile''s followers');
select is((select count(*)::int from storage.objects where name = 'bbbbbbbb-0000-0000-0000-000000000002/avatar.webp'), 1,
  'avatars and banners are public');
select is((select followers::int from public.follow_counts('bbbbbbbb-0000-0000-0000-000000000002')), 1,
  'follower counts are public and count approved follows only');

-- ---- Removing a follower ----
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
delete from public.follows where follower_id = 'aaaaaaaa-0000-0000-0000-000000000001' and followee_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.vehicles where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'a removed follower loses access');

-- ---- Going public approves waiting requests ----
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
insert into public.follows (followee_id) values ('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
update public.profiles set is_private = false where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is((select status::text from public.follows where follower_id = 'cccccccc-0000-0000-0000-000000000003' and followee_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'accepted', 'switching to public approves waiting requests');
update public.profiles set is_private = true where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- ---- Blocking ----
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select lives_ok(
  $$ insert into public.blocks (blocked_id) values ('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'anyone can block someone');
select is((select count(*)::int from public.blocks), 1, 'the blocker sees their block');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.blocks), 0, 'the blocked person cannot see the block');
select is((select count(*)::int from public.follows where followee_id = 'cccccccc-0000-0000-0000-000000000003'), 0,
  'blocking removes the blocked person''s follow');
select throws_ok(
  $$ insert into public.follows (followee_id) values ('cccccccc-0000-0000-0000-000000000003') $$,
  '42501', null, 'a blocked person cannot follow again');
select is((select count(*)::int from public.vehicles where user_id = 'cccccccc-0000-0000-0000-000000000003'), 0,
  'a blocked person cannot see the blocker''s vehicles, even on a public profile');
delete from public.blocks where blocker_id = 'cccccccc-0000-0000-0000-000000000003';
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select is((select count(*)::int from public.blocks), 1, 'nobody can remove someone else''s block');
select throws_ok(
  $$ insert into public.follows (followee_id) values ('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', null, 'the blocker cannot follow the person they blocked either');

-- ---- Vehicles, gallery, and files belong to their owner ----
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.vehicles (user_id, model) values ('cccccccc-0000-0000-0000-000000000003', 'Fake') $$,
  '42501', null, 'nobody can add a vehicle to someone else''s profile');
select throws_ok(
  $$ insert into public.vehicle_photos (vehicle_id, path) values ('c0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000001/x.webp') $$,
  '42501', null, 'nobody can add photos to someone else''s vehicle');
select throws_ok(
  $$ update public.profiles set avatar_path = 'cccccccc-0000-0000-0000-000000000003/avatar.webp' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'an avatar must be in your own folder');
select throws_ok(
  $$ insert into public.vehicles (model) select 'Car ' || n from generate_series(1, 11) n $$,
  '23514', null, 'at most 10 vehicles per person');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('profile-media', 'aaaaaaaa-0000-0000-0000-000000000001/g1.webp') $$,
  'anyone can upload to their own folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('profile-media', 'cccccccc-0000-0000-0000-000000000003/sneaky.webp') $$,
  '42501', null, 'nobody can upload into someone else''s folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('profile-images', 'cccccccc-0000-0000-0000-000000000003/avatar.webp') $$,
  '42501', null, 'nobody can replace someone else''s avatar');

select * from finish();
rollback;
