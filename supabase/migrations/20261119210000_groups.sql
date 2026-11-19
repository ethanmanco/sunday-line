-- Car and bike groups (docs/plan.md sections 4 and 11.7).
--
-- * Roles: one organizer, moderators, members. The organizer picks each
--   moderator's permissions: approve requests, remove members, manage invite
--   links (events, private events, and spots arrive with events).
-- * Public groups are visible to everyone. The organizer chooses whether anyone
--   can join or people ask first. Private groups are visible to members only
--   and joined through invite links.
-- * Membership only changes through the functions below, which check the
--   caller's role every time.
-- * Invite links: 128 random bits, stored only as a SHA-256 hash, shown once.

create type public.group_visibility as enum ('public', 'private');
create type public.group_join_policy as enum ('open', 'request');
create type public.group_role as enum ('organizer', 'moderator', 'member');

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  short_id text not null unique,
  name text not null check (char_length(btrim(name)) between 3 and 60),
  description text check (char_length(description) <= 1000),
  home_area text check (char_length(home_area) <= 80),
  visibility public.group_visibility not null default 'public',
  join_policy public.group_join_policy not null default 'request',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger groups_touch before update on public.groups
  for each row execute function public.touch_updated_at();

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  permissions text[] not null default '{}'
    check (permissions <@ array['approve', 'remove', 'invites', 'events', 'private_events', 'spots']::text[]),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create unique index one_organizer_per_group on public.group_members (group_id) where role = 'organizer';
create index group_members_user on public.group_members (user_id);

create table public.join_requests (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message text check (char_length(message) <= 300),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  label text check (char_length(label) <= 60),
  expires_at timestamptz,
  max_uses int check (max_uses between 1 and 10000),
  use_count int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_invites_group on public.group_invites (group_id);

-- Token hashes live outside the API entirely.
create table private.invite_tokens (
  invite_id uuid primary key references public.group_invites (id) on delete cascade,
  token_hash bytea not null unique
);

-- ---------------------------------------------------------------------------
-- Helpers.
create or replace function private.group_role(g uuid)
returns public.group_role
language sql stable security definer set search_path = ''
as $$
  select role from public.group_members where group_id = g and user_id = auth.uid();
$$;

create or replace function private.is_member(g uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid());
$$;

-- The organizer has every permission; moderators have the ones they were given.
create or replace function private.has_perm(g uuid, perm text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = g and user_id = auth.uid()
      and (role = 'organizer' or (role = 'moderator' and perm = any (permissions)))
  );
$$;

create or replace function private.random_token(nbytes int)
returns text
language sql volatile set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(nbytes), 'base64'), '+/', '-_'), '=');
$$;

revoke all on function private.group_role(uuid) from public;
revoke all on function private.is_member(uuid) from public;
revoke all on function private.has_perm(uuid, text) from public;
revoke all on function private.random_token(int) from public;
grant execute on function private.group_role(uuid) to anon, authenticated;
grant execute on function private.is_member(uuid) to anon, authenticated;
grant execute on function private.has_perm(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row rules.
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.join_requests enable row level security;
alter table public.group_invites enable row level security;
alter table private.invite_tokens enable row level security;

create policy "Public groups are visible; private ones to members" on public.groups
  for select to anon, authenticated using (visibility = 'public' or private.is_member(id));
create policy "Organizer edits the group" on public.groups
  for update to authenticated using (private.group_role(id) = 'organizer') with check (private.group_role(id) = 'organizer');
create policy "Organizer deletes the group" on public.groups
  for delete to authenticated using (private.group_role(id) = 'organizer');

grant select on public.groups to anon, authenticated;
grant update (name, description, home_area, visibility, join_policy) on public.groups to authenticated;
grant delete on public.groups to authenticated;

create policy "Members see who's in their group" on public.group_members
  for select to authenticated using (private.is_member(group_id));
create policy "Leave a group (organizers hand it off first)" on public.group_members
  for delete to authenticated using (user_id = (select auth.uid()) and role <> 'organizer');
grant select, delete on public.group_members to authenticated;

create policy "See your own requests; approvers see the group's" on public.join_requests
  for select to authenticated using (user_id = (select auth.uid()) or private.has_perm(group_id, 'approve'));
create policy "Ask to join a public group" on public.join_requests
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and not private.is_member(group_id)
    and exists (select 1 from public.groups g where g.id = group_id and g.visibility = 'public' and g.join_policy = 'request')
  );
