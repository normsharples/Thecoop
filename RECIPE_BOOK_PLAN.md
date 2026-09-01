# The Coop — Recipe Book: Build Plan

Status: **R1 + R2 BUILT (24 Aug 2026)** — migrations `073_recipe_book.sql`,
`074_recipe_production.sql` and `075_prep_plan.sql`; Recipes page, card, editor,
Prep list, production logging, labels, and the clock tablet. **R3 pending**
(gated on the scraper fix).

### Deploy 075 — the daily prep plan

Run **`075_prep_plan.sql`** after 074, then rebuild the tablet
(`cd coop-clock && npm run build`).

**What changed and why.** 074 built the prep list around par: only recipes with a
par level appeared, and the quantity was worked out for you. Norm's call, and it's
the right one — the opener decides what today needs; par is a useful starting
number, not the decision. So now:

- **every** prep recipe available at the venue appears on the board
- a manager opens **Prep list → Set today's prep** and puts a quantity against
  whatever needs doing (with an optional note like "double for the function")
- the team opens **Prep list** and sees only what was set, works it down, and ticks
  lines off — progress fills in automatically from the batches they log
- **Copy yesterday** rebuilds the list in one click, because most days repeat
- par still shows as a one-tap suggestion chip (par − on hand) while planning
- anything not on today's list is still there, collapsed, so a batch can always be
  logged without a manager first putting it on the plan

Ticking a line off is deliberately separate from the batch log: a half batch can
still be enough, and nobody should have to lie to the log to clear a line.

`prep_list()` from 074 stays in the database but nothing calls it any more —
everything reads `prep_board()`.

**Who can do what:** manager tier (superadmin / area_manager / manager) sets, copies
and clears the plan; anyone with venue access reads it, logs batches and ticks lines
off. If shift supervisors need to set the plan too, that's a one-line change to
`set_prep_plan_item`.

### Label printing — the SUNMI, and why the browser was never going to work

Printing a label produced a **PostScript source listing** on the roll. The dump named the
cause: `%%Creator: (Safari: cgpdftops CUPS filter)` and `%%BeginFile: lw8_errorhandler-2.0`
— LaserWriter 8, i.e. the queue was on a generic PostScript driver. **Sunmi documents
Windows drivers only; there is no macOS CUPS driver for this printer**, so macOS fell back
to PostScript and the thermal head printed the source. Don't go hunting for a driver.

Sunmi's own cloud API talks MQTT behind a partner account, and devices are bound to a
partner **by Sunmi at point of sale** — so that route needs credentials we don't have.
What the printer *does* accept is **raw ESC/POS on TCP 9100** over the LAN, which is how
POS vendors integrate it.

A browser can't open a socket. But `refresh-watcher` on the Mac already is a trusted
process holding a service-role key, already polling Supabase for work. So labels reuse the
pattern `refresh_requests` proved: **the app inserts a row, the watcher prints it.** The
browser only ever talks to Supabase — so this works from the app, the kitchen tablet and a
phone, with no CORS, no certificates, no driver and no Sunmi account.

**Migration 076** — `printers` (per venue: IP, port, columns, default, last_ok/last_error)
and `print_jobs` (a queue carrying the label DATA, not bytes, so a format change is a
watcher restart rather than an app redeploy). `enqueue_print_job`, `reprint_production_run`,
`print_test_label`, and `prep_label_payload` as the single definition of what goes on a
label. **An AFTER INSERT trigger on `production_runs` queues the label itself** — chosen
over editing `post_production_run` so it catches every path at once, the app and the
tablet's `kiosk_prep_done` alike. A venue with no printer queues nothing and the batch is
unaffected; a label is never worth losing a batch over.

**`shared/escpos-label.mjs`** is the one renderer (the earlier TS copy is retired to
`_to_delete/`). Centred double-height bold name wrapped at cols/2, right-aligned fact rows,
boxed double-height USE BY, allergens, feed and partial cut. Non-ASCII is folded — CP437 is
the default code page and a raw UTF-8 byte prints as garbage.

