-- Web push (plan 11.43): a member's devices get each new notification as a
-- phone or desktop notification. Devices are stored here; a trigger calls the
-- push sender (supabase/functions/push) for each new notification row. A chat
-- pushes once until it's read (later messages update the same row).

create extension if not exists pg_net with schema extensions;

-- One row per device (browser push subscription). Signing in as someone else
-- on the same device moves it to them.
create table public.push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "See your own devices" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.push_subscriptions to authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'sign in and set up a profile first' using errcode = '42501';
  end if;
  if (select count(*) from public.push_subscriptions where user_id = me) >= 10 then
    delete from public.push_subscriptions
    where endpoint = (select endpoint from public.push_subscriptions where user_id = me order by created_at limit 1);
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, me, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end;
$$;
revoke all on function public.save_push_subscription(text, text, text) from public;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$ delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid(); $$;
revoke all on function public.remove_push_subscription(text) from public;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- Where the push sender lives. Local development can point this elsewhere.
create table private.app_settings (key text primary key, value text not null);
insert into private.app_settings (key, value)
values ('push_function_url', 'https://ggbdcdkzvubcgzkdkrwn.supabase.co/functions/v1/push');

alter table public.notifications add column pushed_at timestamptz;

create or replace function private.push_notification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  url text := (select value from private.app_settings where key = 'push_function_url');
begin
  if url is not null and exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    perform net.http_post(
      url := url,
      body := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
  return null;
end;
$$;
revoke all on function private.push_notification() from public;
create trigger notifications_push after insert on public.notifications
  for each row execute function private.push_notification();

-- The push sender's only ways in (service role only; it has no table grants).
-- Claim a fresh, unsent, unread notification and get what to send and where.
create or replace function public.claim_push(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n public.notifications;
begin
  update public.notifications set pushed_at = now()
  where id = p_id and pushed_at is null and read_at is null and created_at > now() - interval '15 minutes'
  returning * into n;
  if n.id is null then return null; end if;
  return to_jsonb(n) || jsonb_build_object(
    'actor', (select jsonb_build_object('username', username, 'display_name', display_name) from public.profiles where id = n.actor_id),
    'group', (select jsonb_build_object('short_id', short_id) from public.groups where id = n.group_id),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
                         from public.push_subscriptions where user_id = n.user_id), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.claim_push(uuid) from public, anon, authenticated;
grant execute on function public.claim_push(uuid) to service_role;

-- Forget a device the browser says is gone.
create or replace function public.drop_push_device(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$ delete from public.push_subscriptions where endpoint = p_endpoint; $$;
revoke all on function public.drop_push_device(text) from public, anon, authenticated;
grant execute on function public.drop_push_device(text) to service_role;
