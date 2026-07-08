-- ============================================================================
-- 008 — Extend incidents table with full report fields
-- ============================================================================

-- Drop and recreate incident_type constraint to include 'accident'
alter table public.incidents
  drop constraint if exists incidents_incident_type_check;

alter table public.incidents
  add constraint incidents_incident_type_check
    check (incident_type in (
      'accident', 'injury', 'equipment', 'customer_complaint',
      'food_safety', 'theft', 'other'
    ));

-- Add all new report fields
alter table public.incidents
  add column if not exists report_date        date,
  add column if not exists report_prepared_by text,
  add column if not exists location           text,
  add column if not exists parties_involved   jsonb not null default '[]'::jsonb,
  add column if not exists incident_detail    text,
  add column if not exists immediate_actions  text,
  add column if not exists conclusions        text,
  add column if not exists cause              text,
  add column if not exists corrective_actions_detail text,
  add column if not exists prevention_steps   text,
  add column if not exists follow_up          text,
  add column if not exists reporter_name      text,
  add column if not exists supervisor_name    text,
  add column if not exists reporter_signature text,
  add column if not exists supervisor_signature text,
  add column if not exists date_signed_reporter   date,
  add column if not exists date_signed_supervisor date;
