-- ============================================================================
-- 029 — Add alt_prices JSONB column to supplier_items
-- Stores additional price variants per item, e.g. carton vs each pricing.
-- Format: [{"unit": "carton", "price": 45.00}, ...]
-- ============================================================================

alter table public.supplier_items
  add column if not exists alt_prices jsonb not null default '[]';
