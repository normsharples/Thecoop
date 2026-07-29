-- ============================================================================
-- 034 — Phase D: usage-based COGS reporting + P&L basis toggle
--   * restaurants.pnl_cogs_basis  — 'purchases' (default) | 'usage' per venue.
--   * get_inventory_cogs()        — aggregate ledger COGS for a date range,
--       per venue, split Food vs Paper, plus transfer in/out value.
--       SECURITY INVOKER so row-level security on inventory_movements applies
--       (a caller only sees venues they can access).
--   Depends on 030–033. Safe to re-run.
-- ============================================================================

-- ── 1. Per-venue P&L COGS basis toggle ───────────────────────────────────────
alter table public.restaurants
  add column if not exists pnl_cogs_basis text not null default 'purchases'
    check (pnl_cogs_basis in ('purchases','usage'));


-- ── 2. Ledger COGS aggregation ───────────────────────────────────────────────
-- Consumption (true usage) = sale_depletion + waste + count_adjustment + in_transit_loss,
-- valued at moving-avg cost (value_delta is negative for outflows, so we negate).
-- Paper vs Food is inferred from the item's category (Packaging/Paper → paper).
-- Transfers are reported separately so the purchases-based P&L can shift cost
-- between venues (transfer_in adds, transfer_out removes).
create or replace function public.get_inventory_cogs(
  p_start date,
  p_end   date,
  p_restaurant_id uuid default null
)
returns table (
  restaurant_id      uuid,
  usage_food         numeric,
  usage_paper        numeric,
  transfer_in_value  numeric,
  transfer_out_value numeric
)
language sql
security invoker
stable
as $$
  select
    m.restaurant_id,
    coalesce(-sum(m.value_delta) filter (
      where m.movement_type in ('sale_depletion','waste','count_adjustment','in_transit_loss')
        and coalesce(fci.category,'') !~* 'packag|paper'), 0) as usage_food,
    coalesce(-sum(m.value_delta) filter (
      where m.movement_type in ('sale_depletion','waste','count_adjustment','in_transit_loss')
        and coalesce(fci.category,'') ~* 'packag|paper'), 0) as usage_paper,
    coalesce(sum(m.value_delta) filter (where m.movement_type = 'transfer_in'), 0)  as transfer_in_value,
    coalesce(-sum(m.value_delta) filter (where m.movement_type = 'transfer_out'), 0) as transfer_out_value
  from public.inventory_movements m
  join public.food_cost_items fci on fci.id = m.food_cost_item_id
  where m.movement_date between p_start and p_end
    and (p_restaurant_id is null or m.restaurant_id = p_restaurant_id)
  group by m.restaurant_id;
$$;

-- ============================================================================
-- END 034
-- ============================================================================
