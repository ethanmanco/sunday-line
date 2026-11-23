-- Group colors (plan 11.48). Each group has a color from a small cool palette
-- (the app maps 0-6 to colors), so its spots read apart from the warm Driver's
-- road ramp and from other groups. Picked automatically when a group is made
-- (the one its creator's groups use least), and organizers can change it.

alter table public.groups add column color smallint check (color between 0 and 6);

-- Existing groups: spread across the palette in the order they were made.
update public.groups g set color = x.c
from (select id, ((row_number() over (order by created_at)) - 1) % 7 as c from public.groups) x
where x.id = g.id;

create or replace function private.group_color_pick()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.color is null then
    select c into new.color
    from generate_series(0, 6) as c
    order by (
      select count(*) from public.groups g
      join public.group_members m on m.group_id = g.id
      where m.user_id = auth.uid() and g.color = c
    ), random()
    limit 1;
  end if;
  return new;
end;
$$;
revoke all on function private.group_color_pick() from public;
create trigger groups_color_pick before insert on public.groups
  for each row execute function private.group_color_pick();

alter table public.groups alter column color set not null;

-- Organizers change it (the existing "Organizer edits the group" policy limits who).
grant update (color) on public.groups to authenticated;
