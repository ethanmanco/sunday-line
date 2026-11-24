-- Local test data only (runs after `supabase db reset`, never on the live
-- database). Two members to sign in as: tester@example.test and
-- dupper@example.test. Sign-in is by email code; the local inbox is Mailpit at
-- http://127.0.0.1:54324. Profiles are a month old so rep (11.78) can be tested.

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('b04fdc39-5f3b-4004-b845-d08761b16ee2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'tester@example.test', now(), now() - interval '30 days', now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dupper@example.test', now(), now() - interval '30 days', now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u where u.email in ('tester@example.test', 'dupper@example.test');

insert into public.profiles (id, username, display_name, created_at) values
  ('b04fdc39-5f3b-4004-b845-d08761b16ee2', 'tester', 'Tester', now() - interval '30 days'),
  ('d1000000-0000-0000-0000-000000000001', 'dupper', 'Dupper', now() - interval '30 days');
