-- Profiles and follows (docs/plan.md 11.5, 11.6, 11.8, 11.14).
--
-- * Profiles gain an avatar (upload or preset), banner, bio, and a private switch.
-- * Vehicles and a photo gallery. On a private profile only approved followers
--   see them. Nobody sees them across a block, in either direction.
-- * Follows: instant for public profiles, a request the owner approves for
--   private ones.
-- * Blocks: private to the person who blocks. Blocking removes follows both ways
--   and stops new ones.
-- * Files: avatars and banners are public; vehicle and gallery photos follow the
--   same visibility as the rows that list them. Everyone writes only inside
--   their own folder.
-- Helper functions live in the `private` schema, which the API does not expose,
-- so nobody can call them directly to probe who blocked whom.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profiles: new columns. The old one-line vehicle_note moves into vehicles.
alter table public.profiles
  add column bio text check (char_length(bio) <= 300),
  add column avatar_path text,
  add column avatar_preset text check (avatar_preset ~ '^[a-z_]{3,20}-[a-z]{3,10}$'),
  add column banner_path text,
  add column is_private boolean not null default false,
  add constraint avatar_in_own_folder check (avatar_path is null or avatar_path ~ ('^' || id::text || '/[A-Za-z0-9_.-]{1,80}$')),
  add constraint banner_in_own_folder check (banner_path is null or banner_path ~ ('^' || id::text || '/[A-Za-z0-9_.-]{1,80}$'));

grant select (bio, avatar_path, avatar_preset, banner_path, is_private) on public.profiles to anon, authenticated;
grant insert (bio, avatar_path, avatar_preset, banner_path, is_private) on public.profiles to authenticated;
grant update (bio, avatar_path, avatar_preset, banner_path, is_private) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Blocks: only the blocker can see or change them.
create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id);
alter table public.blocks enable row level security;

create policy "See your own blocks" on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy "Block as yourself" on public.blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy "Unblock as yourself" on public.blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;

-- ---------------------------------------------------------------------------
-- Follows.
create type public.follow_status as enum ('pending', 'accepted');

