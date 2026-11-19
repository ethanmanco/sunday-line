-- Group pictures, spots, and the public spot review (docs/plan.md 11.16).
--
-- Spots are places people save: a point (a meetup lot, a scenic pull-off, gas)
-- or a stretch of road (a whole road or part of it).
-- * Every spot belongs to the person who made it: their personal library.
-- * A spot can be added to a group. People who manage the group's spots
--   (organizer, or moderators with the "spots" permission) add directly;
--   other members propose, and a manager accepts or declines.
-- * People choose which of their spots show on their profile: all, ones they
--   pick, ones from groups they pick, or none.
-- * A spot can be submitted to the public map. Automatic checks pass most
--   submissions; anything that trips a check waits for a site admin.
-- * Group spots never leak: only members see them (plus anyone the owner
--   chose to show their own spots to, and the public map if approved).

-- ---------------------------------------------------------------------------
-- Site admins (Ethan). Private schema: not reachable through the API.
create table private.site_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade
);
-- The site owner's account at the time this runs (username "mango").
insert into private.site_admins (user_id) select id from public.profiles where username = 'mango';

create or replace function private.is_site_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.site_admins where user_id = auth.uid());
$$;
revoke all on function private.is_site_admin() from public;
grant execute on function private.is_site_admin() to anon, authenticated;

create or replace function public.am_site_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_site_admin(); $$;
revoke all on function public.am_site_admin() from public;
grant execute on function public.am_site_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Group pictures: avatar and banner, with the uncropped original kept for
-- re-cropping (organizer only). Files live in the private group-images bucket.
alter table public.groups
  add column avatar_path text,
  add column avatar_source_path text,
  add column avatar_crop jsonb check (avatar_crop is null or jsonb_typeof(avatar_crop) = 'object'),
  add column banner_path text,
  add column banner_source_path text,
  add column banner_crop jsonb check (banner_crop is null or jsonb_typeof(banner_crop) = 'object'),
  add constraint group_pictures_in_group_folder check (
    coalesce(avatar_path, '') || coalesce(avatar_source_path, '') || coalesce(banner_path, '') || coalesce(banner_source_path, '') = ''
    or (
      (avatar_path is null or avatar_path ~ ('^' || id::text || '/[A-Za-z0-9_.-]{1,80}$'))
      and (avatar_source_path is null or avatar_source_path ~ ('^' || id::text || '/source-[A-Za-z0-9_.-]{1,80}$'))
      and (banner_path is null or banner_path ~ ('^' || id::text || '/[A-Za-z0-9_.-]{1,80}$'))
      and (banner_source_path is null or banner_source_path ~ ('^' || id::text || '/source-[A-Za-z0-9_.-]{1,80}$'))
    )
  );
grant update (avatar_path, avatar_source_path, avatar_crop, banner_path, banner_source_path, banner_crop) on public.groups to authenticated;

