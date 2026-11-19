-- Library profile pictures (docs/plan.md 11.28).
begin;
select plan(4);
insert into auth.users (id, email) values ('a1000000-0000-0000-0000-000000000001', 'av@example.test');
insert into public.profiles (id, username, display_name) values ('a1000000-0000-0000-0000-000000000001', 'av_tester', 'Av');
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ update public.profiles set avatar_preset = 'lib:nissan-skyline-gtr-1' where id = auth.uid() $$, 'a library picture can be picked');
select lives_ok($$ update public.profiles set avatar_preset = 'roadster-orange' where id = auth.uid() $$, 'old drawings still work');
select throws_ok($$ update public.profiles set avatar_preset = 'lib:../../etc' where id = auth.uid() $$, '23514', null, 'library names are only letters, numbers, and dashes');
select throws_ok($$ update public.profiles set avatar_preset = 'https://example.com/x.png' where id = auth.uid() $$, '23514', null, 'no outside pictures');
select * from finish();
rollback;
