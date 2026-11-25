-- Heads-ups on your saved roads (plan 11.86).
begin;
select plan(6);

insert into auth.users (id, email) values
  ('6a000000-0000-0000-0000-000000000001', 'ha@example.test'),
  ('6b000000-0000-0000-0000-000000000002', 'hb@example.test');
insert into public.profiles (id, username, display_name) values
  ('6a000000-0000-0000-0000-000000000001', 'hu_saver', 'Saver'),
  ('6b000000-0000-0000-0000-000000000002', 'hu_poster', 'Poster');

-- A line from (32.5, -93.6) east to (32.51, -93.5).
select is((select count(*)::int from private.decode_line('_tjeE~fhzP?owHo}@owH')), 3, 'the line decodes to its three points');
select ok(private.meters_to_line('_tjeE~fhzP?owHo}@owH', -93.575, 32.5) < 5, 'a point on the line is 0 m from it');

insert into public.spots (id, owner_id, kind, name, lat, lng, line) values
  ('6f000000-0000-0000-0000-0000000000a1', '6a000000-0000-0000-0000-000000000001', 'road', 'Lake Loop', 32.5, -93.6, '_tjeE~fhzP?owHo}@owH');

-- Near the saved road (about 100 m off it).
insert into public.heads_ups (kind, lng, lat, created_by, expires_at)
values ('debris', -93.575, 32.5009, '6b000000-0000-0000-0000-000000000002', now() + interval '2 hours');
select is((select count(*)::int from public.notifications where user_id = '6a000000-0000-0000-0000-000000000001' and kind = 'heads_up_on_road'), 1,
  'a heads-up near your saved road notifies you');
select is((select actor_id from public.notifications where user_id = '6a000000-0000-0000-0000-000000000001' and kind = 'heads_up_on_road'), null,
  'without saying who posted it');

-- Far from it (about 2 km).
insert into public.heads_ups (kind, lng, lat, created_by, expires_at)
values ('police', -93.575, 32.52, '6b000000-0000-0000-0000-000000000002', now() + interval '2 hours');
select is((select count(*)::int from public.notifications where user_id = '6a000000-0000-0000-0000-000000000001' and kind = 'heads_up_on_road'), 1,
  'one 2 km away does not');

-- Your own heads-up.
insert into public.heads_ups (kind, lng, lat, created_by, expires_at)
values ('crash', -93.575, 32.5, '6a000000-0000-0000-0000-000000000001', now() + interval '2 hours');
select is((select count(*)::int from public.notifications where user_id = '6a000000-0000-0000-0000-000000000001' and kind = 'heads_up_on_road'), 1,
  'your own heads-up does not notify you');

select * from finish();
rollback;
