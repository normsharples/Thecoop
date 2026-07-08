-- Migration 012: Sales mix product breakdown
-- Adds sales_by_product JSONB column to sales_daily for per-product
-- revenue breakdown scraped from Lightspeed Insights dashboard 1216.
-- Format: [{ name: string, amount: number }]

alter table public.sales_daily
  add column if not exists sales_by_product jsonb;

comment on column public.sales_daily.sales_by_product is
  'Per-product sales breakdown from Lightspeed Insights dashboard 1216. [{name, amount}]';
