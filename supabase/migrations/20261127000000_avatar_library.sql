-- Profile pictures from the car and bike photo library (docs/plan.md 11.28):
-- stored as "lib:<photo id>" (public/avatars/library). The old drawn presets
-- still render for anyone who picked one.
alter table public.profiles drop constraint profiles_avatar_preset_check;
alter table public.profiles add constraint profiles_avatar_preset_check check (
  avatar_preset ~ '^[a-z_]{3,20}-[a-z]{3,10}$' or avatar_preset ~ '^lib:[a-z0-9-]{2,60}$'
);
