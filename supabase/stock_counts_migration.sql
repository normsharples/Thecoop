-- ============================================================================
-- Stock Counts — add approval columns
-- Safe to re-run.
-- ============================================================================

alter table public.stock_counts
  add column if not exists approved_by  uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at  timestamptz;
