-- Private members' reviews: public, but anonymous (plan 11.84).
--
-- Reviews and speed reports were readable with their author by anyone, so a
-- private member's reviews showed where they drive. Now a review's row (with
-- its author) is visible only to people who can see that member's profile
-- (public members, accepted followers, themselves) and the site admin.
-- Everyone still sees every review's text through road_reviews(), with the
-- author left off when they can't see the profile, and every review still
-- counts in the road's summary.

drop policy "Ratings are public" on public.road_ratings;
create policy "Reviews with their author, where you may see the author" on public.road_ratings
  for select to anon, authenticated using (private.can_see_details(user_id) or (select private.is_site_admin()));

drop policy "Speed reports are public" on public.speed_reports;
create policy "Speed reports with their author, where you may see the author" on public.speed_reports
  for select to anon, authenticated using (private.can_see_details(user_id) or (select private.is_site_admin()));

-- The summary counts every review; it has no authors in it, so it runs as its owner.
alter view public.road_community set (security_invoker = false);

-- A road's written reviews, newest first. The author is left off when you
-- can't see their profile; reviews from people you've blocked (or who blocked
-- you) don't show.
create or replace function public.road_reviews(p_road text, p_limit integer default 10)
returns table (
  user_id uuid, display_name text, username text, worth smallint, local_best boolean, flags text[],
  pavement public.pavement_condition, vehicle public.vehicle_kind, note text, updated_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select
    case when s.shown then r.user_id end,
    case when s.shown then p.display_name end,
    case when s.shown then p.username end,
    r.worth, r.local_best, r.flags, r.pavement, r.vehicle, r.note, r.updated_at
  from public.road_ratings r
  join public.profiles p on p.id = r.user_id
  cross join lateral (select private.can_see_details(r.user_id) or private.is_site_admin() as shown) s
  where r.road_id = p_road and r.note is not null and r.note <> ''
    and not private.blocked_between(auth.uid(), r.user_id)
  order by r.updated_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
revoke all on function public.road_reviews(text, integer) from public;
grant execute on function public.road_reviews(text, integer) to anon, authenticated;
