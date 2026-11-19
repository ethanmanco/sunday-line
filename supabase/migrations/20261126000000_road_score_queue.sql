-- Scores for roads people draw or pick off the map (docs/plan.md 11.27).
--
-- The owner of a road-spot that isn't on a scored road can ask for it to be
-- scored. A scheduled job (GitHub Actions, hourly) claims queued requests,
-- scores the line from public data with the pipeline's own formulas, and
-- writes the result back. Anyone who can see the spot can see its score, so a
-- spot on the public map takes its score with it. Changing the line clears it.

create type public.score_status as enum ('queued', 'scoring', 'done', 'failed');

create table public.road_scores (
  spot_id uuid primary key references public.spots (id) on delete cascade,
  status public.score_status not null default 'queued',
  requested_by uuid default auth.uid() references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  scored_at timestamptz,
  attempts int not null default 0,
  scores jsonb,
  details jsonb,
  note text
);
create index road_scores_queue on public.road_scores (status, requested_at) where status in ('queued', 'scoring');

alter table public.road_scores enable row level security;
-- Visible exactly when the spot is (the spots rules apply inside the check).
create policy "See scores of spots you can see" on public.road_scores
  for select to anon, authenticated using (exists (select 1 from public.spots s where s.id = spot_id));
grant select on public.road_scores to anon, authenticated;
grant select on public.road_scores to service_role;

-- Ask for a score. Owner only, road-spots only, 20 requests a day.
create or replace function public.request_road_score(p_spot uuid)
returns public.score_status
language plpgsql security definer set search_path = ''
as $$
declare
  s public.spots%rowtype;
  cur public.road_scores%rowtype;
begin
  select * into s from public.spots where id = p_spot;
  if s.id is null or s.owner_id is distinct from auth.uid() then
    raise exception 'Not your spot.' using errcode = '42501';
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

-- A new line means a new road: the old score no longer applies.
create or replace function private.spot_line_changed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.line is distinct from old.line then
    delete from public.road_scores where spot_id = new.id;
  end if;
  return new;
end;
$$;
create trigger spots_line_changed after update of line on public.spots
  for each row execute function private.spot_line_changed();

-- ---------------------------------------------------------------------------
-- For the scoring job only (service role).

-- Take up to p_limit requests: queued ones, and ones stuck "scoring" for an
-- hour (a job that died), up to 3 tries each.
create or replace function public.claim_score_jobs(p_limit int default 10)
returns table (spot_id uuid, name text, line text, lat double precision, lng double precision)
language plpgsql security definer set search_path = ''
as $$
begin
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

create or replace function public.finish_score_job(p_spot uuid, p_scores jsonb, p_details jsonb)
returns void
language sql security definer set search_path = ''
as $$
  update public.road_scores
  set status = 'done', scores = p_scores, details = p_details, scored_at = now(), note = null
  where spot_id = p_spot and status = 'scoring';
$$;

create or replace function public.fail_score_job(p_spot uuid, p_note text)
returns void
language sql security definer set search_path = ''
as $$
  update public.road_scores
  set status = case when attempts >= 3 then 'failed'::public.score_status else 'queued'::public.score_status end,
      note = left(p_note, 300)
  where spot_id = p_spot and status = 'scoring';
$$;

revoke all on function public.claim_score_jobs(int) from public, anon, authenticated;
revoke all on function public.finish_score_job(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fail_score_job(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_score_jobs(int) to service_role;
grant execute on function public.finish_score_job(uuid, jsonb, jsonb) to service_role;
grant execute on function public.fail_score_job(uuid, text) to service_role;
