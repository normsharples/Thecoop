-- ============================================================================
-- 085 — Send purchase orders from the app
--   The send-purchase-order edge function emails the PO to the supplier (via
--   Resend) and records who sent it, when, and to whom.
--
--   Safe to re-run.
-- ============================================================================

alter table public.purchase_orders
  add column if not exists sent_at     timestamptz,
  add column if not exists sent_to     text,
  add column if not exists sent_by     uuid references public.profiles(id) on delete set null,
  add column if not exists send_count  integer not null default 0;
