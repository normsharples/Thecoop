-- ============================================================================
-- 011 — Add discounts and refunds columns to sales_daily
-- ============================================================================

alter table public.sales_daily
  add column if not exists discounts_amount numeric not null default 0,
  add column if not exists discounts_count  integer not null default 0,
  add column if not exists refunds_amount   numeric not null default 0,
  add column if not exists refunds_count    integer not null default 0;
