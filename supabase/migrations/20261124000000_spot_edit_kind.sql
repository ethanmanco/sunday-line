-- Editing a spot sends its kind (place or road), which wasn't in the columns
-- people may update, so every edit failed (docs/plan.md 11.24). The shape
-- check still keeps a place a place and a road a road.
grant update (kind) on public.spots to authenticated;
