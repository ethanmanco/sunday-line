-- Spot group rules (plan 11.44). Run with: npx supabase test db
begin;
select plan(4);

insert into auth.users (id, email) values ('7a000000-0000-0000-0000-000000000001', 'gus@example.test');
insert into public.profiles (id, username, display_name) values ('7a000000-0000-0000-0000-000000000001', 'gus', 'Gus');
create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v text);
grant all on ids to authenticated;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from ids where k = key $$;

select pg_temp.act_as('7a000000-0000-0000-0000-000000000001');
insert into ids values ('pub1_s', public.create_group('Open Road One', null, null, 'public', 'open'));
insert into ids values ('pub1', (select id::text from public.groups where short_id = (select v from ids where k = 'pub1_s')));
insert into ids values ('pub2_s', public.create_group('Open Road Two', null, null, 'public', 'open'));
insert into ids values ('pub2', (select id::text from public.groups where short_id = (select v from ids where k = 'pub2_s')));
insert into ids values ('priv_s', public.create_group('Quiet Crew', null, null, 'private', 'request'));
insert into ids values ('priv', (select id::text from public.groups where short_id = (select v from ids where k = 'priv_s')));
with x as (insert into public.spots (kind, name, category, lat, lng) values ('point', 'Coffee lot', 'meetup', 32.5, -93.7) returning id)
insert into ids select 'spot', id::text from x;
with x as (insert into public.spots (kind, name, category, lat, lng) values ('point', 'Secret lot', 'meetup', 32.6, -93.6) returning id)
insert into ids select 'secret', id::text from x;

select public.add_spot_to_group(pg_temp.id('spot'), pg_temp.id('pub1'));
select is(public.add_spot_to_group(pg_temp.id('spot'), pg_temp.id('pub2'))::text, 'accepted', 'a spot can be in several public groups');
select is(public.add_spot_to_group(pg_temp.id('spot'), pg_temp.id('priv'))::text, 'accepted',
  'a public group''s spot can also go in a private group');
select public.add_spot_to_group(pg_temp.id('secret'), pg_temp.id('priv'));
select throws_ok($$ select public.add_spot_to_group(pg_temp.id('secret'), pg_temp.id('pub1')) $$, '23514', null,
  'a private group''s spot never goes in a public group');
select throws_ok($$ select public.add_spot_to_group(pg_temp.id('spot'), pg_temp.id('pub1')) $$, '23514', null,
  'once a spot is in a private group, it can''t join more public groups');

select * from finish();
rollback;
