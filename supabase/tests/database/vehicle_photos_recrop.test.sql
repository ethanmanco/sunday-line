-- Vehicle photos and the owner-only re-crop sources.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test');
insert into public.profiles (id, username, display_name, is_private) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice', 'Alice', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob', 'Bob', true);
insert into public.vehicles (id, user_id, model) values
  ('11111111-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'M2'),
  ('22222222-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'Miata');
insert into public.vehicle_photos (vehicle_id, user_id, path) values
  ('22222222-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002/v1.webp');
insert into storage.objects (bucket_id, name) values
  ('profile-media', 'aaaaaaaa-0000-0000-0000-000000000001/source-avatar-1.webp'),
  ('profile-media', 'aaaaaaaa-0000-0000-0000-000000000001/photo-1.webp');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.vehicle_photos (vehicle_id, path)
     select '11111111-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001/v' || n || '.webp' from generate_series(1, 8) n $$,
  'up to 8 photos on your own vehicle');
select throws_ok(
  $$ insert into public.vehicle_photos (vehicle_id, path) values ('11111111-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001/v9.webp') $$,
  '23514', null, 'no more than 8 photos per vehicle');
select throws_ok(
  $$ insert into public.vehicle_photos (vehicle_id, path) values ('22222222-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001/x.webp') $$,
  '42501', null, 'nobody can add photos to someone else''s vehicle');
select is((select count(*)::int from public.vehicle_photos where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'a private profile''s vehicle photos stay hidden from non-followers');
select is((select count(*)::int from storage.objects where name like 'aaaaaaaa-0000-0000-0000-000000000001/source-%'), 1,
  'the owner can open their own uncropped picture');
select throws_ok(
  $$ update public.profiles set avatar_source_path = 'bbbbbbbb-0000-0000-0000-000000000002/source-avatar-1.webp' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'an uncropped picture must be in your own folder');

select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*)::int from storage.objects where name like 'aaaaaaaa-0000-0000-0000-000000000001/source-%'), 0,
  'nobody else can open someone''s uncropped picture');
select is((select count(*)::int from storage.objects where name = 'aaaaaaaa-0000-0000-0000-000000000001/photo-1.webp'), 1,
  'other photos on a public profile stay visible');

select pg_temp.act_anon();
select is((select count(*)::int from storage.objects where name like 'aaaaaaaa-0000-0000-0000-000000000001/source-%'), 0,
  'signed-out visitors cannot open uncropped pictures');

select * from finish();
rollback;
