-- ============================================================================
-- 047. TEAM MEMBER — READ OWN SHIFT VENUES
-- team_member profiles have empty restaurant_access (by design), so they can't
-- read the restaurants table via has_restaurant_access. Their "My Roster" view
-- needs the venue name of each of their shifts, so allow reading a restaurant
-- when the user has a shift there. (Narrow — only venues they're rostered at.)
-- ============================================================================

drop policy if exists "restaurants_select_own_shifts" on public.restaurants;
create policy "restaurants_select_own_shifts" on public.restaurants
  for select using (
    exists (
      select 1 from public.shifts s
      where s.restaurant_id = restaurants.id
        and s.employee_id = auth.uid()
    )
  );
