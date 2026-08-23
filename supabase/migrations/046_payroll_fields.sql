-- ============================================================================
-- 046. PAYROLL FIELDS (per team member)
-- Adds the payroll setup fields managed from Admin → Team → Payroll.
-- base_pay_rate already exists (migration 042). These stay informational for
-- now (no award engine yet) but give the payroll phase a home.
-- ============================================================================

alter table public.profiles
  add column if not exists pay_type text not null default 'hourly'
    check (pay_type in ('hourly', 'salary')),
  add column if not exists employment_type text
    check (employment_type in ('casual', 'part_time', 'full_time')),
  add column if not exists salary_annual numeric,
  add column if not exists contracted_hours numeric;