create or replace function private.path_group(path text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return split_part(path, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

-- Can the caller see this group (public, or a member)?
create or replace function private.can_see_group(g uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.groups where id = g and (visibility = 'public' or private.is_member(g)));
$$;
revoke all on function private.path_group(text) from public;
revoke all on function private.can_see_group(uuid) from public;
grant execute on function private.path_group(text) to anon, authenticated;
grant execute on function private.can_see_group(uuid) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('group-images', 'group-images', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "See pictures of groups you can see" on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'group-images'
    and case
      when split_part(name, '/', 2) like 'source-%' then private.group_role(private.path_group(name)) = 'organizer'
      else private.can_see_group(private.path_group(name))
    end
  );
create or replace function private.group_file_count(path text)
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from storage.objects
  where bucket_id = 'group-images' and split_part(name, '/', 1) = split_part(path, '/', 1);
$$;
revoke all on function private.group_file_count(text) from public;
grant execute on function private.group_file_count(text) to authenticated;

create policy "Organizers upload group pictures" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'group-images' and private.group_role(private.path_group(name)) = 'organizer'
    and private.group_file_count(name) < 12
  );
create policy "Organizers change group pictures" on storage.objects
  for update to authenticated
  using (bucket_id = 'group-images' and private.group_role(private.path_group(name)) = 'organizer')
  with check (bucket_id = 'group-images' and private.group_role(private.path_group(name)) = 'organizer');
create policy "Organizers remove group pictures" on storage.objects
  for delete to authenticated using (bucket_id = 'group-images' and private.group_role(private.path_group(name)) = 'organizer');

-- ---------------------------------------------------------------------------
-- Spots.
create type public.spot_kind as enum ('point', 'road');
create type public.spot_category as enum ('meetup', 'scenic', 'food', 'gas', 'parking', 'track', 'other');
create type public.spot_group_status as enum ('proposed', 'accepted');
create type public.spot_public_status as enum ('none', 'pending', 'approved', 'rejected');
create type public.spots_display as enum ('all', 'selected', 'groups', 'none');

create table public.spots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind public.spot_kind not null,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (char_length(description) <= 500),
  category public.spot_category,
  -- A point's location, or where a road stretch starts.
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- Road stretches: which road, which part, and the line itself (encoded
  -- polyline) so the spot still draws if the road data changes.
  road_id text check (road_id ~ '^[a-f0-9]{12}$'),
  road_region text check (road_region ~ '^[a-z0-9-]{2,40}$'),
  start_frac real check (start_frac between 0 and 1),
  end_frac real check (end_frac between 0 and 1),
  line text check (char_length(line) <= 20000),
  group_id uuid references public.groups (id) on delete cascade,
  group_status public.spot_group_status,
  show_on_profile boolean not null default false,
  public_status public.spot_public_status not null default 'none',
  public_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spot_shape check (
    (kind = 'point' and category is not null and line is null and road_id is null)
    or (kind = 'road' and line is not null and category is null)
  ),
  constraint spot_stretch check (start_frac is null or end_frac is null or start_frac < end_frac),
  constraint spot_group check ((group_id is null) = (group_status is null))
);
create index spots_owner on public.spots (owner_id, created_at desc);
create index spots_group on public.spots (group_id) where group_id is not null;
create index spots_public on public.spots (public_status) where public_status in ('approved', 'pending');
create trigger spots_touch before update on public.spots for each row execute function public.touch_updated_at();

alter table public.profiles add column spots_display public.spots_display not null default 'selected';
grant select (spots_display) on public.profiles to anon, authenticated;
grant insert (spots_display) on public.profiles to authenticated;
grant update (spots_display) on public.profiles to authenticated;

-- Groups whose spots (your own) appear on your profile when you pick "groups".
create table public.profile_spot_groups (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  primary key (user_id, group_id)
);
alter table public.profile_spot_groups enable row level security;
create policy "Your own profile spot groups" on public.profile_spot_groups
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, delete on public.profile_spot_groups to authenticated;

-- Does the owner's profile setting show this spot?
create or replace function private.profile_shows_spot(owner uuid, spot_group uuid, picked boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p.spots_display
    when 'all' then true
    when 'selected' then picked
    when 'groups' then spot_group is not null and exists (
      select 1 from public.profile_spot_groups x where x.user_id = owner and x.group_id = spot_group)
    else false
  end
  from public.profiles p where p.id = owner;
$$;
revoke all on function private.profile_shows_spot(uuid, uuid, boolean) from public;
grant execute on function private.profile_shows_spot(uuid, uuid, boolean) to anon, authenticated;

alter table public.spots enable row level security;

create policy "See spots you're allowed to" on public.spots
  for select to anon, authenticated using (
    owner_id = (select auth.uid())
    or public_status = 'approved'
    or (group_id is not null and private.is_member(group_id)
        and (group_status = 'accepted' or private.has_perm(group_id, 'spots')))
    or (private.can_see_details(owner_id) and private.profile_shows_spot(owner_id, group_id, show_on_profile))
    or (public_status = 'pending' and private.is_site_admin())
  );
create policy "Add your own spots" on public.spots
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and (group_id is null or private.is_member(group_id))
  );
create policy "Edit your own spots" on public.spots
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Delete your own spots" on public.spots
  for delete to authenticated using (owner_id = (select auth.uid()));

grant select on public.spots to anon, authenticated;
grant insert (owner_id, kind, name, description, category, lat, lng, road_id, road_region, start_frac, end_frac, line, group_id, show_on_profile)
  on public.spots to authenticated;
grant update (name, description, category, lat, lng, road_id, road_region, start_frac, end_frac, line, show_on_profile)
  on public.spots to authenticated;
grant delete on public.spots to authenticated;

