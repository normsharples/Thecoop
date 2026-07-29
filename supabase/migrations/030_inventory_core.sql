-- ============================================================================
-- 030 — Perpetual inventory: ledger core
--   Phase A of the live-inventory build (see INVENTORY_PLAN.md).
--
--   * inventory_movements  — append-only ledger (the source of truth)
--   * inventory_levels     — trigger-maintained cache (fast on-hand + avg cost)
--   * food_cost_items.track_inventory
--   * item_purchase_units  — buy-unit → stock-unit conversion factors
--   * moving weighted-average costing, maintained entirely by triggers so ANY
--     insert (RPC, app, backfill) keeps the cache correct.
--   * post_inventory_movement() RPC — the single clean entry point for the app.
--
--   Costing rules by movement_type:
--     purchase | transfer_in | opening   → COSTED RECEIPT: unit_cost is the
--         incoming cost/unit; recomputes the item's moving-average cost.
--     sale_depletion | waste | transfer_out | in_transit_loss → ISSUE: qty_delta
--         is negative; valued at the CURRENT average; average unchanged.
--     count_adjustment → QUANTITY FIX (±): valued at current average; average
--         unchanged (finding/losing stock doesn't re-price it).
--
--   Safe to re-run.
-- ============================================================================

-- ── 1. track_inventory flag on the shared item catalogue ─────────────────────
-- Decision: track everything → default true.
alter table public.food_cost_items
  add column if not exists track_inventory boolean not null default true;


-- ── 2. Purchase-unit conversions (buy in cartons, stock in kg) ───────────────
create table if not exists public.item_purchase_units (
  id                   uuid primary key default uuid_generate_v4(),
  food_cost_item_id    uuid not null references public.food_cost_items on delete cascade,
  name                 text not null,                     -- e.g. 'carton', 'each'
  factor_to_stock_unit numeric not null check (factor_to_stock_unit > 0), -- 1 carton = 10 (kg)
  is_default           boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (food_cost_item_id, name)
);

create index if not exists idx_item_purchase_units_item
  on public.item_purchase_units(food_cost_item_id);

alter table public.item_purchase_units enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='item_purchase_units' and policyname='ipu_select') then
    create policy "ipu_select" on public.item_purchase_units for select using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename='item_purchase_units' and policyname='ipu_insert') then
    create policy "ipu_insert" on public.item_purchase_units for insert with check (public.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='item_purchase_units' and policyname='ipu_update') then
    create policy "ipu_update" on public.item_purchase_units for update using (public.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='item_purchase_units' and policyname='ipu_delete') then
    create policy "ipu_delete" on public.item_purchase_units for delete using (public.is_superadmin());
  end if;
end $$;


-- ── 3. Movements ledger (append-only truth) ──────────────────────────────────
create table if not exists public.inventory_movements (
  id                uuid primary key default uuid_generate_v4(),
  restaurant_id     uuid not null references public.restaurants on delete cascade,
  food_cost_item_id uuid not null references public.food_cost_items on delete cascade,
  movement_type     text not null check (movement_type in (
                      'opening','purchase','sale_depletion','waste',
                      'count_adjustment','transfer_out','transfer_in','in_transit_loss')),
  qty_delta         numeric not null,        -- + into stock, − out of stock (stock units)
  unit_cost         numeric not null default 0,  -- $/stock-unit (stamped by trigger)
  value_delta       numeric not null default 0,  -- qty_delta × unit_cost (stamped by trigger)
  movement_date     date not null default (now() at time zone 'utc')::date,
  source_type       text,                    -- 'invoice_line','waste_log','stock_count','stock_transfer','manual'
  source_id         uuid,                    -- row that caused it (for reversal / audit)
  notes             text,
  created_by        uuid references public.profiles on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_inv_moves_restaurant_item
  on public.inventory_movements(restaurant_id, food_cost_item_id);
create index if not exists idx_inv_moves_date   on public.inventory_movements(movement_date);
create index if not exists idx_inv_moves_source on public.inventory_movements(source_type, source_id);

alter table public.inventory_movements enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='inventory_movements' and policyname='inv_moves_select') then
    create policy "inv_moves_select" on public.inventory_movements
      for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='inventory_movements' and policyname='inv_moves_insert') then
    create policy "inv_moves_insert" on public.inventory_movements
      for insert with check (public.has_restaurant_access(restaurant_id));
  end if;
  -- Ledger is append-only: no update policy. Deletes superadmin-only (corrections).
  if not exists (select 1 from pg_policies where tablename='inventory_movements' and policyname='inv_moves_delete') then
    create policy "inv_moves_delete" on public.inventory_movements
      for delete using (public.is_superadmin());
  end if;
end $$;


