-- ============================================================================
-- 031 — Invoice line items + stock-count reconciliation (Phase A)
--   * invoice_lines            — itemised receiving; auto-posts purchase movements
--   * stock_count reconciliation — expected-vs-counted, posts adjustment on apply
--   * opening balances via an "is_opening" count
--   Depends on 030 (inventory ledger). Safe to re-run.
-- ============================================================================

-- ── 1. Invoice line items ────────────────────────────────────────────────────
-- The invoice header `amount` stays the P&L figure. Lines are OPTIONAL and feed
-- the inventory ledger only when tagged to a tracked item.
create table if not exists public.invoice_lines (
  id                uuid primary key default uuid_generate_v4(),
  invoice_id        uuid not null references public.invoices on delete cascade,
  food_cost_item_id uuid references public.food_cost_items on delete set null, -- null = untracked line
  description       text not null,
  purchase_unit     text,                 -- unit as bought (carton, each, kg)
  quantity          numeric not null default 0,   -- in purchase units
  unit_cost         numeric not null default 0,   -- $/purchase-unit
  qty_stock_units   numeric not null default 0,   -- quantity × conversion factor (stock units)
  line_total        numeric not null default 0,   -- quantity × unit_cost
  created_at        timestamptz not null default now()
);

create index if not exists idx_invoice_lines_invoice on public.invoice_lines(invoice_id);
create index if not exists idx_invoice_lines_item    on public.invoice_lines(food_cost_item_id);

alter table public.invoice_lines enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='invoice_lines' and policyname='invoice_lines_select') then
    create policy "invoice_lines_select" on public.invoice_lines for select using (
      exists (select 1 from public.invoices i
              where i.id = invoice_lines.invoice_id and public.has_restaurant_access(i.restaurant_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename='invoice_lines' and policyname='invoice_lines_insert') then
    create policy "invoice_lines_insert" on public.invoice_lines for insert with check (
      exists (select 1 from public.invoices i
              where i.id = invoice_lines.invoice_id and public.has_restaurant_access(i.restaurant_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename='invoice_lines' and policyname='invoice_lines_delete') then
    create policy "invoice_lines_delete" on public.invoice_lines for delete using (
      exists (select 1 from public.invoices i
              where i.id = invoice_lines.invoice_id and public.has_restaurant_access(i.restaurant_id)));
  end if;
end $$;


-- Auto-post a purchase receipt when a tagged line is added.
create or replace function public.invoice_line_post_receipt()
returns trigger as $$
declare
  v_restaurant uuid;
  v_date       date;
  v_unit_cost  numeric;
begin
  if new.food_cost_item_id is null or new.qty_stock_units <= 0 then
    return null;  -- untracked line: money only, no stock movement
  end if;

  select restaurant_id, invoice_date into v_restaurant, v_date
    from public.invoices where id = new.invoice_id;

  -- cost per STOCK unit = line_total / stock-unit quantity
  v_unit_cost := case when new.qty_stock_units > 0
                      then new.line_total / new.qty_stock_units else 0 end;

  insert into public.inventory_movements
    (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
     movement_date, source_type, source_id, notes, created_by)
  values
    (v_restaurant, new.food_cost_item_id, 'purchase', new.qty_stock_units, v_unit_cost,
     v_date, 'invoice_line', new.id, new.description, auth.uid());

  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_invoice_line_post_receipt on public.invoice_lines;
create trigger trg_invoice_line_post_receipt
  after insert on public.invoice_lines
  for each row execute function public.invoice_line_post_receipt();


-- Reverse the receipt when a line (or its whole invoice) is deleted.
-- Derive everything from the ORIGINAL movements (by source), so it works even
-- when the parent invoice row is already gone via ON DELETE CASCADE. Negating a
-- purchase with the same unit cost exactly restores both qty and moving average.
create or replace function public.invoice_line_reverse_receipt()
returns trigger as $$
declare
  m record;
begin
  for m in
    select * from public.inventory_movements
     where source_type = 'invoice_line' and source_id = old.id
  loop
    insert into public.inventory_movements
      (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
       movement_date, source_type, source_id, notes, created_by)
    values
      (m.restaurant_id, m.food_cost_item_id, 'purchase', -m.qty_delta, m.unit_cost,
       (now() at time zone 'utc')::date, 'invoice_line_reversal', old.id,
       'reversal of ' || old.description, auth.uid());
  end loop;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_invoice_line_reverse_receipt on public.invoice_lines;
create trigger trg_invoice_line_reverse_receipt
  before delete on public.invoice_lines
  for each row execute function public.invoice_line_reverse_receipt();


-- ── 2. Stock-count reconciliation ────────────────────────────────────────────
alter table public.stock_counts
  add column if not exists is_opening boolean not null default false,
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by uuid references public.profiles on delete set null;

-- live on-hand captured at apply time (added first so the generated column below
-- can reference it — a generated column cannot reference a sibling column added
-- in the same ALTER statement).
alter table public.stock_count_lines
  add column if not exists system_qty numeric;

alter table public.stock_count_lines
  add column if not exists variance_qty numeric
    generated always as (quantity - coalesce(system_qty, 0)) stored;


-- Apply a count to the ledger: post the counted-vs-expected variance per line.
--   Opening count → 'opening' movements (costed at catalogue cost_per_unit).
--   Normal count  → 'count_adjustment' movements (valued at current avg).
-- Idempotent: refuses if already applied.
create or replace function public.apply_stock_count(p_count_id uuid)
returns integer as $$
declare
  v_restaurant uuid;
  v_is_opening boolean;
  v_applied    timestamptz;
  v_date       date;
  r            record;
  v_onhand     numeric;
  v_delta      numeric;
  v_count      integer := 0;
begin
  select restaurant_id, is_opening, applied_at, count_date
    into v_restaurant, v_is_opening, v_applied, v_date
    from public.stock_counts where id = p_count_id;

  if v_restaurant is null then raise exception 'stock count % not found', p_count_id; end if;
  if not public.has_restaurant_access(v_restaurant) then
    raise exception 'no access to restaurant %', v_restaurant;
  end if;
  if v_applied is not null then raise exception 'stock count % already applied', p_count_id; end if;

  for r in
    select id, food_cost_item_id, quantity from public.stock_count_lines
     where stock_count_id = p_count_id
  loop
    select coalesce(qty_on_hand, 0) into v_onhand
      from public.inventory_levels
     where restaurant_id = v_restaurant and food_cost_item_id = r.food_cost_item_id;
    v_onhand := coalesce(v_onhand, 0);

    v_delta := r.quantity - v_onhand;   -- what the ledger must change by to match reality

    -- record the expected snapshot on the line
    update public.stock_count_lines set system_qty = v_onhand where id = r.id;

    if v_delta <> 0 then
      insert into public.inventory_movements
        (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
         movement_date, source_type, source_id, notes, created_by)
      values
        (v_restaurant, r.food_cost_item_id,
         case when v_is_opening then 'opening' else 'count_adjustment' end,
         v_delta, null, coalesce(v_date, (now() at time zone 'utc')::date),
         'stock_count', p_count_id,
         case when v_is_opening then 'opening balance' else 'count variance' end,
         auth.uid());
      v_count := v_count + 1;
    end if;
  end loop;

  update public.stock_counts
     set applied_at = now(), applied_by = auth.uid()
   where id = p_count_id;

  return v_count;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- END 031
-- ============================================================================
