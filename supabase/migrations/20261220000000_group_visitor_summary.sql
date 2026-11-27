-- What someone outside a public group sees of it (11.96).
--
-- Members, events, and meet spots stay members-only. A visitor gets two
-- things to help decide whether to join: who runs the group (profiles are
-- public anyway) and how many events are coming up. No titles, dates, times,
-- or places. Private groups return nothing to non-members, same as before.

create or replace function public.group_visitor_summary(p_group uuid)
returns table (
  organizer_username text,
  organizer_display_name text,
  organizer_avatar_path text,
  organizer_avatar_preset text,
  upcoming_events int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.username::text,
    p.display_name::text,
    p.avatar_path,
    p.avatar_preset,
    (
      select count(*)::int from public.events e
      where e.group_id = g.id and e.status = 'scheduled' and coalesce(e.ends_at, e.starts_at) > now()
    )
  from public.groups g
  left join public.group_members m on m.group_id = g.id and m.role = 'organizer'
  left join public.profiles p on p.id = m.user_id
  where g.id = p_group and private.can_see_group(g.id);
$$;

revoke all on function public.group_visitor_summary(uuid) from public;
grant execute on function public.group_visitor_summary(uuid) to anon, authenticated;