**`refresh-watcher/print-worker.mjs`** drains the queue on every tick, *before* the
scrapers — a cook waiting on a use-by sticker shouldn't queue behind a six-minute Lightspeed
run. Claims each job with a conditional PATCH so two watchers can't double-print, retries a
connection failure three times, and fails misconfiguration (no IP, printer off, unsupported
kind) immediately instead of burning retries.

**Settings → Printers** adds/edits printers, shows last-printed or last-error per printer,
lists recent labels, and has a **Test print** button.

#### Deploy
1. Run **`076_print_jobs.sql`**.
2. Print the SUNMI's self-test (hold feed while powering on) to get its IP, and give it a
   **DHCP reservation** on the router — if the address moves, labels stop.
3. Settings → Printers → Add printer: venue, IP, port 9100, 48 columns, default on.
4. Restart the Refresh Watcher (`Start Refresh Watcher.command`) so it picks up the worker.
5. Hit **Test print**.

#### Verified
Renderer: 19 assertions — byte level (starts `ESC @`, ends `GS V 66 0`, exactly two
double-size runs, no stray high bytes) and layout (nothing overruns 48 or 32 columns, an
80-char word hard-breaks inside the name budget, smart quotes and accents folded).
Worker: 18 assertions against a **real TCP socket** — the exact bytes arrive unchanged;
success marks the job done and stamps the printer; a refused connection requeues with a
readable error and gives up after 3 attempts; no-IP / switched-off / unsupported-kind fail
immediately; an already-claimed job is skipped; a 32-column printer narrows the label.
Queue: applied 073→076 twice, and a batch logged with no printer still logs and queues
nothing; with a printer, the label queues itself — including from the tablet by device
token alone; one default printer per venue is enforced; staff may reprint but not test-print.

**Still true:** the Mac running the watcher must be on, and on the same network as the
printer. If that becomes a problem, the queue is transport-agnostic — a `sunmi_cloud`
adapter drops into the worker and nothing else changes.

### Prep labels — page size (24 Aug)

The labels were printing on A4. Cause: `@page { size: 58mm auto }` is **invalid CSS** —
the `size` grammar takes one or two lengths, or the bare keyword `auto`, never a length
paired with `auto`. An invalid declaration is dropped whole, so no size was ever requested
and the browser used its default paper. Confirmed in Chromium: that rule parses to
`@page { margin: 3mm; }` with the size gone.

Fixed in `src/lib/prepLabel.ts` (mirrored in `coop-clock/src/lib/prepLabel.ts` — **change
both**). Both dimensions are now explicit lengths, and because the height can no longer be
"as tall as the content", the label window measures itself after rendering and writes a
matching `@page` height back out through the CSSOM. A 58 mm label comes out 58 × 60 mm
rather than a long blank feed.

The label window now carries a **size picker — 58 mm / 80 mm / A4 sheet** — remembered per
device in `localStorage` (the printer belongs to the tablet, not the account). Default is
80 mm. Margins are zero and the padding is inside the label.

Verified with Playwright across all three widths: a valid two-length `@page` survives
parsing, the requested width matches, the page height tracks the content to within 4 mm,
the label fills the roll width, auto-print fires once, and the A4 option keeps the label at
80 mm on a sheet. Rendered to PDF with `preferCSSPageSize`: **57.8 × 59.9 mm** and
**80.1 × 59.9 mm**, one page each.

**The browser can only request a size.** Pick the receipt printer in the print dialog, and
set its driver default to the roll. In Chrome also set Margins → None and untick headers and
footers — the label window says so on screen.

