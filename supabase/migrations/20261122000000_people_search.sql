-- Finding people (docs/plan.md 11.19).
--
-- * Search by username or display name. Blocks hide people both ways: you
--   never find someone who blocked you, or someone you blocked.
-- * Suggestions: people in your groups you don't follow yet, and people who
--   follow you that you don't follow back.
-- * Each result says whether you follow them (or asked to) and whether they
--   follow you.

create or replace function public.search_people(q text)
returns table (
  id uuid, username text, display_name text, avatar_path text, avatar_preset text, is_private boolean,
  my_follow public.follow_status, follows_me boolean, reason text
)
language sql stable security definer set search_path = ''
as $$
  with term as (
    select lower(btrim(q)) as t,
           replace(replace(replace(lower(btrim(q)), '\', '\\'), '%', '\%'), '_', '\_') as e
  )
  select p.id, p.username, p.display_name, p.avatar_path, p.avatar_preset, p.is_private,
         (select f.status from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id),
         exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = auth.uid() and f.status = 'accepted'),
         null::text
  from public.profiles p, term
  where char_length(term.t) >= 2
    and p.id is distinct from auth.uid()
    and not private.blocked_between(auth.uid(), p.id)
    and (p.username like term.e || '%' or lower(p.display_name) like '%' || term.e || '%')
  order by (p.username = term.t) desc, (p.username like term.e || '%') desc, p.display_name
  limit 30;
$$;

create or replace function public.suggest_people()
returns table (
  id uuid, username text, display_name text, avatar_path text, avatar_preset text, is_private boolean,
  my_follow public.follow_status, follows_me boolean, reason text
)
language sql stable security definer set search_path = ''
as $$
  with candidates as (
    -- People who follow you that you don't follow back.
    select f.follower_id as person, 'Follows you' as reason, 0 as rank
    from public.follows f
    where f.followee_id = auth.uid() and f.status = 'accepted'
    union all
    -- People in your groups.
    select m2.user_id, 'In ' || g.name, 1
    from public.group_members m1
    join public.group_members m2 on m2.group_id = m1.group_id and m2.user_id <> m1.user_id
    join public.groups g on g.id = m1.group_id
    where m1.user_id = auth.uid()
  ),
  best as (
    select distinct on (person) person, reason, rank from candidates order by person, rank, reason
  )
  select p.id, p.username, p.display_name, p.avatar_path, p.avatar_preset, p.is_private,
         null::public.follow_status,
         exists (select 1 from public.follows f where f.follower_id = p.id and f.followee_id = auth.uid() and f.status = 'accepted'),
         b.reason
  from best b
  join public.profiles p on p.id = b.person
  where auth.uid() is not null
    and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id)
    and not private.blocked_between(auth.uid(), p.id)
  order by b.rank, p.display_name
  limit 30;
$$;

revoke all on function public.search_people(text) from public;
revoke all on function public.suggest_people() from public;
grant execute on function public.search_people(text) to authenticated;
grant execute on function public.suggest_people() to authenticated;