create table public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status public.follow_status not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee on public.follows (followee_id, status);
alter table public.follows enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers (security definer: they read blocks and follows past RLS, and
-- return only a yes or no about the caller's own relationship).
create or replace function private.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- Can the caller see this person's vehicles, gallery, and follow lists?
create or replace function private.can_see_details(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select owner is not null and (
    owner = auth.uid()
    or (
      not private.blocked_between(auth.uid(), owner)
      and (
        not coalesce((select p.is_private from public.profiles p where p.id = owner), true)
        or exists (
          select 1 from public.follows f
          where f.follower_id = auth.uid() and f.followee_id = owner and f.status = 'accepted'
        )
      )
    )
  );
$$;

-- Same check for a storage path: the first folder is the owner's ID.
create or replace function private.can_see_path(path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  begin
    owner := split_part(path, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return private.can_see_details(owner);
end;
$$;

revoke all on function private.blocked_between(uuid, uuid) from public;
revoke all on function private.can_see_details(uuid) from public;
revoke all on function private.can_see_path(text) from public;
grant execute on function private.blocked_between(uuid, uuid) to anon, authenticated;
grant execute on function private.can_see_details(uuid) to anon, authenticated;
grant execute on function private.can_see_path(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Follow rules.
-- Rows are visible to the two people involved. Everyone else sees a follow only
-- when it is accepted, neither profile is private, and nobody involved has
-- blocked the viewer or been blocked by them.
create policy "See follows" on public.follows
  for select to anon, authenticated using (
    follower_id = (select auth.uid())
    or followee_id = (select auth.uid())
    or (
      status = 'accepted'
      and not exists (
        select 1 from public.profiles p
        where p.id in (follower_id, followee_id) and p.is_private
      )
      and not private.blocked_between((select auth.uid()), follower_id)
      and not private.blocked_between((select auth.uid()), followee_id)
    )
  );
create policy "Follow as yourself" on public.follows
  for insert to authenticated with check (follower_id = (select auth.uid()));
-- Only the person being followed approves a request.
create policy "Approve requests to follow you" on public.follows
  for update to authenticated
  using (followee_id = (select auth.uid()))
  with check (followee_id = (select auth.uid()) and status = 'accepted');
-- Unfollow, cancel a request, remove a follower, or decline a request.
create policy "Unfollow or remove a follower" on public.follows
  for delete to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

grant select, delete on public.follows to authenticated;
grant select on public.follows to anon;
grant insert (follower_id, followee_id) on public.follows to authenticated;
grant update (status) on public.follows to authenticated;

-- New follows: accepted right away for public profiles, a request for private
-- ones. Refused across a block. The status a client sends is ignored.
create or replace function private.follow_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.blocked_between(new.follower_id, new.followee_id) then
    raise exception 'You can''t follow this person.' using errcode = '42501';
  end if;
  new.status := case
    when (select p.is_private from public.profiles p where p.id = new.followee_id) then 'pending'::public.follow_status
    else 'accepted'::public.follow_status
  end;
  new.created_at := now();
  return new;
end;
$$;
create trigger follows_before_insert before insert on public.follows
  for each row execute function private.follow_before_insert();

-- Blocking removes follows in both directions.
create or replace function private.block_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id)
     or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return null;
end;
$$;
create trigger blocks_after_insert after insert on public.blocks
  for each row execute function private.block_after_insert();

-- Switching a profile to public approves its waiting requests.
create or replace function private.profile_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_private and not new.is_private then
    update public.follows set status = 'accepted' where followee_id = new.id and status = 'pending';
  end if;
  return null;
end;
$$;
create trigger profiles_after_update after update of is_private on public.profiles
  for each row execute function private.profile_after_update();

-- Follower and following counts (accepted only). Counts are shown even on
-- private profiles; the lists are not.
create or replace function public.follow_counts(person uuid)
returns table (followers bigint, following bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.follows where followee_id = person and status = 'accepted'),
    (select count(*) from public.follows where follower_id = person and status = 'accepted');
$$;
revoke all on function public.follow_counts(uuid) from public;
grant execute on function public.follow_counts(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vehicles: up to 10 per person.
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind public.vehicle_kind not null default 'car',
  year smallint check (year between 1885 and 2100),
  make text check (char_length(btrim(make)) between 1 and 40),
  model text not null check (char_length(btrim(model)) between 1 and 60),
  photo_path text,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint vehicle_photo_in_own_folder check (photo_path is null or photo_path ~ ('^' || user_id::text || '/[A-Za-z0-9_.-]{1,80}$'))
);
create index vehicles_user on public.vehicles (user_id, sort);
alter table public.vehicles enable row level security;

create policy "See vehicles you're allowed to" on public.vehicles
  for select to anon, authenticated using (private.can_see_details(user_id));
create policy "Add your own vehicles" on public.vehicles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Change your own vehicles" on public.vehicles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Remove your own vehicles" on public.vehicles
  for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.vehicles to anon, authenticated;
grant insert (user_id, kind, year, make, model, photo_path, sort) on public.vehicles to authenticated;
grant update (kind, year, make, model, photo_path, sort) on public.vehicles to authenticated;
grant delete on public.vehicles to authenticated;

-- ---------------------------------------------------------------------------
-- Gallery: up to 24 photos or GIFs per person.
create type public.media_kind as enum ('image', 'gif');

create table public.profile_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  path text not null,
  kind public.media_kind not null,
  caption text check (char_length(caption) <= 200),
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint media_in_own_folder check (path ~ ('^' || user_id::text || '/[A-Za-z0-9_.-]{1,80}$'))
);
create index profile_media_user on public.profile_media (user_id, sort, created_at);
alter table public.profile_media enable row level security;

create policy "See photos you're allowed to" on public.profile_media
  for select to anon, authenticated using (private.can_see_details(user_id));
create policy "Add your own photos" on public.profile_media
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Change your own photos" on public.profile_media
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Remove your own photos" on public.profile_media
  for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.profile_media to anon, authenticated;
grant insert (user_id, path, kind, caption, sort) on public.profile_media to authenticated;
grant update (caption, sort) on public.profile_media to authenticated;
grant delete on public.profile_media to authenticated;

-- Per-person limits.
create or replace function private.enforce_row_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  cap int := tg_argv[0]::int;
begin
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into n using new.user_id;
  if n >= cap then
    raise exception 'Limit of % reached.', cap using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger vehicles_limit before insert on public.vehicles
  for each row execute function private.enforce_row_limit('10');
create trigger profile_media_limit before insert on public.profile_media
  for each row execute function private.enforce_row_limit('24');

-- Move each old one-line "what I drive" into a vehicle: "2020 BMW M2" becomes
-- year 2020, make BMW, model M2. A single word ("Miata") becomes the model.
insert into public.vehicles (user_id, kind, year, make, model)
select
  p.id,
  'car',
  case when m[1] is not null and m[1]::int between 1885 and 2100 then m[1]::smallint end,
  case when nullif(btrim(m[3]), '') is not null then left(m[2], 40) end,
  left(coalesce(nullif(btrim(m[3]), ''), m[2]), 60)
from public.profiles p
cross join lateral regexp_match(btrim(p.vehicle_note), '^(?:(\d{4})\s+)?(\S+)\s*(.*)$') as m
where nullif(btrim(p.vehicle_note), '') is not null;

revoke select (vehicle_note) on public.profiles from anon, authenticated;
revoke insert (vehicle_note) on public.profiles from authenticated;
revoke update (vehicle_note) on public.profiles from authenticated;
alter table public.profiles drop column vehicle_note;

-- ---------------------------------------------------------------------------
-- File storage.
-- profile-images: avatars and banners. Public, 5 MB each.
-- profile-media: vehicle and gallery photos. Not public: reading a file needs
-- the same permission as seeing the row that lists it. 8 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('profile-images', 'profile-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('profile-media', 'profile-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- How many files someone has in a bucket (caps folder size, since a file can be
-- uploaded before any row points at it).
create or replace function private.my_file_count(bucket text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from storage.objects
  where bucket_id = bucket and split_part(name, '/', 1) = auth.uid()::text;
$$;
revoke all on function private.my_file_count(text) from public;
grant execute on function private.my_file_count(text) to authenticated;

create policy "Profile images are public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'profile-images');
create policy "Upload profile images to your own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-images'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and private.my_file_count('profile-images') < 10
  );
create policy "Change your own profile images" on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-images' and split_part(name, '/', 1) = (select auth.uid())::text)
  with check (bucket_id = 'profile-images' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy "Remove your own profile images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-images' and split_part(name, '/', 1) = (select auth.uid())::text);

create policy "See profile media you're allowed to" on storage.objects
  for select to anon, authenticated using (bucket_id = 'profile-media' and private.can_see_path(name));
create policy "Upload profile media to your own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-media'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and private.my_file_count('profile-media') < 40
  );
create policy "Change your own profile media" on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-media' and split_part(name, '/', 1) = (select auth.uid())::text)
  with check (bucket_id = 'profile-media' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy "Remove your own profile media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-media' and split_part(name, '/', 1) = (select auth.uid())::text);