create policy "Withdraw your request" on public.join_requests
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.join_requests to authenticated;
grant insert (group_id, user_id, message) on public.join_requests to authenticated;

create policy "Invite managers see the group's links" on public.group_invites
  for select to authenticated using (private.has_perm(group_id, 'invites'));
grant select on public.group_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Functions people call.

create or replace function public.create_group(
  p_name text, p_description text, p_home_area text,
  p_visibility public.group_visibility, p_join_policy public.group_join_policy
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g uuid;
  sid text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'Set up your profile first.' using errcode = '42501';
  end if;
  if (select count(*) from public.group_members where user_id = me and role = 'organizer') >= 20 then
    raise exception 'You can organize up to 20 groups.' using errcode = '23514';
  end if;
  sid := private.random_token(9);
  insert into public.groups (short_id, name, description, home_area, visibility, join_policy, created_by)
  values (sid, btrim(p_name), nullif(btrim(p_description), ''), nullif(btrim(p_home_area), ''), p_visibility, p_join_policy, me)
  returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, me, 'organizer');
  return sid;
end;
$$;

create or replace function public.join_group(p_group uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'Set up your profile first.' using errcode = '42501';
  end if;
  if private.is_member(p_group) then return; end if;
  if not exists (select 1 from public.groups where id = p_group and visibility = 'public' and join_policy = 'open') then
    raise exception 'This group needs an invite or approval.' using errcode = '42501';
  end if;
  insert into public.group_members (group_id, user_id) values (p_group, me);
  delete from public.join_requests where group_id = p_group and user_id = me;
end;
$$;

create or replace function public.decide_join_request(p_group uuid, p_user uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_perm(p_group, 'approve') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.join_requests where group_id = p_group and user_id = p_user) then
    raise exception 'No such request.' using errcode = 'P0002';
  end if;
  delete from public.join_requests where group_id = p_group and user_id = p_user;
  if p_approve then
    insert into public.group_members (group_id, user_id) values (p_group, p_user) on conflict do nothing;
  end if;
end;
$$;

create or replace function public.create_invite(p_group uuid, p_label text, p_expires_at timestamptz, p_max_uses int)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  tok text;
  inv uuid;
begin
  if not private.has_perm(p_group, 'invites') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if (select count(*) from public.group_invites where group_id = p_group and revoked_at is null) >= 50 then
    raise exception 'Too many open invite links. Revoke some first.' using errcode = '23514';
  end if;
  tok := private.random_token(16);
  insert into public.group_invites (group_id, created_by, label, expires_at, max_uses)
  values (p_group, auth.uid(), nullif(btrim(p_label), ''), p_expires_at, p_max_uses)
  returning id into inv;
  insert into private.invite_tokens (invite_id, token_hash) values (inv, extensions.digest(tok, 'sha256'));
  return tok;
end;
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g uuid;
begin
  select group_id into g from public.group_invites where id = p_invite;
  if g is null or not private.has_perm(g, 'invites') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.group_invites set revoked_at = now() where id = p_invite and revoked_at is null;
end;
$$;

-- What an invite link shows before joining: the group's name and size only.
create or replace function public.invite_preview(p_token text)
returns table (group_name text, short_id text, visibility public.group_visibility, member_count bigint, usable boolean)
language sql stable security definer set search_path = ''
as $$
  select g.name, g.short_id, g.visibility,
         (select count(*) from public.group_members m where m.group_id = g.id),
         (i.revoked_at is null and (i.expires_at is null or i.expires_at > now())
          and (i.max_uses is null or i.use_count < i.max_uses))
  from private.invite_tokens t
  join public.group_invites i on i.id = t.invite_id
  join public.groups g on g.id = i.group_id
  where t.token_hash = extensions.digest(p_token, 'sha256');
$$;

create or replace function public.redeem_invite(p_token text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  inv public.group_invites%rowtype;
  sid text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'Set up your profile first.' using errcode = '42501';
  end if;
  -- Lock the invite so its use limit holds when several people join at once.
  select i.* into inv
  from private.invite_tokens t join public.group_invites i on i.id = t.invite_id
  where t.token_hash = extensions.digest(p_token, 'sha256')
  for update of i;
  if inv.id is null then
    raise exception 'This invite link doesn''t work.' using errcode = 'P0002';
  end if;
  select short_id into sid from public.groups where id = inv.group_id;
  if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = me) then
    return sid;
  end if;
  if inv.revoked_at is not null or (inv.expires_at is not null and inv.expires_at <= now())
     or (inv.max_uses is not null and inv.use_count >= inv.max_uses) then
    raise exception 'This invite link has expired.' using errcode = '42501';
  end if;
  insert into public.group_members (group_id, user_id) values (inv.group_id, me);
  update public.group_invites set use_count = use_count + 1 where id = inv.id;
  delete from public.join_requests where group_id = inv.group_id and user_id = me;
  return sid;
end;
$$;

-- Organizer only: make someone a moderator with chosen permissions, or a member.
create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role public.group_role, p_permissions text[])
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if private.group_role(p_group) is distinct from 'organizer' then
    raise exception 'Only the organizer can change roles.' using errcode = '42501';
  end if;
  if p_user = auth.uid() or p_role = 'organizer' then
    raise exception 'Use hand off to change the organizer.' using errcode = '42501';
  end if;
  update public.group_members
  set role = p_role,
      permissions = case when p_role = 'moderator' then coalesce(p_permissions, '{}') else '{}' end
  where group_id = p_group and user_id = p_user;
  if not found then
    raise exception 'Not a member.' using errcode = 'P0002';
  end if;
