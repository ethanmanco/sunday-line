-- Spot rules, adjusted (plan 11.44).
--
-- * Groups: a spot can join a private group any time. It can't join a public
--   group while it's in a private one, so a private group's place never ends
--   up in front of a public group. (Before, a spot's groups had to be all
--   public or all private, which also stopped a public group's spot from
--   going into a private group, though that reveals nothing.)
-- * Public map: only roads. Places (pins: meetup lots, overlooks) stay with
--   their owner, their groups, and their profile.

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
  if vis = 'public' and private.spot_in_private_group(p_spot) then
    raise exception 'A spot in a private group can''t go in a public group.' using errcode = '23514';
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
  if s.kind = 'point' then
    raise exception 'Only roads go on the public map.' using errcode = '23514';
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

-- A road on the public map that becomes a place comes off it.
create or replace function private.spot_place_off_public()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'point' and new.public_status <> 'none' then
    new.public_status := 'none';
    new.public_note := null;
  end if;
  return new;
end;
$$;
revoke all on function private.spot_place_off_public() from public;
create trigger spots_place_off_public before update of kind, public_status on public.spots
  for each row execute function private.spot_place_off_public();

-- Any place already there comes off (there were none when this ran).
update public.spots set public_status = 'none', public_note = null where kind = 'point' and public_status <> 'none';