-- ---------------------------------------------------------------------------
-- Automatic checks for the public map. Returns the reasons a spot needs a
-- person to look; an empty list means it can go straight through.
create table private.blocked_words (word text primary key);
-- A short starter list. Add more in the SQL editor; they never need to be in the repo.
insert into private.blocked_words (word) values
  ('fuck'), ('shit'), ('cunt'), ('bitch'), ('dick'), ('cock'), ('pussy'), ('porn'), ('nazi');

create or replace function private.in_us(lat double precision, lng double precision)
returns boolean
language sql immutable set search_path = ''
as $$
  select (lat between 24 and 50 and lng between -125 and -66)      -- lower 48
      or (lat between 51 and 72 and lng between -180 and -129)     -- Alaska
      or (lat between 18 and 23 and lng between -161 and -154);    -- Hawaii
$$;

create or replace function private.spot_checks(s public.spots)
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  reasons text[] := '{}';
  txt text := lower(coalesce(s.name, '') || ' ' || coalesce(s.description, ''));
begin
  if (select created_at from public.profiles where id = s.owner_id) > now() - interval '7 days' then
    reasons := array_append(reasons, 'Account is less than a week old');
  end if;
  if txt ~ '(https?://|www\.|\m[a-z0-9-]{2,}\.(com|net|org|io|co|us|app|gg|ly|me|info|biz|xyz|tv|link|site|online|shop)\M|\m[a-z0-9-]+\.[a-z]{2,}/|\mdot com\M|@[a-z0-9-]+\.|\d{3}[-. )]*\d{3}[-. ]*\d{4})' then
    reasons := array_append(reasons, 'Has a link, email address, or phone number');
  end if;
  if exists (select 1 from private.blocked_words w where txt ~ ('\m' || w.word)) then
    reasons := array_append(reasons, 'Has a word on the review list');
  end if;
  if not private.in_us(s.lat, s.lng) then
    reasons := array_append(reasons, 'Outside the United States');
  end if;
  if s.kind = 'point' and s.category = 'other' then
    reasons := array_append(reasons, 'Category is "other"');
  end if;
  if s.kind = 'point' and exists (
    select 1 from public.spots o
    where o.id <> s.id and o.public_status = 'approved' and o.kind = 'point'
      and abs(o.lat - s.lat) < 0.001 and abs(o.lng - s.lng) < 0.0012
  ) then
    reasons := array_append(reasons, 'Very close to a spot already on the map');
  end if;
  if s.kind = 'road' and s.road_id is not null and exists (
    select 1 from public.spots o
    where o.id <> s.id and o.public_status = 'approved' and o.kind = 'road' and o.road_id = s.road_id
      and coalesce(o.start_frac, 0) < coalesce(s.end_frac, 1) and coalesce(s.start_frac, 0) < coalesce(o.end_frac, 1)
  ) then
    reasons := array_append(reasons, 'Overlaps a road already on the map');
  end if;
  if (select count(*) from public.spots o
      where o.owner_id = s.owner_id and o.id <> s.id and o.submitted_at > now() - interval '1 day') >= 5 then
    reasons := array_append(reasons, 'More than 5 submissions today');
  end if;
  return reasons;
end;
$$;
revoke all on function private.in_us(double precision, double precision) from public;
revoke all on function private.spot_checks(public.spots) from public;

-- New spots: group status from the caller's permission; never public on day one.
create or replace function private.spot_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.spots where owner_id = new.owner_id) >= 500 then
    raise exception 'Limit of 500 spots reached.' using errcode = '23514';
  end if;
  new.group_status := case
    when new.group_id is null then null
    when private.has_perm(new.group_id, 'spots') then 'accepted'::public.spot_group_status
    else 'proposed'::public.spot_group_status
  end;
  new.public_status := 'none';
  new.public_note := null;
  new.submitted_at := null;
  new.reviewed_at := null;
  return new;
end;
$$;
create trigger spots_before_insert before insert on public.spots
  for each row execute function private.spot_before_insert();

-- Editing a public (or waiting) spot runs the checks again.
create or replace function private.spot_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  reasons text[];
begin
  if old.public_status in ('approved', 'pending')
     and (new.name, new.description, new.category, new.lat, new.lng, new.line)
         is distinct from (old.name, old.description, old.category, old.lat, old.lng, old.line) then
    reasons := private.spot_checks(new);
    new.public_status := case when cardinality(reasons) = 0 then 'approved'::public.spot_public_status else 'pending'::public.spot_public_status end;
    new.public_note := nullif(array_to_string(reasons, '; '), '');
    new.submitted_at := now();
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;
create trigger spots_before_update before update on public.spots
  for each row execute function private.spot_before_update();

