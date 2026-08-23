-- ============================================================================
-- 045. UNASSIGNED (OPEN) SHIFTS
-- Allow a shift to exist without a team member assigned yet, so managers can
-- lay out open shifts and fill them later. employee_id becomes nullable.
-- (Team members still only ever see shifts where employee_id = their own id,
-- so open shifts stay manager-only until assigned.)
-- ============================================================================

alter table public.shifts
  alter column employee_id drop not null;