end;
$$;

-- The organizer removes anyone; moderators with "remove" remove members only.
create or replace function public.remove_member(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  mine public.group_role := private.group_role(p_group);
  theirs public.group_role;
begin
  select role into theirs from public.group_members where group_id = p_group and user_id = p_user;
  if theirs is null then
    raise exception 'Not a member.' using errcode = 'P0002';
  end if;
  if theirs = 'organizer' or p_user = auth.uid() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not (mine = 'organizer' or (theirs = 'member' and private.has_perm(p_group, 'remove'))) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
end;
$$;

-- Hand the organizer role to another member; the old organizer becomes a
-- moderator with every permission.
create or replace function public.transfer_organizer(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if private.group_role(p_group) is distinct from 'organizer' then
    raise exception 'Only the organizer can hand off.' using errcode = '42501';
  end if;
  if p_user = auth.uid() or not exists (select 1 from public.group_members where group_id = p_group and user_id = p_user) then
    raise exception 'Pick another member.' using errcode = 'P0002';
  end if;
  update public.group_members
  set role = 'moderator', permissions = array['approve', 'remove', 'invites', 'events', 'private_events', 'spots']
  where group_id = p_group and user_id = auth.uid();
  update public.group_members set role = 'organizer', permissions = '{}' where group_id = p_group and user_id = p_user;
end;
$$;

-- Member count: anyone for public groups, members for private ones.
create or replace function public.group_member_count(p_group uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*) from public.group_members m
  where m.group_id = p_group
    and exists (select 1 from public.groups g where g.id = p_group and (g.visibility = 'public' or private.is_member(p_group)));
$$;

revoke all on function public.create_group(text, text, text, public.group_visibility, public.group_join_policy) from public;
revoke all on function public.join_group(uuid) from public;
revoke all on function public.decide_join_request(uuid, uuid, boolean) from public;
revoke all on function public.create_invite(uuid, text, timestamptz, int) from public;
revoke all on function public.revoke_invite(uuid) from public;
revoke all on function public.invite_preview(text) from public;
revoke all on function public.redeem_invite(text) from public;
revoke all on function public.set_member_role(uuid, uuid, public.group_role, text[]) from public;
revoke all on function public.remove_member(uuid, uuid) from public;
revoke all on function public.transfer_organizer(uuid, uuid) from public;
revoke all on function public.group_member_count(uuid) from public;
grant execute on function public.create_group(text, text, text, public.group_visibility, public.group_join_policy) to authenticated;
grant execute on function public.join_group(uuid) to authenticated;
grant execute on function public.decide_join_request(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_invite(uuid, text, timestamptz, int) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.group_role, text[]) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_organizer(uuid, uuid) to authenticated;
grant execute on function public.group_member_count(uuid) to anon, authenticated;
