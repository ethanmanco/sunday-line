-- Roads a member has driven (plan 11.88): the roads their reviews say "I drove
-- it" on, newest first, for the Driven tab on profiles. Only for people who may
-- see that profile's details (public members, accepted followers, themselves),
-- like the garage and photos: where someone drives is theirs to share.
create or replace function public.roads_driven(p_user uuid)
returns table (road_id text, driven_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.road_id, r.updated_at from public.road_ratings r
  where r.user_id = p_user and r.drove_it and private.can_see_details(p_user)
  order by r.updated_at desc
  limit 500;
$$;
revoke all on function public.roads_driven(uuid) from public;
grant execute on function public.roads_driven(uuid) to anon, authenticated;