### Verified (075)
All three prep recipes appear on the board including one with no par at all. Staff
blocked from `set_prep_plan_item`, `copy_prep_plan` and `clear_prep_plan`; manager
allowed. Targets set → team sees them planned-first with `remaining = target`;
logging 2 batches of a 3 L recipe against a 6 L target drove remaining to exactly 0;
a partial batch left 6 of 8 kg. Staff ticked a line off with the batches still short
and un-ticked it. A target of 0 removed the line. Copy-yesterday moved 2 lines with
their notes and was a no-op on the second run. Tablet board carries **zero** keys
matching `cost|price|avg|supplier|value`, and `kiosk_prep_complete` ticks a line off
by device token alone. 075 applies twice in a row. Both apps `tsc` clean.

### Deploy R2

1. Run **`074_recipe_production.sql`** (after 073). Idempotent, and it announces
   what it skipped if the inventory tables (030) or the kiosk tables (071) aren't live.
2. Open a prep recipe → set this venue's **par level** in the venue panel.
3. **Prep list** appears in the nav (staff-visible). Type what's on the shelf for
   anything not tracked as stock; hit **Made it** to log a batch and print a label.
4. On the tablet: `cd coop-clock && npm run build` and redeploy. Two new tabs,
   **Prep list** and **Recipes**, appear beside Clock.

### What R2 ships
`production_in` / `production_out` movement types, wired into the ledger's costing
rules · `production_runs` (batches, expected vs actual, batch cost, use-by, void) ·
`prep_checks` — one number, once a day, so par works for recipes that aren't stocked ·
`prep_list` (par vs on-hand, biggest gap first) · Prep list page with inline shelf
counts, batch logging, variance, today's batches, reprint and void · 58 mm prep labels
with made / use-by / allergens · "Made it" and recent batches on the recipe card ·
Inventory drill-down labels for the two new movement types · four cost-free anon RPCs
and Prep/Recipes tabs on the coop-clock tablet.

**The rule that matters:** a production run only moves stock when the recipe is
`is_stocked`. A non-stocked prep recipe is depleted through its parent at sale time, so
posting at production as well would consume its ingredients twice. Those runs are still
recorded and labelled; `posted = false` says so on the row, and the UI says why.

### Verified (R2)
Dry-run against Postgres 16 with stub tables matching the live shape. 2 batches of a
stocked marinade: oil 10→6 L @ $5.00, output 10 L @ exactly $2.00, batch cost $20.00 —
all to hand calculation. A short batch (5 L expected, 4 L out) pushes the average to
$2.142857 across 14 L — the yield loss landing where it should. Void restores oil to
6 L @ $5.00 and the output to 10 L @ **exactly** $2.000000: unlike the waste reversal in
032, which returns stock at today's average, this reverses each leg at the cost it was
posted at, so the moving average lands back precisely. A non-stocked recipe recorded
`posted=false` with zero movements and left its ingredients untouched. Prep list returned
`stock` on-hand for the stocked batch and `unknown` for the other until a prep check made
it `checked` and actionable. Ledger value reconciled to $170.00 on both sides after every
run and void. Tablet: bad token refused; `kiosk_recipe` and `kiosk_prep_list` payloads
contain **zero** keys matching `cost|price|avg|supplier|value`, at both the top level and
inside the line objects. Applies clean with the ledger and kiosk tables absent, and twice
in a row. Both apps `tsc` clean.

**Bug the dry-run caught:** `not (has_non_staff_access(...) or run.made_by = auth.uid())`
is NULL — not true — when `made_by` is NULL, which it always is for a tablet-logged run.
plpgsql treats NULL as false, so the raise never fired and any staff member could void
any batch. Both sides are `coalesce`d now.

### Deploy R1

1. **Precheck** (the migrations folder is not the live DB). In the Supabase SQL editor:
   ```sql
   select table_name, string_agg(column_name, ', ' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public'
     and table_name in ('food_cost_items','positions','stock_count_recipes',
                        'stock_count_recipe_ingredients','inventory_levels','sales_mix_daily')
   group by table_name;
   ```
   Nothing here *requires* `inventory_levels` or `sales_mix_daily` — 073 guards both with
   `to_regclass`, so live-basis costing falls back to standard cost and coverage reads zero
   until they exist. It does need `food_cost_items` and `positions`.
