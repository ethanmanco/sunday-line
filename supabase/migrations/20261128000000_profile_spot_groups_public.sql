-- The public groups each spot on a profile is in (docs/plan.md 11.29).
-- Only spots the caller may see on that profile, only accepted links, only
-- public groups (whose names anyone can see anyway).
create or replace function public.profile_spot_public_groups(p_user uuid)
returns table (spot_id uuid, group_name text, short_id text)
language sql stable security definer set search_path = ''
as $$
  select sg.spot_id, g.name, g.short_id
  from public.profile_spots(p_user) s
  join public.spot_groups sg on sg.spot_id = s.id and sg.status = 'accepted'
  join public.groups g on g.id = sg.group_id and g.visibility = 'public'
  order by g.name;
$$;
revoke all on function public.profile_spot_public_groups(uuid) from public;
grant execute on function public.profile_spot_public_groups(uuid) to anon, authenticated;
