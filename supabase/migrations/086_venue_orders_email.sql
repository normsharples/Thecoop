-- ============================================================================
-- 086 — Per-venue ordering email
--   restaurants.orders_email is where supplier replies to a venue's purchase
--   orders go (Reply-To) and gets a CC of each order. Orders are always sent
--   FROM the app's one orders address. Set in Settings → Venues.
--
--   Safe to re-run.
-- ============================================================================

alter table public.restaurants
  add column if not exists orders_email text;