-- Who manages a group spot: its group's organizer or spot moderators.
create or replace function private.manages_spot(s public.spots)
returns boolean
language sql stable security definer set search_path = ''
as $$ select s.group_id is not null and private.has_perm(s.group_id, 'spots'); $$;
revoke all on function private.manages_spot(public.spots) from public;

create or replace function public.accept_group_spot(p_spot uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.spots%rowtype;
begin
  select * into s from public.spots where id = p_spot;
  if s.id is null or not private.manages_spot(s) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.spots set group_status = 'accepted' where id = p_spot;
end;
$$;

-- Decline a proposal or take a spot out of a group. The spot stays in its
-- owner's library.
create or replace function public.remove_spot_from_group(p_spot uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.spots%rowtype;
begin
  select * into s from public.spots where id = p_spot;
  if s.id is null or not (s.owner_id = auth.uid() or private.manages_spot(s)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.spots set group_id = null, group_status = null where id = p_spot;
end;
$$;

-- Submit to the public map: the owner, or a group spot manager.
create or replace function public.submit_spot_public(p_spot uuid)
returns public.spot_public_status
language plpgsql security definer set search_path = ''
as $$
declare
  s public.spots%rowtype;
  reasons text[];
  result public.spot_public_status;
begin
  select * into s from public.spots where id = p_spot for update;
  if s.id is null or not (s.owner_id = auth.uid() or private.manages_spot(s)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if s.group_id is not null and s.group_status <> 'accepted' then
    raise exception 'The group has to accept this spot first.' using errcode = '42501';
  end if;
  if s.public_status in ('approved', 'pending') then
    return s.public_status;
  end if;
  reasons := private.spot_checks(s);
  result := case when cardinality(reasons) = 0 then 'approved'::public.spot_public_status else 'pending'::public.spot_public_status end;
  update public.spots
  set public_status = result, public_note = nullif(array_to_string(reasons, '; '), ''), submitted_at = now(), reviewed_at = null
  where id = p_spot;
  return result;
end;
$$;

create or replace function public.withdraw_spot_public(p_spot uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.spots%rowtype;
begin
  select * into s from public.spots where id = p_spot;
  if s.id is null or not (s.owner_id = auth.uid() or private.manages_spot(s)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.spots set public_status = 'none', public_note = null, submitted_at = null, reviewed_at = null where id = p_spot;
end;
$$;

-- Site admin: approve or turn down a waiting spot, or take an approved one off.
create or replace function public.review_spot(p_spot uuid, p_approve boolean, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_site_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.spots
  set public_status = case when p_approve then 'approved'::public.spot_public_status else 'rejected'::public.spot_public_status end,
      public_note = nullif(btrim(p_note), ''),
      reviewed_at = now()
  where id = p_spot and public_status in ('pending', 'approved');
  if not found then
    raise exception 'Nothing to review.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.accept_group_spot(uuid) from public;
revoke all on function public.remove_spot_from_group(uuid) from public;
revoke all on function public.submit_spot_public(uuid) from public;
revoke all on function public.withdraw_spot_public(uuid) from public;
revoke all on function public.review_spot(uuid, boolean, text) from public;
grant execute on function public.accept_group_spot(uuid) to authenticated;
grant execute on function public.remove_spot_from_group(uuid) to authenticated;
grant execute on function public.submit_spot_public(uuid) to authenticated;
grant execute on function public.withdraw_spot_public(uuid) to authenticated;
grant execute on function public.review_spot(uuid, boolean, text) to authenticated;

-- What a profile's Spots tab shows: spots on the public map, plus the ones the
-- owner chose to show (if the viewer may see the owner's profile details).
-- Group membership alone doesn't put someone's group spots on their profile.
create or replace function public.profile_spots(p_user uuid)
returns setof public.spots
language sql stable security definer set search_path = ''
as $$
  select s.* from public.spots s
  where s.owner_id = p_user
    and not private.blocked_between(auth.uid(), p_user)
    and (
      s.public_status = 'approved'
      or (private.can_see_details(p_user) and private.profile_shows_spot(p_user, s.group_id, s.show_on_profile))
    )
  order by s.created_at desc
  limit 500;
$$;
revoke all on function public.profile_spots(uuid) from public;
grant execute on function public.profile_spots(uuid) to anon, authenticated;
