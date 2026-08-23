-- ============================================================================
-- 044. SHIFT BREAK START
-- Adds an optional start time for a shift's unpaid break, so the day-view
-- timeline can render the break as a gap and let managers drag it to reposition.
-- Null = auto-centre the break within the shift (the previous behaviour).
-- ============================================================================

alter table public.shifts
  add column if not exists break_start time;
