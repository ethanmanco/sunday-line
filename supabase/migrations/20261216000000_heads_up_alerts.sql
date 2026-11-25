-- Heads-ups on your saved roads (plan 11.86).
--
-- When someone posts a heads-up (police, crash, debris...) within about 250 m
-- of a road you saved to your spots, you get a notification (and a push, if
-- they're on) naming your road and what was posted. Heads-ups stay anonymous:
-- the notification has no "from". Your own heads-ups don't notify you.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'follow_request', 'new_follower', 'follow_accepted',
  'group_invite', 'join_request', 'join_approved',
  'event_new', 'event_changed', 'event_cancelled', 'event_soon', 'event_location',
  'message', 'mention',
  'road_scored', 'spot_reviewed', 'group_spot_proposed', 'group_spot_accepted',
  'road_check_helped', 'admin_road_check', 'admin_spot_review',
  'heads_up_on_road'
));

-- The points of an encoded polyline (precision 5), as lng/lat.
create or replace function private.decode_line(p_line text)
returns table (i integer, lng double precision, lat double precision)
language plpgsql immutable set search_path = ''
as $$
declare
  pos integer := 1;
  n integer := length(p_line);
  la bigint := 0;
  lo bigint := 0;
  k integer;
  b integer;
  shift integer;
  result bigint;
  d bigint;
  idx integer := 0;
begin
  while pos <= n loop
    for k in 0..1 loop
      shift := 0;
      result := 0;
      loop
        b := ascii(substr(p_line, pos, 1)) - 63;
        pos := pos + 1;
        result := result | ((b & 31)::bigint << shift);
        shift := shift + 5;
        exit when b < 32 or pos > n;
      end loop;
      d := case when (result & 1) = 1 then ~(result >> 1) else result >> 1 end;
      if k = 0 then la := la + d; else lo := lo + d; end if;
    end loop;
    i := idx;
    lng := lo / 1e5;
    lat := la / 1e5;
    idx := idx + 1;
    return next;
  end loop;
end;
$$;
revoke all on function private.decode_line(text) from public;

-- Meters from a point to the nearest part of a line (flat-earth, fine at road scale).
create or replace function private.meters_to_line(p_line text, p_lng double precision, p_lat double precision)
returns double precision
language sql immutable set search_path = ''
as $$
  with pts as (
    select i, (lng - p_lng) * 111320 * cos(radians(p_lat)) as x, (lat - p_lat) * 110540 as y
    from private.decode_line(p_line)
  ), seg as (
    select a.x as ax, a.y as ay, b.x as bx, b.y as by
    from pts a join pts b on b.i = a.i + 1
  )
  select min(
    case
      when (bx - ax) * (bx - ax) + (by - ay) * (by - ay) = 0 then sqrt(ax * ax + ay * ay)
      else (
        with t as (select greatest(0, least(1, -(ax * (bx - ax) + ay * (by - ay)) / ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)))) as t)
        select sqrt(power(ax + t * (bx - ax), 2) + power(ay + t * (by - ay), 2)) from t
      )
    end
  )
  from seg;
$$;
revoke all on function private.meters_to_line(text, double precision, double precision) from public;

create or replace function private.heads_up_alerts()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
begin
  for s in
    select distinct on (sp.owner_id) sp.owner_id, sp.id, sp.name
    from public.spots sp
    where sp.kind = 'road' and sp.line is not null
      and sp.owner_id is distinct from new.created_by
      -- Roads that could be near (spot points sit on their road): within about 60 miles.
      and abs(sp.lat - new.lat) < 1 and abs(sp.lng - new.lng) < 1.2
      and private.meters_to_line(sp.line, new.lng, new.lat) <= 250
    order by sp.owner_id, sp.created_at
  loop
    perform private.notify(s.owner_id, 'heads_up_on_road', null, p_spot => s.id, p_title => s.name,
      p_detail => jsonb_build_object('kind', new.kind));
  end loop;
  return null;
end;
$$;
revoke all on function private.heads_up_alerts() from public;

create trigger heads_ups_alert_saved_roads after insert on public.heads_ups
  for each row execute function private.heads_up_alerts();
