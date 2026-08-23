-- ============================================================================
-- 054. AWARD LEVELS  (Payroll — auto-derive hourly rate from DOB + level)
-- ----------------------------------------------------------------------------
-- Adds an MA000003 classification level per team member so the base hourly rate
-- can be derived (adult level rate × junior % from DOB) instead of typed by
-- hand. `profiles.base_pay_rate` stays as an optional manual OVERRIDE.
-- Also merges the per-level adult rates into app_settings 'award'.
-- Level codes: '1','2','3' (Level 3 responsible for one/none), '3+' (2+ staff).
-- ============================================================================

alter table public.profiles
  add column if not exists award_level text
    check (award_level in ('1', '2', '3', '3+'));

-- Merge the FY2026/27 adult hourly rates (permanent base, before loading) into
-- the award config without clobbering any operator edits to the rest.
update public.app_settings
  set value = value || '{"levels": {"1": 27.81, "2": 29.45, "3": 29.91, "3+": 30.27}}'::jsonb
  where key = 'award'
    and not (value ? 'levels');

-- ============================================================================
-- END OF MIGRATION 054
-- ============================================================================
