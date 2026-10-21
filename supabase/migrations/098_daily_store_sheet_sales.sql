-- 098_daily_store_sheet_sales.sql
-- Add sales and transaction fields to daily_store_sheets so managers can
-- manually record the day's figures. The nightly email will read from these
-- columns first, falling back to the auto-synced sales_daily table.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.daily_store_sheets
  add column if not exists total_sales       numeric,
  add column if not exists net_sales         numeric,
  add column if not exists transaction_count integer,
  add column if not exists delivery_sales    numeric,
  add column if not exists delivery_transaction_count integer,
  add column if not exists submitted_by_name text;
