-- Security tests for spots, the public review, and group pictures.
begin;
select plan(37);

-- O organizes a private group, M is a member, X is an outsider, A is a site
-- admin, N has a brand-new account.
insert into auth.users (id, email) values
  ('5a000000-0000-0000-0000-000000000001', 'o@example.test'),
  ('5b000000-0000-0000-0000-000000000002', 'm@example.test'),
  ('5c000000-0000-0000-0000-000000000003', 'x@example.test'),
  ('5d000000-0000-0000-0000-000000000004', 'a@example.test'),
  ('5e000000-0000-0000-0000-000000000005', 'n@example.test');
insert into public.profiles (id, username, display_name, created_at) values
  ('5a000000-0000-0000-0000-000000000001', 's_org', 'Org', now() - interval '30 days'),
  ('5b000000-0000-0000-0000-000000000002', 's_mem', 'Mem', now() - interval '30 days'),
  ('5c000000-0000-0000-0000-000000000003', 's_out', 'Out', now() - interval '30 days'),
  ('5d000000-0000-0000-0000-000000000004', 's_adm', 'Adm', now() - interval '30 days'),
  ('5e000000-0000-0000-0000-000000000005', 's_new', 'New', now());
insert into private.site_admins (user_id) values ('5d000000-0000-0000-0000-000000000004');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.act_anon() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to anon, authenticated;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k = key $$;
create or replace function pg_temp.status(key text) returns text language sql as $$
  select public_status::text from public.spots where id = (select v from ids where k = key)
$$;

-- ---- A private group with spots ----
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
create temp table made as select public.create_group('Spot Club', null, null, 'private', 'request') as sid;
insert into ids select 'g', g.id from public.groups g join made on g.short_id = made.sid;
select set_config('role', 'postgres', true);
insert into public.group_members (group_id, user_id) values (pg_temp.id('g'), '5b000000-0000-0000-0000-000000000002');

select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
with x as (insert into public.spots (kind, name, category, lat, lng, group_id) values ('point', 'Coffee meetup', 'meetup', 32.5, -93.75, pg_temp.id('g')) returning id)
insert into ids select 'org_spot', id from x;
select is((select group_status::text from public.spots where id = pg_temp.id('org_spot')), 'accepted', 'organizers add group spots directly');

select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
with x as (insert into public.spots (kind, name, category, lat, lng, group_id) values ('point', 'Scenic overlook', 'scenic', 32.6, -93.8, pg_temp.id('g')) returning id)
insert into ids select 'mem_spot', id from x;
select is((select group_status::text from public.spots where id = pg_temp.id('mem_spot')), 'proposed', 'members propose spots');
select is((select count(*)::int from public.spots where group_id = pg_temp.id('g')), 2, 'members see accepted spots and their own proposals');
select throws_ok($$ select public.accept_group_spot(pg_temp.id('mem_spot')) $$, '42501', null, 'members cannot accept their own proposal');
select throws_ok($$ update public.spots set group_status = 'accepted' where id = pg_temp.id('mem_spot') $$, '42501', null,
  'nobody sets group status directly');
select throws_ok($$ update public.spots set public_status = 'approved' where id = pg_temp.id('mem_spot') $$, '42501', null,
  'nobody puts a spot on the public map directly');
select throws_ok($$ select public.submit_spot_public(pg_temp.id('org_spot')) $$, '42501', null,
  'members cannot publish someone else''s group spot');

select pg_temp.act_as('5c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.spots where group_id = pg_temp.id('g')), 0, 'outsiders never see a private group''s spots');
select throws_ok(
  $$ insert into public.spots (kind, name, category, lat, lng, group_id) values ('point', 'Sneaky', 'other', 32.5, -93.7, pg_temp.id('g')) $$,
  '42501', null, 'outsiders cannot add spots to a group');

select pg_temp.act_anon();
select is((select count(*)::int from public.spots where owner_id::text like '5_000000-%'), 0, 'signed-out visitors see no group or personal spots');

select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.accept_group_spot(pg_temp.id('mem_spot')) $$, 'the organizer accepts a proposal');

