-- Several photos per vehicle, and re-cropping the avatar and banner without
-- uploading again.

-- ---------------------------------------------------------------------------
-- Vehicle photos: up to 8 per vehicle. The first (lowest sort) is the cover.
create table public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  path text not null,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint vehicle_photo_path_own_folder check (path ~ ('^' || user_id::text || '/[A-Za-z0-9_.-]{1,80}$'))
);
create index vehicle_photos_vehicle on public.vehicle_photos (vehicle_id, sort, created_at);
alter table public.vehicle_photos enable row level security;

create policy "See vehicle photos you're allowed to" on public.vehicle_photos
  for select to anon, authenticated using (private.can_see_details(user_id));
create policy "Add photos to your own vehicles" on public.vehicle_photos
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid()))
  );
create policy "Reorder your own vehicle photos" on public.vehicle_photos
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Remove your own vehicle photos" on public.vehicle_photos
  for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.vehicle_photos to anon, authenticated;
grant insert (vehicle_id, user_id, path, sort) on public.vehicle_photos to authenticated;
grant update (sort) on public.vehicle_photos to authenticated;
grant delete on public.vehicle_photos to authenticated;

create or replace function private.vehicle_photo_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.vehicle_photos where vehicle_id = new.vehicle_id) >= 8 then
    raise exception 'Limit of 8 photos per vehicle reached.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger vehicle_photos_limit before insert on public.vehicle_photos
  for each row execute function private.vehicle_photo_limit();

-- Existing single photos become each vehicle's first photo.
insert into public.vehicle_photos (vehicle_id, user_id, path, sort)
select id, user_id, photo_path, 0 from public.vehicles where photo_path is not null;

revoke insert (photo_path) on public.vehicles from authenticated;
revoke update (photo_path) on public.vehicles from authenticated;
alter table public.vehicles drop constraint vehicle_photo_in_own_folder;
alter table public.vehicles drop column photo_path;

-- ---------------------------------------------------------------------------
-- Re-cropping: keep the uploaded picture (already resized and stripped of
-- location data) and the chosen crop, so the crop can be changed later.
-- Only the owner can read these columns' files; see the storage rule below.
alter table public.profiles
  add column avatar_source_path text,
  add column avatar_crop jsonb check (avatar_crop is null or jsonb_typeof(avatar_crop) = 'object'),
  add column banner_source_path text,
  add column banner_crop jsonb check (banner_crop is null or jsonb_typeof(banner_crop) = 'object'),
  add constraint avatar_source_own_folder check (avatar_source_path is null or avatar_source_path ~ ('^' || id::text || '/source-[A-Za-z0-9_.-]{1,80}$')),
  add constraint banner_source_own_folder check (banner_source_path is null or banner_source_path ~ ('^' || id::text || '/source-[A-Za-z0-9_.-]{1,80}$'));

-- Signed-in people can read the columns (needed for their own row); the files
-- themselves are owner-only.
grant select (avatar_source_path, avatar_crop, banner_source_path, banner_crop) on public.profiles to authenticated;
grant insert (avatar_source_path, avatar_crop, banner_source_path, banner_crop) on public.profiles to authenticated;
grant update (avatar_source_path, avatar_crop, banner_source_path, banner_crop) on public.profiles to authenticated;

-- Files named source-* in profile-media are visible to their owner only.
drop policy "See profile media you're allowed to" on storage.objects;
create policy "See profile media you're allowed to" on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'profile-media'
    and case
      when split_part(name, '/', 2) like 'source-%' then split_part(name, '/', 1) = (select auth.uid())::text
      else private.can_see_path(name)
    end
  );

-- Room for 10 vehicles x 8 photos, 24 gallery items, and the two sources.
drop policy "Upload profile media to your own folder" on storage.objects;
create policy "Upload profile media to your own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-media'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and private.my_file_count('profile-media') < 150
  );
