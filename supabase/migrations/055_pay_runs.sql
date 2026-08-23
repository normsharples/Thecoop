-- ============================================================================
-- 055. PAY RUNS  (Payroll T4 — export audit)
-- ----------------------------------------------------------------------------
-- A lightweight audit record of each exported weekly pay run (what was exported,
-- by whom, totals snapshot). Does NOT freeze time_entries — Deputy remains the
-- source of truth until parity; this just records what the operator sent to Xero.
-- ============================================================================

create table public.pay_runs (
  id             uuid        primary key default uuid_generate_v4(),
  week_start     date        not null,
  store_scope    text        not null,          -- store names, or 'All stores'
  format         text        not null default 'xero_timesheet'
                   check (format in ('xero_timesheet', 'gross_summary')),
  employee_count integer     not null default 0,
  total_hours    numeric     not null default 0,
  total_gross    numeric     not null default 0,
  total_super    numeric     not null default 0,
  notes          text,
  exported_by    uuid        references public.profiles(id) on delete set null,
  exported_at    timestamptz not null default now()
);

create index idx_pay_runs_week on public.pay_runs(week_start);

alter table public.pay_runs enable row level security;

-- Roster managers only (pay figures are sensitive).
create policy "pay_runs_select" on public.pay_runs
  for select using (public.is_roster_manager());
create policy "pay_runs_insert" on public.pay_runs
  for insert with check (public.is_roster_manager());
create policy "pay_runs_delete" on public.pay_runs
  for delete using (public.is_superadmin());

-- ============================================================================
-- END OF MIGRATION 055
-- ============================================================================