-- ── 4. Levels cache (one row per venue+item) ─────────────────────────────────
create table if not exists public.inventory_levels (
  restaurant_id     uuid not null references public.restaurants on delete cascade,
  food_cost_item_id uuid not null references public.food_cost_items on delete cascade,
  qty_on_hand       numeric not null default 0,
  avg_cost          numeric not null default 0,
  total_value       numeric not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (restaurant_id, food_cost_item_id)
);

alter table public.inventory_levels enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='inventory_levels' and policyname='inv_levels_select') then
    create policy "inv_levels_select" on public.inventory_levels
      for select using (public.has_restaurant_access(restaurant_id));
  end if;
  -- Cache is written only by the trigger (security definer); no direct write policies.
end $$;


-- ── 5. BEFORE trigger: stamp unit_cost + value_delta onto each movement ───────
create or replace function public.inv_move_stamp_cost()
returns trigger as $$
declare
  cur_avg numeric;
  fallback numeric;
begin
  select avg_cost into cur_avg
    from public.inventory_levels
   where restaurant_id = new.restaurant_id
     and food_cost_item_id = new.food_cost_item_id;
  cur_avg := coalesce(cur_avg, 0);

  if new.movement_type in ('purchase','transfer_in','opening') then
    -- Costed receipt: caller supplies incoming cost. If missing (e.g. opening
    -- with no cost given), fall back to the catalogue cost_per_unit.
    if new.unit_cost is null or new.unit_cost = 0 then
      select cost_per_unit into fallback from public.food_cost_items where id = new.food_cost_item_id;
      new.unit_cost := coalesce(fallback, 0);
    end if;
  else
    -- Issue or quantity fix: value at current average (fallback to catalogue
    -- cost when the item has never been costed).
    if cur_avg = 0 then
      select cost_per_unit into fallback from public.food_cost_items where id = new.food_cost_item_id;
      new.unit_cost := coalesce(fallback, 0);
    else
      new.unit_cost := cur_avg;
    end if;
  end if;

  new.value_delta := round(new.qty_delta * new.unit_cost, 4);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_inv_move_stamp_cost on public.inventory_movements;
create trigger trg_inv_move_stamp_cost
  before insert on public.inventory_movements
  for each row execute function public.inv_move_stamp_cost();


-- ── 6. AFTER trigger: maintain the levels cache + moving average ──────────────
create or replace function public.inv_move_apply_level()
returns trigger as $$
declare
  cur_qty numeric;
  cur_avg numeric;
  new_qty numeric;
  new_avg numeric;
begin
  select qty_on_hand, avg_cost into cur_qty, cur_avg
    from public.inventory_levels
   where restaurant_id = new.restaurant_id
     and food_cost_item_id = new.food_cost_item_id
   for update;
  if not found then cur_qty := 0; cur_avg := 0; end if;

  new_qty := cur_qty + new.qty_delta;

  if new.movement_type in ('purchase','transfer_in','opening') then
    -- Recompute moving weighted average on costed receipts.
    if new_qty <> 0 then
      new_avg := (cur_qty * cur_avg + new.qty_delta * new.unit_cost) / new_qty;
    else
      new_avg := new.unit_cost;   -- drained to exactly zero: remember last cost
    end if;
  else
    new_avg := cur_avg;           -- issues / quantity fixes never re-price
  end if;

  insert into public.inventory_levels
    (restaurant_id, food_cost_item_id, qty_on_hand, avg_cost, total_value, updated_at)
  values
    (new.restaurant_id, new.food_cost_item_id, new_qty, new_avg, round(new_qty * new_avg, 4), now())
  on conflict (restaurant_id, food_cost_item_id) do update
    set qty_on_hand = excluded.qty_on_hand,
        avg_cost    = excluded.avg_cost,
        total_value = excluded.total_value,
        updated_at  = now();

  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_inv_move_apply_level on public.inventory_movements;
create trigger trg_inv_move_apply_level
  after insert on public.inventory_movements
  for each row execute function public.inv_move_apply_level();


-- ── 7. RPC: the app's single entry point for posting a movement ──────────────
create or replace function public.post_inventory_movement(
  p_restaurant_id     uuid,
  p_food_cost_item_id uuid,
  p_movement_type     text,
  p_qty_delta         numeric,
  p_unit_cost         numeric default null,   -- required only for costed receipts
  p_movement_date     date    default null,
  p_source_type       text    default 'manual',
  p_source_id         uuid    default null,
  p_notes             text    default null
) returns uuid as $$
declare
  v_id uuid;
begin
  if not public.has_restaurant_access(p_restaurant_id) then
    raise exception 'no access to restaurant %', p_restaurant_id;
  end if;

  insert into public.inventory_movements
    (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
     movement_date, source_type, source_id, notes, created_by)
  values
    (p_restaurant_id, p_food_cost_item_id, p_movement_type, p_qty_delta,
     coalesce(p_unit_cost, 0), coalesce(p_movement_date, (now() at time zone 'utc')::date),
     p_source_type, p_source_id, p_notes, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- END 030
-- ============================================================================
