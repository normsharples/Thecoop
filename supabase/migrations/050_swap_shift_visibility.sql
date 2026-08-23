-- ============================================================================
-- 050. SHIFT-SWAP VISIBILITY
-- A team member needs to see a shift that's up for swap (to decide whether to
-- pick it up), and the shift they've claimed until it's approved. Extend the
-- shifts SELECT policy so a rosterable user can read a shift that has an OPEN
-- swap, or a swap they personally claimed.
-- ============================================================================

drop policy if exists "shifts_select" on public.shifts;
create policy "shifts_select" on public.shifts
  for select using (
    public.has_roster_view(restaurant_id)
    or (
      employee_id = auth.uid()
      and exists (
        select 1 from public.roster_weeks w
        where w.restaurant_id = shifts.restaurant_id
          and w.week_start = (date_trunc('week', shifts.date)::date)
          and w.status = 'published'
      )
    )
    or exists (
      select 1 from public.shift_swaps sw
      where sw.shift_id = shifts.id
        and (sw.status = 'offered' or sw.claimed_by = auth.uid())
    )
  );
