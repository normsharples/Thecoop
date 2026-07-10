-- Migration 024: Uber Eats delivery sales
-- Adds delivery columns to sales_daily so third-party delivery revenue can live
-- ALONGSIDE the in-store (Lightspeed) totals AND the online-ordering (Bite)
-- totals on the SAME (restaurant_id, date) row, rather than overwriting them.
--
-- Mirrors the existing online_* columns (written by bite-sales-sync). The
-- uber-eats-sales-sync task writes ONLY these three columns via an upsert with
-- on_conflict=restaurant_id,date and Prefer: resolution=merge-duplicates, so it
-- never touches total_sales / source (Lightspeed) or online_* (Bite).
--
--   delivery_sales               gross delivery sales for the day (AUD)  → Uber "Sales"
--   delivery_transaction_count   number of completed delivery orders      → Uber "Orders"
--   delivery_average_transaction average order value                      → Uber "Order value"

alter table public.sales_daily
  add column if not exists delivery_sales               numeric not null default 0,
  add column if not exists delivery_transaction_count   integer not null default 0,
  add column if not exists delivery_average_transaction numeric not null default 0;

comment on column public.sales_daily.delivery_sales is
  'Gross Uber Eats delivery sales for the day (AUD). Written by uber-eats-sales-sync.';
comment on column public.sales_daily.delivery_transaction_count is
  'Number of completed Uber Eats delivery orders for the day.';
comment on column public.sales_daily.delivery_average_transaction is
  'Average Uber Eats delivery order value.';
