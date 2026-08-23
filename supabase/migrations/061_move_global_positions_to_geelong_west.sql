-- ============================================================================
-- 061. MOVE "ALL LOCATIONS" AREAS → GEELONG WEST
-- ----------------------------------------------------------------------------
-- Reassigns every global area/sub-area (positions.restaurant_id IS NULL) to the
-- Geelong West venue, so they are no longer shared across all locations.
-- Safe to re-run: once done there are no NULL rows left to move.
-- ============================================================================

update public.positions
set restaurant_id = (select id from public.restaurants where name = 'Geelong West' limit 1)
where restaurant_id is null;
