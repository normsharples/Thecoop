-- ============================================================================
-- 049. AVAILABILITY EFFECTIVE-DATE RANGE
-- Lets a recurring weekly availability rule apply only within a date window
-- (e.g. "available these hours from 1 Jun until 31 Aug"). Both null = always.
-- Part-day availability already uses the existing start_time / end_time columns
-- on availability_rules (available only within that window; outside = not).
-- ============================================================================

alter table public.availability_rules
  add column if not exists effective_from  date,
  add column if not exists effective_until date;
