-- ============================================================================
-- 084 — Per-brand reports & modules
--   brands.features records what a brand has switched OFF, so anything new we
--   ship is on by default for every brand:
--     { "disabled_reports": ["/reports/pnl", ...],
--       "disabled_modules": ["recipes", ...] }
--   Keys come from src/lib/brandFeatures.ts. Edited in Settings → Brands.
--   Writes are already superadmin-only via the brands_update policy (035).
--
--   Safe to re-run.
-- ============================================================================

alter table public.brands
  add column if not exists features jsonb not null default '{}'::jsonb;
