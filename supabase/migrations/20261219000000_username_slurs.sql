-- Slurs can't be usernames (11.92). Curse words are fine.
--
-- Your ask. Number swaps count as letters (n1gg3r), repeated letters still
-- match, and underscores don't split a word. Short words that turn up inside
-- ordinary ones ("spicy", "raccoon", "Montenegro") only count on their own or
-- set off by underscores. lib/usernameWords.ts keeps the same lists so the
-- form can say so while you type. Display names are not checked.

create or replace function private.username_has_slur(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with s as (select translate(lower(p_name), '0134578', 'oieastb') as v)
  select
    replace(s.v, '_', '') ~ '(n+i+gg+(e+r+|a+|u+h+)|f+a+g+(o|e|i)+t+|t+r+a+n+n+(y+|i+e+)|w+e+t+b+a+c+k+|b+e+a+n+e+r+|r+a+g+h+e+a+d+|t+o+w+e+l+h+e+a+d+)'
    or exists (
      select 1
      from regexp_split_to_table(s.v, '_') as part
      where regexp_replace(part, '[0-9]', '', 'g')
        ~ '^(f+a+g+s?|n+i+g+s?|s+p+i+c+k?s?|k+i+k+e+s?|c+o+o+n+s?|g+o+o+k+s?|c+h+i+n+k+s?|d+y+k+e+s?|r+e+t+a+r+d+(e+d+|s)?|p+a+k+i+s?|j+a+p+s?|w+o+p+s?|n+e+g+r+o+e?s?)$'
    )
  from s
$$;

alter table public.profiles
  add constraint username_not_allowed check (not private.username_has_slur(username));
