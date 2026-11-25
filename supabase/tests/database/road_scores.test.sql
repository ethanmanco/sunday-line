-- Security tests for the road score queue (docs/plan.md 11.27).
begin;
select plan(17);

insert into auth.users (id, email) values
  ('9a000000-0000-0000-0000-000000000001', 'rs_owner@example.test'),
  ('9b000000-0000-0000-0000-000000000002', 'rs_other@example.test');
insert into public.profiles (id, username, display_name, created_at) values
  ('9a000000-0000-0000-0000-000000000001', 'rs_owner', 'Owner', now() - interval '30 days'),
  ('9b000000-0000-0000-0000-000000000002', 'rs_other', 'Other', now() - interval '30 days');

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to anon, authenticated, service_role;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k = key $$;

select pg_temp.act_as('9a000000-0000-0000-0000-000000000001');
with x as (insert into public.spots (kind, name, lat, lng, line) values ('road', 'My back road', 32.4, -93.8, '_p~iF~ps|U_ulLnnqC_mqNvxq`@') returning id)
insert into ids select 'road', id from x;
with x as (insert into public.spots (kind, name, category, lat, lng) values ('point', 'A lot', 'meetup', 32.4, -93.8) returning id)
insert into ids select 'point', id from x;

select is(public.request_road_score(pg_temp.id('road'))::text, 'queued', 'owners ask for a road to be scored');
select is(public.request_road_score(pg_temp.id('road'))::text, 'queued', 'asking again keeps the place in line');
select throws_ok($$ select public.request_road_score(pg_temp.id('point')) $$, '22023', null, 'places are not scored');
select throws_ok($$ insert into public.road_scores (spot_id, status) values (pg_temp.id('point'), 'done') $$, '42501', null,
  'nobody writes scores directly');
select throws_ok($$ select * from public.claim_score_jobs(5) $$, '42501', null, 'people cannot claim scoring jobs');
select throws_ok($$ select public.finish_score_job(pg_temp.id('road'), '{"overall": 99}', '{}') $$, '42501', null,
  'people cannot write a finished score');

select pg_temp.act_as('9b000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.request_road_score(pg_temp.id('road')) $$, '42501', null, 'someone outside its groups can''t ask');
select is((select count(*)::int from public.road_scores where spot_id = pg_temp.id('road')), 0,
  'a private spot''s score is hidden like the spot');

-- The scoring job.
select set_config('role', 'service_role', true);
select is((select count(*)::int from public.claim_score_jobs(5) where spot_id = pg_temp.id('road')), 1, 'the job claims queued requests');
select is((select status::text from public.road_scores where spot_id = pg_temp.id('road')), 'scoring', 'claimed requests are marked');
select is((select count(*)::int from public.claim_score_jobs(5)), 0, 'a claimed request is not handed out twice');
select lives_ok($$ select public.finish_score_job(pg_temp.id('road'), '{"overall": 61, "twisty": 70}', '{"miles": 3.1}') $$,
  'the job writes the score');

select pg_temp.act_as('9a000000-0000-0000-0000-000000000001');
select is((select (scores->>'overall')::int from public.road_scores where spot_id = pg_temp.id('road')), 61, 'the owner sees the score');
update public.spots set show_on_profile = true where id = pg_temp.id('road');
select pg_temp.act_as('9b000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.road_scores where spot_id = pg_temp.id('road')), 1,
  'once the spot is visible, so is its score');

select pg_temp.act_as('9a000000-0000-0000-0000-000000000001');
update public.spots set line = '_p~iF~ps|U_ulLnnqC' where id = pg_temp.id('road');
select is((select count(*)::int from public.road_scores where spot_id = pg_temp.id('road')), 0, 'a changed line clears the old score');

-- Twenty a day.
select set_config('role', 'postgres', true);
with s as (
  insert into public.spots (owner_id, kind, name, lat, lng, line)
  select '9a000000-0000-0000-0000-000000000001', 'road', 'Road ' || g, 32.4, -93.8, '_p~iF~ps|U_ulLnnqC'
  from generate_series(1, 20) g returning id
)
insert into public.road_scores (spot_id, status, requested_by, requested_at)
select id, 'done', '9a000000-0000-0000-0000-000000000001', now() from s;
select pg_temp.act_as('9a000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.request_road_score(pg_temp.id('road')) $$, '23514', null, 'twenty requests a day at most');

-- A job that died on its last try is marked failed, not left "scoring" (11.82).
select set_config('role', 'postgres', true);
update public.road_scores set status = 'scoring', attempts = 3, started_at = now() - interval '2 hours'
where spot_id = (select id from public.spots where name = 'Road 1');
select set_config('role', 'service_role', true);
select count(*) from public.claim_score_jobs(5);
select set_config('role', 'postgres', true);
select is((select status::text from public.road_scores where spot_id = (select id from public.spots where name = 'Road 1')), 'failed',
  'a job that died on its last try is marked failed');

select * from finish();
rollback;
