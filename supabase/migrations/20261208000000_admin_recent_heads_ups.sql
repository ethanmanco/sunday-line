-- Recent heads-ups for the site admin (plan 11.69).
--
-- Heads-ups have no direct read access; the map reads live ones in a box
-- through live_heads_ups. This lists the newest ones anywhere, live or ended
-- (ended ones are deleted a day after they end), for the admin's box on the
-- notifications page. Like the map, it never says who posted them.

create or replace function public.admin_recent_heads_ups(p_limit integer default 30)
returns table (
  id uuid, kind text, lng double precision, lat double precision, note text,
  created_at timestamptz, expires_at timestamptz, still_count integer, gone_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_site_admin() then
    raise exception 'only the site admin sees recent heads-ups' using errcode = '42501';
  end if;
  return query
    select h.id, h.kind, h.lng, h.lat, h.note, h.created_at, h.expires_at,
           (select count(*)::int from public.heads_up_votes v where v.heads_up_id = h.id and v.still_there),
           (select count(*)::int from public.heads_up_votes v where v.heads_up_id = h.id and not v.still_there)
    from public.heads_ups h
    order by h.created_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;
revoke all on function public.admin_recent_heads_ups(integer) from public;
grant execute on function public.admin_recent_heads_ups(integer) to authenticated;
