# The Coop — Live (Perpetual) Inventory: Build Plan

Status: **Phase A complete & fully clickable** (030–032 + Inventory page + invoice line-item picker + Waste page + count reconciliation). **Phase B (transfers) built** — 033 + Transfers page. **Phase D built** — migration 034 + Transfers report + usage-based Food Cost report + P&L COGS basis toggle. **Phase C pending** (needs the Lightspeed item-sales feed).

### Deploy Phase D
Run `034_pnl_cogs_basis.sql`. New report tabs: **Reports → Food Usage** (true consumption from the ledger vs sales) and **Reports → Transfers** (cost moved in/out per venue). On **Reports → P&L**, a superadmin can toggle each venue's **COGS basis** between Purchases (invoices, the default) and Usage (live inventory); transfers always shift food cost between venues even in Purchases mode (`get_inventory_cogs` RPC).

### Deploy Phase B
Run `033_stock_transfers.sql` in the Supabase SQL editor. Then **Admin → Transfers**: pick the source venue in the switcher, "New Transfer" → choose destination + items (on-hand shown, over-send blocked) → Send. The destination venue selects itself and confirms receipt (editable qty; shortfall auto-written-off as in-transit loss). Cost is carried from source to receiver. Sender can cancel while in-transit (stock returns to source). Verified by simulation: full receipt, partial-with-loss, cancel-restores-source, over-send-blocked.


### Deploy Phase A
Run in the Supabase SQL editor, in order: `030_inventory_core.sql`, `031_invoice_lines_count_recon.sql`, `032_waste_depletion.sql`.
Then, per venue, create a stock count with **is_opening = true**, enter physical quantities, and approve it — that seeds opening balances into the ledger. From then on: on the **Invoices** form each line has an **Item (inventory)** picker (choose a tracked item; unit auto-fills so qty converts 1:1, or a configured `item_purchase_units` conversion is used) that adds stock; the **Admin → Waste** page depletes stock (auto-costed at moving-avg, restores on delete); and approving any count reconciles it. On-hand shows on **Admin → Inventory**.

> Ledger costing was verified by simulation across opening, weighted-average purchases, issues, transfer cost-carry, negative-then-buy, and reversal-restores-average scenarios. Frontend type-checks clean under `tsc`.

---

## Goal
Move The Coop from periodic stock counts to a **perpetual inventory ledger** per venue:
invoices add stock, sales deplete it (via recipes), waste depletes it, counts reconcile it,
and stock transfers move it between venues with cost landing on the receiving venue.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Storage model | **Hybrid**: append-only `inventory_movements` ledger (truth) + trigger-maintained `inventory_levels` cache (fast reads) |
| 2 | Costing method | **Moving weighted average**; recalculated on every receipt; consumption valued at current avg |
| 3 | Units | **One canonical stock unit per item** + per-purchase-unit conversion factors (carton → kg) |
| 4 | Item scope | **Track everything** — all `food_cost_items` are perpetual (`track_inventory` default true) |
| 5 | Sales depletion | **Nightly batch** from a Lightspeed item-level sales feed, exploded through recipes |
| 6 | Recipe mapping | `menu_items` + recipe lines + `pos_product_aliases`; unmapped POS names → review queue |
| 7 | Invoices | Optional `invoice_lines` feed the ledger + moving avg; **header amount stays the P&L figure**; soft warn if lines ≠ header |
| 8 | Stock counts | **Reconciliation true-up**: expected on-hand from ledger, enter physical count, variance posts an adjustment movement (shrinkage reportable) |
| 9 | Waste | **Must be linked to a tracked item**; posts −movement at avg cost; auto-fills `estimated_cost` |
| 10 | Transfers | **Out on send** (in-transit, at source avg cost) → **in on confirm** (carried cost lands on receiver); receiving venue confirms |
| 11 | Partial receipt | Receiver can edit received qty; shortfall = **in-transit loss** adjustment (nothing vanishes) |
| 12 | P&L COGS basis | **Phased**: purchases-based now, per-venue **toggle to usage-based** later; transfers adjust both venues' COGS from day 1; new usage-based Food Cost report immediately |
| 13 | Opening balances | **Seed from an initial go-live stock count** (reuses the reconciliation engine) |
| 14 | Negative on-hand | **Allow but flag loudly**; manual transfer *send* warns/blocks over-send |
| 15 | Permissions | Managers operate (invoices, waste, counts, transfers send + receive own venue); **superadmin defines** menu items, recipes, aliases, conversions, and the P&L toggle |

