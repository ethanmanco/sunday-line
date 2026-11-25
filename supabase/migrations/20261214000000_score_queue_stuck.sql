-- Road score queue (plan 11.82): a job that died on its last try stayed
-- "scoring" forever, since claiming skips anything tried 3 times. Claiming now
-- marks those failed first, so the member sees it didn't work.
create or replace function public.claim_score_jobs(p_limit int default 10)
returns table (spot_id uuid, name text, line text, lat double precision, lng double precision)
language plpgsql security definer set search_path = ''
as $$
begin
  update public.road_scores
  set status = 'failed', note = coalesce(note, 'Scoring stopped partway. Ask again later.')
  where status = 'scoring' and started_at < now() - interval '1 hour' and attempts >= 3;

  return query
  with picked as (
    select r.spot_id from public.road_scores r
    where (r.status = 'queued' or (r.status = 'scoring' and r.started_at < now() - interval '1 hour'))
      and r.attempts < 3
    order by r.requested_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ), upd as (
    update public.road_scores r set status = 'scoring', started_at = now(), attempts = r.attempts + 1
    from picked where r.spot_id = picked.spot_id
    returning r.spot_id
  )
  select s.id, s.name, s.line, s.lat, s.lng from upd join public.spots s on s.id = upd.spot_id;
end;
$$;
revoke all on function public.claim_score_jobs(int) from public, anon, authenticated;
