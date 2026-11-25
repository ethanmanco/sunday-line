-- Meets with a route (plan 11.87): an event can list the roads the group will
-- drive, in order. Members see the route when they see the location (the same
-- release time), since it says where the drive goes. Event managers set it.

create table public.event_roads (
  event_id uuid not null references public.events (id) on delete cascade,
  position smallint not null check (position between 1 and 20),
  road_id text not null check (road_id ~ '^[a-f0-9]{12}$'),
  name text not null check (char_length(name) between 1 and 120),
  -- The ends, in driving order, for directions without loading road data.
  from_lng double precision not null check (from_lng between -180 and 180),
  from_lat double precision not null check (from_lat between -90 and 90),
  to_lng double precision not null check (to_lng between -180 and 180),
  to_lat double precision not null check (to_lat between -90 and 90),
  line text check (char_length(line) <= 20000),
  miles real check (miles >= 0),
  primary key (event_id, position)
);
alter table public.event_roads enable row level security;
create policy "Members see the route once the location is out" on public.event_roads
  for select to authenticated using (private.event_location_visible(event_id));
grant select on public.event_roads to authenticated;

-- Replace an event's route: [{road_id, name, from: [lng, lat], to: [lng, lat], line, miles}, ...] (up to 20).
create or replace function public.set_event_route(p_event uuid, p_roads jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ev public.events%rowtype;
begin
  select * into ev from public.events where id = p_event;
  if ev.id is null or not private.has_perm(ev.group_id, 'events') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_roads, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_roads, '[]'::jsonb)) > 20 then
    raise exception 'A route holds up to 20 roads.' using errcode = '23514';
  end if;
  delete from public.event_roads where event_id = p_event;
  insert into public.event_roads (event_id, position, road_id, name, from_lng, from_lat, to_lng, to_lat, line, miles)
  select p_event, r.n::smallint, r.v ->> 'road_id', left(r.v ->> 'name', 120),
    (r.v -> 'from' ->> 0)::double precision, (r.v -> 'from' ->> 1)::double precision,
    (r.v -> 'to' ->> 0)::double precision, (r.v -> 'to' ->> 1)::double precision,
    r.v ->> 'line', (r.v ->> 'miles')::real
  from jsonb_array_elements(coalesce(p_roads, '[]'::jsonb)) with ordinality as r(v, n);
end;
$$;
revoke all on function public.set_event_route(uuid, jsonb) from public;
grant execute on function public.set_event_route(uuid, jsonb) to authenticated;