---

## Data model (new / changed)

**Ledger core**
- `inventory_movements` — id, restaurant_id, food_cost_item_id, `movement_type`
  (`opening | purchase | sale_depletion | waste | count_adjustment | transfer_out | transfer_in | in_transit_loss`),
  qty_delta (± stock units), unit_cost, value_delta, source_type, source_id, movement_date, created_by, created_at.
- `inventory_levels` (cache, PK restaurant_id+food_cost_item_id) — qty_on_hand, avg_cost, total_value, updated_at.
  Maintained by trigger on `inventory_movements`. Moving-avg recompute on receipt movements only.
- `food_cost_items` += `track_inventory boolean default true`. Existing `unit` = the canonical **stock unit**.
- `item_purchase_units` — id, food_cost_item_id, name (e.g. carton), factor_to_stock_unit, is_default.

**Recipes / sales**
- `menu_items` — id, name, category, active.
- `menu_item_recipe_lines` — id, menu_item_id, food_cost_item_id, qty_per_sale (stock units).
- `pos_product_aliases` — id, pos_name (unique), menu_item_id. Unmapped names surface in a review queue.
- `pos_item_sales` — restaurant_id, date, pos_name, qty, gross_sales. **Populated by Norm's Lightspeed item feed** (external prerequisite for Phase C).

**Invoices**
- `invoice_lines` — id, invoice_id, food_cost_item_id, purchase_unit, qty, unit_cost, qty_stock_units, line_total.
  Invoice header `amount` unchanged (P&L truth).

**Transfers**
- `stock_transfers` — id, from_restaurant_id, to_restaurant_id, status (`in_transit | received | cancelled`), sent_by, sent_at, received_by, received_at, notes.
- `stock_transfer_lines` — id, transfer_id, food_cost_item_id, qty_sent, qty_received, unit_cost (carried).

**Settings**
- Per-restaurant `pnl_cogs_basis` (`purchases | usage`) for the phased P&L toggle.

**Engine** — Postgres RPC functions post movements atomically; the `inventory_levels` trigger keeps
on-hand + avg cost in sync. Moving average on receipt:
`new_avg = (old_qty·old_avg + in_qty·in_cost) / (old_qty + in_qty)`; consumption uses current avg, avg unchanged.

---

## Frontend (reuses existing shadcn/Tanstack patterns)
- **Inventory** page (new nav): on-hand + value per venue, negative flags, movement-history drill-down.
- **Transfers** page (new nav): create transfer, in-transit list, confirm-receipt with editable qty.
- **Invoices**: add a line-items editor to the existing page.
- **Waste**: enforce tracked-item link.
- **Stock counts**: show expected-vs-counted variance and post adjustment on approve.
- **Settings (superadmin)**: recipe/menu-item builder, POS aliases + unmapped queue, purchase-unit conversions, P&L usage toggle.
- **Reports**: Transfers report; usage-based Food Cost report; P&L transfer adjustments + toggle.

---

## Phased rollout
- **Phase A — Ledger core**: movements + levels + trigger, `track_inventory`, purchase units, invoice lines, waste linkage, count reconciliation, opening-balance count, Inventory view. → on-hand goes live from manual inputs.
- **Phase B — Transfers** (the original ask): full send → in-transit → confirm flow + partial receipt.
- **Phase C — Sales depletion**: menu items, recipes, aliases, nightly depletion job. **Needs the Lightspeed item-sales feed.**
- **Phase D — Reporting & P&L**: Transfers report, usage-based Food Cost report, P&L transfer adjustments, per-venue usage toggle.

## Prerequisite on Norm
The Lightspeed → Coop **item-level sales quantity feed** (`pos_item_sales`) is required for Phase C only.
Phases A, B, D do not depend on it.
```
Migrations: 030_inventory_core · 031_menu_recipes · 032_invoice_lines ·
            033_stock_transfers · 034_count_reconciliation · 035_pnl_cogs_basis
```