2. Run **`073_recipe_book.sql`**. It is idempotent and prints how many legacy
   `stock_count_recipes` it migrated.
3. Open **Recipes** in the nav. Existing stock-count recipes are already there as prep
   recipes with their ids preserved.
4. Check **Admin → Stock Counts** still explodes prepped items correctly — it now reads the
   recipe book instead of `stock_count_recipes`.
5. Once happy, drop the old tables:
   `drop table public.stock_count_recipe_ingredients, public.stock_count_recipes;`
   and delete `_to_delete/RecipesSettings.tsx.superseded-by-073`.

### What R1 ships
Recipes nav item (staff-visible, mobile-first) · card with stepped method, per-step photos,
batch scaling ×0.5–×3, derived allergens, prep time / shelf life / equipment / station ·
superadmin editor with unit-converting ingredient lines and a cycle-safe sub-recipe picker ·
standard + live cost roll-up through nested recipes, manager tier only · recipe health
warnings · per-venue availability + par level (par drives R2) · coverage meter and the
unmapped-product work list ranked by sales $ · `recipe-media` storage bucket ·
`stock_count_recipes` migrated and StockCounts repointed.

### Verified
Dry-run against Postgres 16 with stub tables built from the live schema shape (pgcrypto in
`extensions`). Unit conversion incl. mass↔each via `weight_per_each`; cost roll-up on both
bases matched hand calculation to the cent (menu item std $6.4140 / live $7.1290); live basis
falls back to standard at a venue with no ledger rows; privilege gate (staff blocked from
`recipe_cost`, allowed on `recipe_allergens`); cycle A→B→A terminates in ~1 ms and is
reported by `recipe_issues`; unconvertible units surface rather than costing zero; restamp on
item-unit and sub-recipe-yield-unit change; idempotent re-apply; legacy migration preserves
ids and skips zero-qty lines. The client-side exploder was diffed against `recipe_explode()`
across three cases including the cycle — identical. `tsc` clean (14 pre-existing repo errors,
none in recipe-book files; was 17 before `RecipesSettings.tsx` was retired).
**Vite build still cannot run in the sandbox — verify on the Mac.**

### Open finding
`food_cost_items` has a select policy of `auth.uid() is not null`, so **staff can read
`cost_per_unit` directly through the API** even though no recipe screen shows them cost.
Pre-existing, not introduced here, and it undercuts decision #10. Tightening it to
`has_non_staff_access` is a one-line change but needs a check of every reader first.

---

Design agreed with Norm 24 Aug 2026.

