-- ============================================================================
-- 060. AREAS / SUB-AREAS PER LOCATION
-- ----------------------------------------------------------------------------
-- Adds an optional venue to `positions` so each area / sub-area can belong to a
-- specific restaurant. NULL = "All locations" (global — shown at every venue),
-- which is what every existing row becomes, so nothing changes until Norm adds
-- venue-specific areas.
--
-- Consumers (roster builder, staffing matrix, training) show, for a venue, the
-- positions where restaurant_id IS NULL (global) OR restaurant_id = that venue.
-- Deleting a venue cascades its venue-specific positions away; shifts that used
-- them fall back to unassigned (shifts.position_id is ON DELETE SET NULL).
-- ============================================================================

alter table public.positions
  add column if not exists restaurant_id uuid references public.restaurants(id) on delete cascade;

create index if not exists idx_positions_restaurant on public.positions(restaurant_id);
