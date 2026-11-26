-- Slurs can't be usernames; curse words can (plan 11.92).
-- Same names as lib/__tests__/fixtures/username-slurs.json (the app test checks).
begin;
select plan(4);

select is(
  (select array_agg(n order by n) from unnest(array['nigger', 'n1gg3r', 'niiigga', 'big_nigga_7', 'n_i_g_g_e_r', 'nigguh', 'nig', 'faggot', 'f4gg0t', 'fag', 'big_fag', 'fag69', 'fagget', 'spic', 'spics', 'kike', 'coon', 'gook', 'chink', 'dyke', 'tranny', 'trannie', 'retard', 'retarded', 'wetback', 'beaner', 'towelhead', 'raghead', 'paki', 'jap', 'wop', 'negro']) n where not private.username_has_slur(n)),
  null,
  'every slur is caught'
);

select is(
  (select array_agg(n order by n) from unnest(array['fuck_yeah', 'shitbox_racer', 'damn_fast', 'asshole', 'bitchin_rides', 'dick_miata', 'spicy_miata', 'raccoon', 'coonhound', 'cocoon', 'montenegro', 'niger_river', 'nigeria', 'japan', 'japanese', 'pakistan', 'chinook', 'scunthorpe', 'fire_retardant', 'transport', 'fagan', 'spock', 'bigfoot', 'driver_123']) n where private.username_has_slur(n)),
  null,
  'curse words and ordinary words are fine'
);

insert into auth.users (id, email) values ('5a100000-0000-0000-0000-000000000001', 'slur@example.test');
select throws_like(
  $$insert into public.profiles (id, username, display_name) values ('5a100000-0000-0000-0000-000000000001', 'big_f4g', 'Someone')$$,
  '%username_not_allowed%',
  'the database refuses a slur as a username'
);
select lives_ok(
  $$insert into public.profiles (id, username, display_name) values ('5a100000-0000-0000-0000-000000000001', 'shitbox_racer', 'Someone')$$,
  'a curse word is a fine username'
);

select * from finish();
rollback;