The recipe book is the missing keystone of the inventory build. It is simultaneously
(a) the team's prep and training document, (b) the theoretical-cost engine, and
(c) **Phase C of [INVENTORY_PLAN.md](INVENTORY_PLAN.md)** — the menu-item recipes,
POS aliases and nightly sales depletion that close the perpetual-inventory loop.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Recipe model | **One `recipes` table, two types**: `prep` (batch — slaw, marinade, gravy) and `menu` (what the POS sells). Recipe lines may reference a `food_cost_item` **or another recipe**, so combos and sub-recipes nest naturally |
| 2 | Prep → stock | **Per-recipe `is_stocked` flag, default false.** Default = *explode at sale* (a sale depletes raw ingredients through the prep recipe). Opt-in = *stocked batch*: production is logged, ingredients go out, the prepped item comes in at rolled batch cost, yield variance becomes visible. Engine built once, enabled where it pays |
| 3 | Sales depletion | **Shadow first, per-venue go-live.** Nightly job explodes `sales_mix_daily` products through recipes into *theoretical* usage with no ledger writes; superadmin flips a venue to `live` once coverage and variance look sane, and it starts posting `sale_depletion` movements |
| 4 | Sequencing vs the feed | **Build recipes now; fix the Sales-By-Product scraper in parallel.** R1/R2 need no sales feed at all |
| 5 | Team side | **Cards + par-driven prep list.** Par vs on-hand tells the venue what to make; ticking a batch done *is* the production log |
| 6 | Access point | **Both** the Coop app (staff-visible nav) **and** the coop-clock tablet (anon RPC, cost-free payload) |
| 7 | Costing basis | **Both** — `standard` (global `food_cost_items.cost_per_unit`) and `live` (that venue's `inventory_levels.avg_cost`). Default display live, fall back to standard. Cost rolls up through nested prep recipes |
| 8 | Units | **Enter in any unit, auto-convert.** Store `qty_entered`/`unit_entered` + computed `qty_stock_units` (same pattern as `invoice_lines`). Recipes carry a yield and an optional **yield-loss %** for trim and cook shrinkage |
| 9 | Venue scope | **Global recipes** — one spec for all three venues. Per venue only: `available`, `par_qty`, and its own live cost |
| 10 | Permissions | **Superadmin owns the spec.** Managers set par, log production, add photos. Managers/area managers see cost + GP%; **staff see no cost anywhere** |
| 11 | Rollout | **Sales-ranked stubs + coverage meter.** Auto-create menu stubs in $-sales order; existing `stock_count_recipes` migrate in as prep recipes. No importer — bulk drafts get loaded straight into Supabase by hand |
| 12 | Reporting | **Both** — extend Food Usage (theoretical column) and Sales Mix (recipe cost + true GP$), *and* add dedicated Menu Engineering + Recipe Variance tabs |
| 13 | Card content | Stepped method with per-step photos · shelf life + printable prep label · allergens (tagged on items, rolled up automatically) · prep time, equipment, station link |
| 14 | Delivery | **Three phases, each independently usable** (R1 book+costing → R2 operations → R3 money) |

---

## Known blocker (not blocking R1/R2)

`sales-mix-sync` is **not reading the Sales By Product tile**. Last night, both venues:

```
Tile "Sales By Product": still 0 rows after 45s
Sales By Product: text fallback recovered 16 rows, $280.14
Reconcile: categories $12175.66 vs products $280.14 — OFF BY 97.7%
```

The DOM table read is failing for both tiles and only the *text fallback* is landing;
it works for Category (totals reconcile) and fails for Product. `sales_transactions`
is no substitute — it is header-level, with no line items. Also: **GMHBA is not in the
sales-mix venue map** (only Geelong West and Torquay).

R3 cannot go live until this is fixed. R3's shadow mode ships regardless and lights up
on a backfill once it is.

---

## Schema

**Recipes**
- `recipes` — id, name, type (`prep|menu`), category, description, yield_qty, yield_unit,
  portions, yield_loss_pct, **is_stocked**, output_food_cost_item_id (when stocked),
  shelf_life_hours, prep_time_mins, equipment, station_id, hero_image_path, active,
  created_by, created_at, updated_at.
- `recipe_lines` — id, recipe_id, component_type (`item|recipe`), food_cost_item_id,
  sub_recipe_id, qty_entered, unit_entered, **qty_stock_units** (stamped on save),
  sort_order, note. Check: exactly one of item / sub-recipe.
- `recipe_steps` — id, recipe_id, step_no, body, image_path.
- `recipe_venue_settings` — recipe_id, restaurant_id, available, par_qty, par_unit.

**POS mapping**
- `pos_product_aliases` — id, pos_name, restaurant_id (null = all venues), recipe_id,
  multiplier (default 1). Unique (pos_name, restaurant_id). Unmapped names surface in a
  review queue ranked by $ sales.

**Production**
- `production_runs` — id, restaurant_id, recipe_id, batches, produced_qty, produced_unit,
  made_by, made_at, notes. Posts `production_out` (ingredients) + `production_in` (output)
  movements atomically; delete reverses.

**Depletion**
- `theoretical_usage_daily` — restaurant_id, business_date, food_cost_item_id, qty, cost.
- `recipe_depletion_runs` — restaurant_id, business_date, mode, mapped_sales, total_sales,
  coverage_pct, posted (bool), ran_at. The audit + coverage record.
- `restaurants.recipe_depletion_mode` — `off | shadow | live` (per venue, superadmin).

**Item additions**
- `food_cost_items` — allergens text[], weight_per_each numeric (for `each`-stocked items
  used by mass in a recipe).

**Movement types** — `inventory_movements.movement_type` check extended with
`production_in` and `production_out`. Costing rules: `production_in` is a costed receipt
(unit_cost = rolled batch cost ÷ yield), `production_out` is an issue at current average.

**Engine**
- `recipe_cost(recipe_id, restaurant_id, basis)` — recursive CTE with a depth cap
  (cycle guard), returns cost per yield unit and per portion. Yield-loss % divides.
- `recipe_explode(recipe_id, qty)` — flattens to raw `food_cost_item` quantities through
  any depth of sub-recipe, stopping at `is_stocked` prep items (those are stock in their
  own right).
- Cost never reaches a staff payload: separate cost-bearing RPCs, cost-free reads for the
  staff view and the clock tablet (anon RPCs following the migration-071 device-token
  pattern).

**Migration of existing data** — `stock_count_recipes` / `stock_count_recipe_ingredients`
migrate into `recipes` (type `prep`, is_stocked false) + `recipe_lines`.
`StockCountsPage` repoints at the new tables: explode-mode prep recipes keep the current
"3 × slaw → raw contributions" behaviour; stocked prep items are counted directly as items.
Old tables are left in place, unused, and dropped once verified.
**Check `information_schema` before writing the migration** — the migrations folder is
not the live DB (see the schema-drift note).

---

## Phases

### R1 — Model, book, costing *(usable alone: a working prep book + costing tool)*
Migration (tables above, minus production/depletion) · recipe CRUD for superadmin ·
recipe cards with stepped method, per-step photos, allergen roll-up, prep time, equipment,
station link · `recipe-media` public bucket via the existing `useFileUpload` hook ·
standard + live cost roll-up through nested recipes · `stock_count_recipes` migrated and
StockCounts repointed · sales-ranked menu stubs + coverage meter · Recipes nav item,
staff-visible, mobile-first, cost hidden by role.

### R2 — Operations — **BUILT** (migration 074)
Par levels per venue · daily Prep List (par vs on-hand) · production logging with the
`production_in`/`production_out` movement pair · batch scaling · shelf life + printable
prep label (made / use-by) · coop-clock recipe browser, prep list and tick-done over
cost-free anon RPCs.

Design notes not in the original plan:
- Par vs on-hand only has an on-hand for a **stocked** batch. Rather than forcing every prep
  recipe to be production-logged, `prep_checks` takes one shelf count per recipe per day.
- **Superseded by 075**: par no longer decides the list at all. A manager sets a target per
  recipe per day (`prep_plan_items`) and the team works that list; par survives as a
  suggestion while planning. See "Deploy 075" above.

### R3 — Money *(gated on the scraper fix for live mode only)*
`pos_product_aliases` + unmapped-product review queue ranked by $ · nightly job:
`sales_mix_daily` → aliases → `recipe_explode` → `theoretical_usage_daily` ·
per-venue `off/shadow/live` toggle; live posts `sale_depletion` movements ·
Food Usage gains a theoretical column and variance $ · Sales Mix gains recipe cost and
true GP$ · new Menu Engineering tab (popularity vs profit) and Recipe Variance tab.

---

## Verification
- Cost roll-up, yield loss, nested sub-recipes, cycle guard and the production
  movement pair verified by Python simulation before shipping, as the ledger was.
- `tsc` clean (the repo's 17 pre-existing errors unchanged). **Vite build cannot run in
  the Linux sandbox** — verify the build on the Mac.
- Migration run by Norm in the Supabase SQL editor after an `information_schema` check.
