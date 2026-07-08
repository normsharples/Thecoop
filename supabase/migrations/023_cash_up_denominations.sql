-- ============================================================================
-- 023. CASH UP: denomination breakdown + POS expected deposit
-- Till count is now derived from a note/coin-by-note/coin breakdown rather
-- than a single manually-entered figure, and staff can record what the POS
-- system expects to be banked, for a 3-way reconciliation (POS vs physical
-- till count vs what was actually deposited).
-- ============================================================================

alter table public.cash_ups
  add column if not exists denomination_counts jsonb not null default '{}'; -- { "<cents>": count }

alter table public.cash_ups
  add column if not exists pos_expected_deposit numeric not null default 0;
