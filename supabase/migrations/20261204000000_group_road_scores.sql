-- Scoring roads from a group page, and keeping private groups' roads off the public map (docs/plan.md 11.59).
--
-- 1. Any member of a group a road is in (accepted there) can ask for it to be scored, not only its
--    owner. The person who asks gets the notification, and their 20-a-day limit counts it.
-- 2. A group manager can't put a road on the public map while it's in a private group. Only its owner
--    can (people fully control their own content).

create or replace function public.request_road_score(p_spot uuid)
returns public.score_status
language plpgsql security definer set search_path = ''
as $$
declare
  s public.spots%rowtype;
  cur public.road_scores%rowtype;
begin
  select * into s from public.spots where id = p_spot;
  if s.id is null or not (
    s.owner_id = auth.uid()
    or exists (select 1 from public.spot_groups sg
               where sg.spot_id = p_spot and sg.status = 'accepted' and private.is_member(sg.group_id))
  ) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if s.kind <> 'road' or s.line is null then
    raise exception 'Only roads can be scored.' using errcode = '22023';
  end if;
  select * into cur from public.road_scores where spot_id = p_spot;
  if cur.spot_id is not null and cur.status <> 'failed' then
    return cur.status;
  end if;
  if (select count(*) from public.road_scores
      where requested_by = auth.uid() and requested_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s 20 score requests today. Try again tomorrow.' using errcode = '23514';
  end if;
  insert into public.road_scores (spot_id, status, requested_by, requested_at, attempts, note)
  values (p_spot, 'queued', auth.uid(), now(), 0, null)
  on conflict (spot_id) do update
    set status = 'queued', requested_by = auth.uid(), requested_at = now(), attempts = 0, note = null,
        started_at = null;
  return 'queued';
end;
$$;
revoke all on function public.request_road_score(uuid) from public;
grant execute on function public.request_road_score(uuid) to authenticated;

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
  if s.owner_id is distinct from auth.uid() and private.spot_in_private_group(s.id) then
    raise exception 'A road in a private group stays off the public map unless its owner puts it there.' using errcode = '42501';
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
