-- Spot privacy rules (docs/plan.md 11.25).
--
-- * A spot's groups are all private or all public. A spot in a private group
--   can only go into other private groups, and the reverse, so a private
--   group's place never ends up in front of a public group.
-- * You pick each spot for your profile yourself ("Show on profile"). The old
--   all / groups / none modes are folded into those picks. Spots in a private
--   group can't be picked. A private profile shows its picks to approved
--   followers (unchanged).

-- Fold the old modes into per-spot picks.
update public.spots s set show_on_profile = true
from public.profiles p
where p.id = s.owner_id and p.spots_display = 'all'
  and not private.spot_in_private_group(s.id);
update public.spots s set show_on_profile = true
from public.profiles p
where p.id = s.owner_id and p.spots_display = 'groups'
  and not private.spot_in_private_group(s.id)
  and exists (
    select 1 from public.spot_groups sg join public.profile_spot_groups x on x.group_id = sg.group_id
    where sg.spot_id = s.id and sg.status = 'accepted' and x.user_id = s.owner_id);
update public.spots s set show_on_profile = false
from public.profiles p
where p.id = s.owner_id and (p.spots_display = 'none' or private.spot_in_private_group(s.id));
update public.profiles set spots_display = 'selected' where spots_display <> 'selected';
alter table public.profiles alter column spots_display set default 'selected';
revoke update (spots_display) on public.profiles from authenticated;
revoke insert (spots_display) on public.profiles from authenticated;

-- A spot in a private group is never picked for a profile.
create or replace function private.spot_profile_pick()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.show_on_profile and private.spot_in_private_group(new.id) then
    new.show_on_profile := false;
  end if;
  return new;
end;
$$;
create trigger spots_profile_pick before update of show_on_profile on public.spots
  for each row execute function private.spot_profile_pick();

-- Put your spot in a group: in right away for spot managers, suggested
-- otherwise. Its groups stay all private or all public.
create or replace function public.add_spot_to_group(p_spot uuid, p_group uuid)
returns public.spot_group_status
language plpgsql security definer set search_path = ''
as $$
declare
  st public.spot_group_status;
  vis public.group_visibility;
begin
  if not exists (select 1 from public.spots where id = p_spot and owner_id = auth.uid()) then
    raise exception 'Not your spot.' using errcode = '42501';
  end if;
  if not private.is_member(p_group) then
    raise exception 'Join the group first.' using errcode = '42501';
  end if;
  select visibility into vis from public.groups where id = p_group;
  if exists (
    select 1 from public.spot_groups sg join public.groups g on g.id = sg.group_id
    where sg.spot_id = p_spot and g.id <> p_group and g.visibility <> vis
  ) then
    raise exception 'A spot in a private group can only go in other private groups, and a spot in a public group only in public ones.'
      using errcode = '23514';
  end if;
  st := case when private.has_perm(p_group, 'spots') then 'accepted'::public.spot_group_status else 'proposed'::public.spot_group_status end;
  insert into public.spot_groups (spot_id, group_id, status, added_by)
  values (p_spot, p_group, st, auth.uid())
  on conflict (spot_id, group_id) do nothing;
  if vis = 'private' then
    update public.spots set show_on_profile = false where id = p_spot and show_on_profile;
  end if;
  return (select status from public.spot_groups where spot_id = p_spot and group_id = p_group);
end;
$$;