-- ---- Personal spots and the profile setting ----
select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
with x as (insert into public.spots (kind, name, category, lat, lng, show_on_profile) values ('point', 'My gas stop', 'gas', 32.4, -93.6, true) returning id)
insert into ids select 'mine', id from x;
select pg_temp.act_as('5c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.spots where id = pg_temp.id('mine')), 1, 'spots picked for the profile are visible');
select is((select count(*)::int from public.spots where id = pg_temp.id('mem_spot')), 0, 'unpicked spots stay private');

select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
update public.profiles set spots_display = 'none' where id = '5b000000-0000-0000-0000-000000000002';
select pg_temp.act_as('5c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.spots where id = pg_temp.id('mine')), 0, '"none" hides every spot from the profile');

select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
update public.profiles set spots_display = 'all', is_private = true where id = '5b000000-0000-0000-0000-000000000002';
select pg_temp.act_as('5c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.spots where owner_id = '5b000000-0000-0000-0000-000000000002'), 0,
  'a private profile''s spots stay hidden from non-followers');

select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
update public.profiles set spots_display = 'groups', is_private = false where id = '5b000000-0000-0000-0000-000000000002';
select throws_ok($$ insert into public.profile_spot_groups (group_id) values (pg_temp.id('g')) $$, '42501', null,
  'a private group can''t be picked for a profile');
select pg_temp.act_as('5c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.spots where owner_id = '5b000000-0000-0000-0000-000000000002'), 0,
  'spots in a private group never show on a profile');
select is((select count(*)::int from public.spots where id = pg_temp.id('org_spot')), 0,
  'other people''s spots in that group stay private');
select throws_ok(
  $$ insert into public.profile_spot_groups (user_id, group_id) values ('5b000000-0000-0000-0000-000000000002', pg_temp.id('g')) $$,
  '42501', null, 'nobody changes someone else''s profile setting');

-- ---- The public map ----
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
select is(public.submit_spot_public(pg_temp.id('org_spot'))::text, 'approved', 'a spot that passes the checks goes straight to the public map');
with x as (insert into public.spots (kind, name, category, lat, lng, description) values ('point', 'Cars and coffee', 'meetup', 32.51, -93.71, 'See www.example.com') returning id)
insert into ids select 'linky', id from x;
with x as (insert into public.spots (kind, name, category, lat, lng) values ('point', 'Nurburgring', 'track', 50.33, 6.94) returning id)
insert into ids select 'far', id from x;
select is(public.submit_spot_public(pg_temp.id('linky'))::text, 'pending', 'a link sends it to a person');
select is(public.submit_spot_public(pg_temp.id('far'))::text, 'pending', 'outside the United States sends it to a person');
select matches((select public_note from public.spots where id = pg_temp.id('linky')), 'link', 'the reason is recorded');

select pg_temp.act_as('5e000000-0000-0000-0000-000000000005');
with x as (insert into public.spots (kind, name, category, lat, lng) values ('point', 'Lake view', 'scenic', 32.7, -93.9) returning id)
insert into ids select 'newbie', id from x;
select is(public.submit_spot_public(pg_temp.id('newbie'))::text, 'pending', 'brand-new accounts wait for a person');

select pg_temp.act_anon();
select is((select count(*)::int from public.spots where public_status = 'approved' and owner_id::text like '5_000000-%'), 1, 'signed-out visitors see approved spots');
select is((select count(*)::int from public.spots where id = pg_temp.id('linky')), 0, 'waiting spots are not public');

select pg_temp.act_as('5c000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.review_spot(pg_temp.id('linky'), true, null) $$, '42501', null, 'only a site admin reviews');
select is(public.am_site_admin(), false, 'regular people are not site admins');

select pg_temp.act_as('5d000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.spots where public_status = 'pending' and owner_id::text like '5_000000-%'), 3, 'the site admin sees the review queue');
select lives_ok($$ select public.review_spot(pg_temp.id('linky'), true, 'Fine, it is a real meetup') $$, 'the site admin approves');
select is(pg_temp.status('linky'), 'approved', 'approved spots go public');

select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
update public.spots set description = 'Join us at bit.ly/xyz' where id = pg_temp.id('org_spot');
select is(pg_temp.status('org_spot'), 'pending', 'editing a public spot runs the checks again');

-- ---- What a profile shows ----
select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
update public.profiles set spots_display = 'selected' where id = '5b000000-0000-0000-0000-000000000002';
update public.spots set show_on_profile = false where owner_id = '5b000000-0000-0000-0000-000000000002';
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.profile_spots('5b000000-0000-0000-0000-000000000002') where group_id is not null), 0,
  'sharing a group doesn''t put someone''s group spots on their profile');

-- ---- Group pictures ----
select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('group-images', pg_temp.id('g') || '/avatar-1.webp') $$,
  '42501', null, 'members cannot change group pictures');
select pg_temp.act_as('5a000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('group-images', pg_temp.id('g') || '/avatar-1.webp'),
                                                          ('group-images', pg_temp.id('g') || '/source-avatar-1.webp') $$,
  'the organizer uploads group pictures');
select pg_temp.act_as('5c000000-0000-0000-0000-000000000003');
select is((select count(*)::int from storage.objects where bucket_id = 'group-images'), 0, 'outsiders cannot load a private group''s pictures');
select pg_temp.act_as('5b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from storage.objects where bucket_id = 'group-images'), 1, 'members see the picture but not the uncropped original');

select * from finish();
rollback;
