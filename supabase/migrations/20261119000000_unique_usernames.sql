-- Unique usernames.
--
-- Every profile gets a username: 3 to 20 lowercase letters, numbers, or
-- underscores, unique across the site. It is the handle used for profile
-- links, follows, and messages later. The display name stays free-form.
--
-- The rules live here in the database, so the website and any future phone
-- app follow the same ones. Stored lowercase, so "Mango" and "mango" are the
-- same username.

alter table public.profiles add column username text;

-- Existing profiles: derive a username from the display name, falling back to
-- driver_<id> when that is too short, reserved, or taken.
with base as (
  select id,
         left(lower(regexp_replace(display_name, '[^A-Za-z0-9_]', '', 'g')), 20) as name,
         row_number() over (
           partition by left(lower(regexp_replace(display_name, '[^A-Za-z0-9_]', '', 'g')), 20)
           order by created_at, id
         ) as rn
  from public.profiles
)
update public.profiles p
set username = case
  when b.rn = 1 and char_length(b.name) >= 3 and b.name not in (
    'admin', 'administrator', 'support', 'help', 'sundayline', 'sunday_line', 'official', 'staff',
    'mod', 'moderator', 'root', 'system', 'api', 'about', 'me', 'signin', 'settings', 'null', 'undefined'
  ) then b.name
  else 'driver_' || left(replace(p.id::text, '-', ''), 8)
end
from base b
where b.id = p.id;

alter table public.profiles
  alter column username set not null,
  add constraint username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  add constraint username_not_reserved check (username not in (
    'admin', 'administrator', 'support', 'help', 'sundayline', 'sunday_line', 'official', 'staff',
    'mod', 'moderator', 'root', 'system', 'api', 'about', 'me', 'signin', 'settings', 'null', 'undefined'
  )),
  add constraint username_unique unique (username);

-- Public, like the display name. People set it when creating their profile
-- and can change it later (the old one is then free for someone else).
grant select (username) on public.profiles to anon, authenticated;
grant insert (username) on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;
