-- One spot, many groups (docs/plan.md 11.21).
--
-- Before: adding a spot to a group made a copy, so the same place showed up
-- twice in your library. Now a spot is one row, owned by its creator, and a
-- link table says which groups it's in. Each link has its own status
-- (suggested or accepted), so a group's managers still accept members' spots.
--
-- Rules that change with it:
-- * Members see a spot through an accepted link to their group (or their own
--   suggestion, and managers see suggestions).
-- * A spot linked to any private group never shows on a profile.
-- * Group spot managers can submit a spot to the public map only once their
--   group has accepted it.

create table public.spot_groups (
  spot_id uuid not null references public.spots (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  status public.spot_group_status not null,
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (spot_id, group_id)
);
create index spot_groups_group on public.spot_groups (group_id, status);

-- Existing group spots become links.
insert into public.spot_groups (spot_id, group_id, status, added_by, created_at)
select id, group_id, group_status, owner_id, created_at from public.spots where group_id is not null;

-- Fold the old copies back into one spot: same owner, name, and place.
-- The oldest one stays and takes over the copies' groups.
create temp table spot_merge on commit drop as
select id, keeper from (
  select id, first_value(id) over (
    partition by owner_id, kind, lower(btrim(name)), round(lat::numeric, 5), round(lng::numeric, 5), coalesce(line, ''), coalesce(road_id, '')
    order by created_at, id) as keeper
  from public.spots
) d where id <> keeper;

insert into public.spot_groups (spot_id, group_id, status, added_by, created_at)
select m.keeper, sg.group_id, sg.status, sg.added_by, sg.created_at
from spot_merge m join public.spot_groups sg on sg.spot_id = m.id
on conflict (spot_id, group_id) do update
  set status = case when excluded.status = 'accepted' or public.spot_groups.status = 'accepted'
                    then 'accepted'::public.spot_group_status else 'proposed'::public.spot_group_status end;

-- Keep "show on profile" and a public-map status if any copy had them.
update public.spots k set
  show_on_profile = k.show_on_profile or c.on_profile,
  public_status = case when k.public_status = 'none' then c.pub else k.public_status end,
  public_note = case when k.public_status = 'none' then c.note else k.public_note end,
  submitted_at = case when k.public_status = 'none' then c.submitted else k.submitted_at end,
  reviewed_at = case when k.public_status = 'none' then c.reviewed else k.reviewed_at end
from (
  select m.keeper, bool_or(s.show_on_profile) as on_profile,
    (array_agg(s.public_status order by (s.public_status = 'approved') desc, (s.public_status = 'pending') desc, s.created_at))[1] as pub,
    (array_agg(s.public_note order by (s.public_status = 'approved') desc, (s.public_status = 'pending') desc, s.created_at))[1] as note,
    (array_agg(s.submitted_at order by (s.public_status = 'approved') desc, (s.public_status = 'pending') desc, s.created_at))[1] as submitted,
    (array_agg(s.reviewed_at order by (s.public_status = 'approved') desc, (s.public_status = 'pending') desc, s.created_at))[1] as reviewed
  from spot_merge m join public.spots s on s.id = m.id
  group by m.keeper
) c
where k.id = c.keeper;

update public.event_locations e set spot_id = m.keeper from spot_merge m where e.spot_id = m.id;
delete from public.spots where id in (select id from spot_merge);

alter table public.spot_groups enable row level security;
create policy "Members see their group's spot links" on public.spot_groups
  for select to authenticated using (
    (private.is_member(group_id)
      and (status = 'accepted' or added_by = (select auth.uid()) or private.has_perm(group_id, 'spots')))
    or exists (select 1 from public.spots s where s.id = spot_id and s.owner_id = (select auth.uid()))
  );
grant select on public.spot_groups to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers.
create or replace function private.spot_in_member_group(sid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.spot_groups sg
    where sg.spot_id = sid and private.is_member(sg.group_id)
      and (sg.status = 'accepted' or sg.added_by = auth.uid() or private.has_perm(sg.group_id, 'spots'))
  );
$$;

create or replace function private.spot_in_private_group(sid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.spot_groups sg join public.groups g on g.id = sg.group_id
    where sg.spot_id = sid and g.visibility = 'private'
  );
$$;

-- Does the owner's profile setting show this spot? Never if it's in a private group.
drop function if exists private.profile_shows_spot(uuid, uuid, boolean) cascade;
create or replace function private.profile_shows_spot(owner uuid, sid uuid, picked boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not private.spot_in_private_group(sid) and coalesce((
    select case p.spots_display
      when 'all' then true
      when 'selected' then picked
      when 'groups' then exists (
        select 1 from public.spot_groups sg join public.profile_spot_groups x on x.group_id = sg.group_id
        where sg.spot_id = sid and sg.status = 'accepted' and x.user_id = owner)
      else false
    end
    from public.profiles p where p.id = owner
  ), false);
$$;
revoke all on function private.spot_in_member_group(uuid) from public;
revoke all on function private.spot_in_private_group(uuid) from public;
revoke all on function private.profile_shows_spot(uuid, uuid, boolean) from public;
grant execute on function private.spot_in_member_group(uuid) to anon, authenticated;
grant execute on function private.spot_in_private_group(uuid) to anon, authenticated;
grant execute on function private.profile_shows_spot(uuid, uuid, boolean) to anon, authenticated;

-- Spot rules, rewritten for links (the cascade above dropped the old select policy).
drop policy if exists "See spots you're allowed to" on public.spots;
create policy "See spots you're allowed to" on public.spots
  for select to anon, authenticated using (
    owner_id = (select auth.uid())
    or public_status = 'approved'
    or private.spot_in_member_group(id)
    or (private.can_see_details(owner_id) and private.profile_shows_spot(owner_id, id, show_on_profile))
    or (public_status = 'pending' and private.is_site_admin())
  );
drop policy if exists "Add your own spots" on public.spots;
create policy "Add your own spots" on public.spots
  for insert to authenticated with check (owner_id = (select auth.uid()));

create or replace function public.profile_spots(p_user uuid)
returns setof public.spots
language sql stable security definer set search_path = ''
as $$
  select s.* from public.spots s
  where s.owner_id = p_user
    and not private.blocked_between(auth.uid(), p_user)
    and (
      s.public_status = 'approved'
      or (private.can_see_details(p_user) and private.profile_shows_spot(p_user, s.id, s.show_on_profile))
    )
  order by s.created_at desc
  limit 500;
$$;

-- New spots: never public on day one (group links are added separately).
create or replace function private.spot_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.spots where owner_id = new.owner_id) >= 500 then
    raise exception 'Limit of 500 spots reached.' using errcode = '23514';
  end if;
  new.public_status := 'none';
  new.public_note := null;
  new.submitted_at := null;
  new.reviewed_at := null;
  return new;
end;
$$;

-- Does the caller manage this spot in some group that accepted it?
drop function if exists private.manages_spot(public.spots);
create or replace function private.manages_spot(sid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.spot_groups sg
    where sg.spot_id = sid and sg.status = 'accepted' and private.has_perm(sg.group_id, 'spots')
  );
$$;
revoke all on function private.manages_spot(uuid) from public;

-- ---------------------------------------------------------------------------
-- Functions people call.

-- Put your spot in a group: in right away for spot managers, suggested otherwise.
create or replace function public.add_spot_to_group(p_spot uuid, p_group uuid)
returns public.spot_group_status
language plpgsql security definer set search_path = ''
as $$
declare
  st public.spot_group_status;
begin
  if not exists (select 1 from public.spots where id = p_spot and owner_id = auth.uid()) then
    raise exception 'Not your spot.' using errcode = '42501';
  end if;
  if not private.is_member(p_group) then
    raise exception 'Join the group first.' using errcode = '42501';
  end if;
  st := case when private.has_perm(p_group, 'spots') then 'accepted'::public.spot_group_status else 'proposed'::public.spot_group_status end;
  insert into public.spot_groups (spot_id, group_id, status, added_by)
  values (p_spot, p_group, st, auth.uid())
  on conflict (spot_id, group_id) do nothing;
  return (select status from public.spot_groups where spot_id = p_spot and group_id = p_group);
end;
$$;

drop function if exists public.accept_group_spot(uuid);
create or replace function public.accept_group_spot(p_spot uuid, p_group uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_perm(p_group, 'spots') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.spot_groups set status = 'accepted' where spot_id = p_spot and group_id = p_group;
  if not found then
    raise exception 'That spot isn''t in this group.' using errcode = 'P0002';
  end if;
end;
$$;

-- Decline a suggestion or take a spot out of a group. The spot stays in its
-- owner's library.
drop function if exists public.remove_spot_from_group(uuid);
create or replace function public.remove_spot_from_group(p_spot uuid, p_group uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (
    exists (select 1 from public.spots where id = p_spot and owner_id = auth.uid())
    or private.has_perm(p_group, 'spots')
  ) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.spot_groups where spot_id = p_spot and group_id = p_group;
end;
$$;

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
  if s.id is null or not (s.owner_id = auth.uid() or private.manages_spot(s.id)) then
    raise exception 'Not allowed.' using errcode = '42501';
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
begin
  if not exists (select 1 from public.spots where id = p_spot and (owner_id = auth.uid() or private.manages_spot(id))) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.spots set public_status = 'none', public_note = null, submitted_at = null, reviewed_at = null where id = p_spot;
end;
$$;

-- Event locations: a public spot, one the event's group accepted, or your own.
create or replace function public.set_event_location(p_event uuid, p_spot uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ev public.events%rowtype;
  s public.spots%rowtype;
begin
  select * into ev from public.events where id = p_event;
  if ev.id is null or not private.has_perm(ev.group_id, 'events') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_spot is null then
    delete from public.event_locations where event_id = p_event;
    return;
  end if;
  select * into s from public.spots where id = p_spot;
  if s.id is null or not coalesce(
    s.public_status = 'approved'
    or exists (select 1 from public.spot_groups sg where sg.spot_id = s.id and sg.group_id = ev.group_id and sg.status = 'accepted')
    or s.owner_id = auth.uid(),
    false
  ) then
    raise exception 'Pick a public spot, one of this group''s spots, or one of yours.' using errcode = '42501';
  end if;
  insert into public.event_locations (event_id, spot_id, name, kind, category, lat, lng, line, notes)
  values (p_event, s.id, s.name, s.kind, s.category, s.lat, s.lng, s.line, s.description)
  on conflict (event_id) do update set
    spot_id = excluded.spot_id, name = excluded.name, kind = excluded.kind, category = excluded.category,
    lat = excluded.lat, lng = excluded.lng, line = excluded.line, notes = excluded.notes;
end;
$$;

revoke all on function public.add_spot_to_group(uuid, uuid) from public;
revoke all on function public.accept_group_spot(uuid, uuid) from public;
revoke all on function public.remove_spot_from_group(uuid, uuid) from public;
grant execute on function public.add_spot_to_group(uuid, uuid) to authenticated;
grant execute on function public.accept_group_spot(uuid, uuid) to authenticated;
grant execute on function public.remove_spot_from_group(uuid, uuid) to authenticated;

-- The old one-group columns are no longer used.
revoke insert (group_id) on public.spots from authenticated;
drop index if exists public.spots_group;
alter table public.spots drop constraint spot_group;
update public.spots set group_id = null, group_status = null;
alter table public.spots drop column group_id, drop column group_status;

-- Anyone can see which public-map spots a public group shared.
create or replace function private.shared_publicly(sid uuid, gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.spots where id = sid and public_status = 'approved')
     and exists (select 1 from public.groups where id = gid and visibility = 'public');
$$;
revoke all on function private.shared_publicly(uuid, uuid) from public;
grant execute on function private.shared_publicly(uuid, uuid) to anon, authenticated;
create policy "Anyone sees a public group's shared spots" on public.spot_groups
  for select to anon, authenticated using (status = 'accepted' and private.shared_publicly(spot_id, group_id));
grant select on public.spot_groups to anon;
